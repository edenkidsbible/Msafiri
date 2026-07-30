import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiPost, apiGet } from "@/utils/apiClient";
import { useApp, CommunityReport } from "@/context/AppContext";

// Resolved at build time from app.json → extra.eas.projectId.
// Expo requires this in production to route push tokens to the correct project.
const EAS_PROJECT_ID =
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId ?? "465586c3-648b-459e-b3c9-1983e1a62ffb";

const DEVICE_ID_KEY = "@msafiri/deviceId";
const TOKEN_KEY = "@msafiri/pushToken";

// How often to push location to the server (ms). Every 5 minutes is enough.
const LOCATION_SYNC_INTERVAL_MS = 5 * 60 * 1000;

async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// Android permanently caches notification channel importance after first creation —
// calling setNotificationChannelAsync on an existing channel ID with a different
// importance is silently ignored by the OS (Android 8+ behaviour, by design).
//
// expo-notifications also auto-creates a "default" channel at IMPORTANCE_DEFAULT
// before JS runs, so updating that ID from JS is always a no-op.
//
// Fix: use channel IDs that have never existed on any device so Android creates
// them fresh at IMPORTANCE_HIGH. Old channels (default / incident-alerts) are
// cleaned up so they don't clutter the user's notification settings.
async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    // Remove legacy channels that were created with DEFAULT importance.
    // deleteNotificationChannelAsync is a no-op if the channel doesn't exist.
    await Notifications.deleteNotificationChannelAsync("default").catch(() => {});
    await Notifications.deleteNotificationChannelAsync("incident-alerts").catch(() => {});

    // Create new channels that Android has never seen before — it will honour
    // the requested importance because no cached entry exists for these IDs.
    await Notifications.setNotificationChannelAsync("msafiri_general", {
      name: "General Notifications",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 150, 100, 150],
    });
    await Notifications.setNotificationChannelAsync("msafiri_alerts", {
      name: "Incident Alerts",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "alert_tone.mp3",
      vibrationPattern: [0, 200, 100, 200],
      lightColor: "#00C853",
    });
    // Silent channel for the persistent navigation status tile in the shade.
    // LOW importance = no sound, no heads-up banner, no vibration — it only
    // appears as a quiet sticky bar while navigation or sharing is active.
    await Notifications.setNotificationChannelAsync("msafiri_nav", {
      name: "Navigation Status",
      importance: Notifications.AndroidImportance.LOW,
      sound: undefined,
      vibrationPattern: undefined,
      enableVibrate: false,
    });
  } catch (err) {
    console.warn("[usePushNotifications] Failed to set up Android channels:", err);
  }
}

async function registerToken(lat?: number | null, lng?: number | null): Promise<void> {
  // Push notifications are not available on web or in Expo simulators
  if (Platform.OS === "web") return;

  await ensureAndroidChannels();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return;

  let tokenData: Notifications.ExpoPushToken;
  try {
    // projectId is required in production builds — without it the call throws
    // and the catch block returns early, silently preventing all notifications.
    tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: EAS_PROJECT_ID,
    });
  } catch (err) {
    // On Android standalone builds this almost always means google-services.json
    // was missing from the EAS build or FCM V1 credentials were not uploaded to
    // the EAS project. The error message from the native layer is the key clue.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      "[usePushNotifications] getExpoPushTokenAsync FAILED — " +
      "Android builds require google-services.json + FCM V1 credentials in EAS. " +
      "iOS builds require APNs credentials in EAS. " +
      `Raw error: ${msg}`
    );
    return;
  }

  const token = tokenData.data;
  const cachedToken = await AsyncStorage.getItem(TOKEN_KEY);

  const deviceId = await getOrCreateDeviceId();

  // Only skip if token hasn't changed AND we already have a location to avoid
  // registering without coordinates on the very first call
  if (cachedToken === token && (lat == null || lng == null)) return;

  try {
    await apiPost("/push/register", {
      deviceId,
      token,
      platform: Platform.OS,
      ...(lat != null && lng != null ? { lat, lng } : {}),
    });
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    console.warn("[usePushNotifications] Failed to register token:", err);
  }
}

