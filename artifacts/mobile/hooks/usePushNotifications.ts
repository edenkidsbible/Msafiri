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

// Android requires an explicit notification channel (API 26+) or notifications
// may be silently suppressed or play no sound, regardless of the payload's
// `sound` field. Channels must be created before the first notification arrives.
async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("default", {
      name: "General",
      // HIGH = heads-up banner + sound. DEFAULT only puts notifications
      // silently in the tray — no banner, no sound, users never see them.
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 150, 100, 150],
    });
    await Notifications.setNotificationChannelAsync("incident-alerts", {
      name: "Incident Alerts",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "alert_tone.mp3",
      vibrationPattern: [0, 200, 100, 200],
      lightColor: "#00C853",
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
    console.warn("[usePushNotifications] getExpoPushTokenAsync failed:", err);
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
  const { communityReports, setPendingConfirmationReport, setPendingConfirmationSource, setPendingFocusCoords, currentLat, currentLng, markReportPrompted } = useApp();
  const communityReportsRef = useRef(communityReports);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

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

    // Handle tapping a notification — navigate to the map tab
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
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