async function syncLocation(lat: number, lng: number): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const deviceId = await getOrCreateDeviceId();
    await apiPost("/push/location", { deviceId, lat, lng });
  } catch {
    // Non-critical — silently swallow
  }
}

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function usePushNotifications() {
  const router = useRouter();
  const {
    communityReports,
    setPendingConfirmationReport,
    setPendingConfirmationSource,
    setPendingFocusCoords,
    currentLat,
    currentLng,
    markReportPrompted,
    stopNavigation,
    stopSharingTrip,
  } = useApp();
  const communityReportsRef = useRef(communityReports);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  // Stable refs so the response listener (registered once with [] deps) always
  // calls the latest version of these functions without going stale.
  const stopNavigationRef   = useRef(stopNavigation);
  const stopSharingTripRef  = useRef(stopSharingTrip);

  useEffect(() => { stopNavigationRef.current  = stopNavigation;  }, [stopNavigation]);
  useEffect(() => { stopSharingTripRef.current = stopSharingTrip; }, [stopSharingTrip]);

  // Keep a ref to the latest coordinates so the interval always uses fresh values
  const latRef = useRef<number | null>(currentLat);
  const lngRef = useRef<number | null>(currentLng);
  const lastSyncedAtRef = useRef(0);

  useEffect(() => {
    communityReportsRef.current = communityReports;
  }, [communityReports]);

  // Track latest coordinates
  useEffect(() => {
    latRef.current = currentLat;
    lngRef.current = currentLng;
  }, [currentLat, currentLng]);

  // Register push token (once, with initial location if available)
  useEffect(() => {
    if (Platform.OS === "web") return;

    registerToken(currentLat, currentLng).catch((err) =>
      console.warn("[usePushNotifications] registerToken error:", err)
    );

    // Handle tapping a notification or pressing an action button
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const actionId = response.actionIdentifier;

        // ── Default tap (notification body) ──────────────────────────────────
        const data = response.notification.request.content.data as Record<
          string,
          unknown
        >;
        const type = data?.type as string | undefined;

        if (type === "incident_check") {
          const reportId = data?.reportId as string | undefined;
          const payloadLat = data?.lat as number | undefined;
          const payloadLng = data?.lng as number | undefined;

          // Navigate to the map tab immediately
          router.push("/(tabs)" as any);

          // Center the map on the incident
          if (payloadLat != null && payloadLng != null) {
            setPendingFocusCoords({ lat: payloadLat, lng: payloadLng });
          }

          if (reportId) {
            // Mark this report as prompted so the proximity hook won't re-fire for it
            markReportPrompted(reportId);
            // This deep-link came from a push notification, which targets devices
            // that were recently near the incident (not necessarily there right now)
            setPendingConfirmationSource("recent");

            // Try to find the report in the current in-memory cache first
            const report = communityReportsRef.current.find(
              (r) => r.serverId === reportId || r.id === reportId
            );

            if (report) {
              setPendingConfirmationReport(report);
            } else if (payloadLat != null && payloadLng != null) {
              // Report not in local cache — fetch it from the server by its coordinates
              // to build the prompt, and in the meantime show a stub
              apiGet<{ reports: Array<{
                id: string; type: string; lat: number; lng: number;
                status: string; confirmCount: number; denyCount: number;
                speedLimit?: number; roadName?: string; createdAt: number;
              }> }>(`/reports?lat=${payloadLat}&lng=${payloadLng}&radius=300`)
                .then(({ reports }) => {
                  const match = reports.find((r) => r.id === reportId);
                  if (match) {
                    const stub: CommunityReport = {
                      id: match.id,
                      serverId: match.id,
                      type: match.type as CommunityReport["type"],
                      lat: match.lat,
                      lng: match.lng,
                      timestamp: match.createdAt,
                      confirmed: match.confirmCount,
                      status: match.status as CommunityReport["status"],
                      confirmCount: match.confirmCount,
                      denyCount: match.denyCount,
                      speedLimit: match.speedLimit,
                      roadName: match.roadName,
                    };
                    setPendingConfirmationReport(stub);
                  }
                })
                .catch(() => {
                  // Fetch failed — build a minimal stub from the notification payload
                  // so the user can still vote
                  const stub: CommunityReport = {
                    id: reportId,
                    serverId: reportId,
                    type: "hazard",
                    lat: payloadLat,
                    lng: payloadLng,
                    timestamp: Date.now(),
                    confirmed: 1,
                  };
                  setPendingConfirmationReport(stub);
                });
            }
          }
        } else if (type === "incident") {
          router.push("/(tabs)/map" as any);
        } else if (type === "app_update") {
          // Push notification from admin publishing a new release.
          // Navigate to the update screen — isForceUpdate in the payload
          // controls whether the screen is dismissible or blocks the app.
          const isForce = data?.isForceUpdate === true || data?.isForceUpdate === "true";
          router.push({
            pathname: "/force-update",
            params: {
              latestVersion:   (data?.version as string) ?? "",
              releaseNotes:    (data?.releaseNotes as string) ?? "",
              storeUrlIos:     (data?.storeUrlIos as string) ?? "",
              storeUrlAndroid: (data?.storeUrlAndroid as string) ?? "",
              isSoft:          isForce ? "false" : "true",
            },
          } as any);
        } else {
          // All other types: go to home/map tab
          router.push("/(tabs)" as any);
        }
      });

    return () => {
      responseListener.current?.remove();
    };
  }, []);

  // Periodically sync location to the server so incident notifications are targeted
  useEffect(() => {
    if (Platform.OS === "web") return;

    const interval = setInterval(() => {
      const lat = latRef.current;
      const lng = lngRef.current;
      if (lat == null || lng == null) return;

      const now = Date.now();
      if (now - lastSyncedAtRef.current < LOCATION_SYNC_INTERVAL_MS) return;
      lastSyncedAtRef.current = now;

      syncLocation(lat, lng).catch(() => {});
    }, 60 * 1000); // check every minute, sync every LOCATION_SYNC_INTERVAL_MS

    return () => clearInterval(interval);
  }, []);
}
