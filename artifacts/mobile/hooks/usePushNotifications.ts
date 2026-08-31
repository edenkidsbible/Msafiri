import { useEffect, useRef } from "react";
import { Alert, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as IntentLauncher from "expo-intent-launcher";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { useRouter, useRootNavigationState } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiPost, apiGet } from "@/utils/apiClient";
import {
  BG_NOTIFICATION_TASK,
  TOKEN_REGISTERED_AT_KEY,
  LAST_LOCATION_KEY,
} from "@/utils/backgroundNotificationTask";
import { addSharedVehicle } from "@/utils/savedVehicles";
import { useApp, CommunityReport } from "@/context/AppContext";
import { useVehicle } from "@/context/VehicleContext";
import { useLiveLocation } from "@/context/LocationContext";
import { ensureAndroidNotificationChannels } from "@/utils/androidNotificationChannels";

// Resolved at build time from app.json → extra.eas.projectId.
// Expo requires this in production to route push tokens to the correct project.
const EAS_PROJECT_ID =
  Constants.easConfig?.projectId ??
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId ??
  // Keep this in sync with app.config.js. The old fallback pointed at a
  // different EAS project, so builds without expoConfig registered a token
  // that the Msafiri push service could never deliver to.
  "35b79893-fc03-4518-bfcd-31ac65c262f4";

const DEVICE_ID_KEY           = "@msafiri/deviceId";
const TOKEN_KEY               = "@msafiri/pushToken";
const BATTERY_OPT_PROMPTED_KEY = "@msafiri/batteryOptPrompted";

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

// On many Android OEM devices (Samsung, Tecno, Infinix, Xiaomi, Oppo) the OS
// aggressively kills background processes and blocks FCM high-priority delivery
// unless the app is whitelisted from battery optimisation.  This is the #1 cause
// of Android push notifications silently not arriving even when FCM credentials,
// channels, and tokens are all correct.
//
// Android 6+ provides ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, which opens
// a system dialog ("Allow app to ignore battery optimizations? Yes / No") tied
// to the specific package.  We show it once — the first time permission is
// granted — then never again (flag stored in AsyncStorage).
//
// Requires android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in the
// manifest (added to app.config.js).
async function requestBatteryOptimizationExemptionOnce(): Promise<void> {
  if (Platform.OS !== "android") return;

  // Only prompt once per installation.
  const alreadyPrompted = await AsyncStorage.getItem(BATTERY_OPT_PROMPTED_KEY);
  if (alreadyPrompted) return;

  await AsyncStorage.setItem(BATTERY_OPT_PROMPTED_KEY, "1");

  // Explain before opening the OS dialog.
  await new Promise<void>(resolve =>
    Alert.alert(
      "Keep Alerts Reliable",
      "To ensure speed camera and hazard alerts arrive instantly — even when Msafiri is running in the background — please tap \"Allow\" on the next screen.\n\nThis prevents your phone's battery saver from blocking time-critical safety notifications.",
      [{ text: "Continue", onPress: () => resolve() }],
      { cancelable: false }
    )
  );

  const pkg = Application.applicationId ?? "com.msafirikenya.app";
  try {
    // Opens "Allow app to ignore battery optimizations?" system dialog for
    // this specific package.  A no-op (no dialog) if already whitelisted.
    await IntentLauncher.startActivityAsync(
      "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
      { data: `package:${pkg}` }
    );
  } catch {
    // Fallback: open the general battery optimisation list so the user can
    // find and whitelist the app manually.
    try {
      await IntentLauncher.startActivityAsync(
        "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS"
      );
    } catch {
      // Device doesn't support either intent — nothing to do.
    }
  }
}

async function registerToken(lat?: number | null, lng?: number | null): Promise<void> {
  // Push notifications are not available on web or in Expo simulators
  if (Platform.OS === "web") return;

  // Detect Expo Go ("storeClient") — push notifications don't work there on
  // Android because Expo Go uses its own FCM sender ID, not the project's.
  // Local notifications (background drive alerts) still work fine.
  // Standalone preview/production builds are unaffected by this check.
  const isExpoGo = Constants.executionEnvironment === "storeClient";
  if (isExpoGo && Platform.OS === "android") {
    console.warn(
      "[usePushNotifications] Running in Expo Go on Android — remote push " +
      "notifications are NOT delivered in Expo Go. Use an EAS preview or " +
      "production build to test push. Local (background drive) alerts still work."
    );
    // Skip token registration — the token would be invalid for this project anyway.
    return;
  }

  const channelsReady = await ensureAndroidNotificationChannels();
  if (Platform.OS === "android" && !channelsReady) {
    console.warn(
      "[usePushNotifications] Android notification channels are unavailable; " +
      "token registration will retry next launch.",
    );
    return;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    // Show a pre-explanation only the first time (when the system dialog will
    // actually appear). Already-denied status skips straight to the check.
    if (existingStatus === "undetermined") {
      await new Promise<void>(resolve =>
        Alert.alert(
          "Safety Alerts & Notifications",
          "Msafiri sends real-time push notifications for speed cameras, police checkpoints, road hazards, and accidents reported near your route — even when the app is in the background.\n\nYou can manage which notifications you receive in Settings at any time.",
          [{ text: "Continue", onPress: () => resolve() }],
          { cancelable: false }
        )
      );
    }
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return;

  // On Android, prompt the user once to exempt the app from battery optimisation.
  // OEM devices (Samsung, Tecno, Infinix, Xiaomi) block FCM delivery when the
  // app is killed unless it is whitelisted — this is the most common cause of
  // Android push notifications silently not arriving.
  await requestBatteryOptimizationExemptionOnce();

  let tokenData: Notifications.ExpoPushToken;
  try {
    // projectId is required in production builds — without it the call throws
    // and the catch block returns early, silently preventing all notifications.
    tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: EAS_PROJECT_ID,
    });
  } catch (err) {
    // On Android standalone builds this almost always means FCM V1 credentials
    // (a Service Account JSON) have not been uploaded to the EAS project.
    // Fix: run `eas credentials` → Android → select the build profile →
    // "Google Services JSON" + "FCM V1 key" and upload the service account.
    // google-services.json must also be present at build time (EAS injects it
    // from the GOOGLE_SERVICES_JSON_BASE64 secret for CI builds).
    // On iOS: APNs key or certificate must be uploaded to EAS.
    // This error is silent to the user — the device simply never gets a token
    // registered, so the server cannot send it push notifications.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[usePushNotifications] getExpoPushTokenAsync FAILED (${Platform.OS}) — ` +
      (Platform.OS === "android"
        ? "ACTION REQUIRED: upload FCM V1 Service Account JSON to EAS via " +
          "`eas credentials`. Without it push tokens cannot be issued on Android. "
        : "ACTION REQUIRED: upload APNs key/certificate to EAS via " +
          "`eas credentials`. ") +
      `Raw error: ${msg}`
    );
    return;
  }

  const token = tokenData.data;
  const deviceId = await getOrCreateDeviceId();

  // Stable cross-reinstall fingerprint so the server can evict stale rows when
  // the app is reinstalled (AsyncStorage wiped → new deviceId + new push token,
  // but old row in DB remains valid for up to 30 min causing duplicate delivery).
  // iOS: identifierForVendor (IDFV) — persists across reinstalls within the same
  //   app vendor (tied to Apple ID + bundle team). Not available in Expo Go
  //   simulator but fine on real devices and TestFlight/production builds.
  // Android: androidId — persists across reinstalls, resets only on factory reset.
  let vendorId: string | null = null;
  try {
    if (Platform.OS === "ios") {
      vendorId = await Application.getIosIdForVendorAsync();
    } else if (Platform.OS === "android") {
      vendorId = Application.getAndroidId() ?? null;
    }
  } catch {
    // Non-critical — if unavailable the server degrades to token-only dedup.
  }

  try {
    // Always refresh the server registration when the app starts. The platform
    // field became part of release targeting after many users already had a
    // cached token, and skipping unchanged tokens left those valid devices
    // marked "unknown" and excluded from the correct iOS/Android release.
    // The API preserves an existing location when no first GPS fix is ready.
    await apiPost("/push/register", {
      deviceId,
      token,
      platform: Platform.OS,
      vendorId,
      ...(lat != null && lng != null ? { lat, lng } : {}),
    });
    console.info(`[usePushNotifications] Push token registered for ${Platform.OS}`);
    await AsyncStorage.setItem(TOKEN_KEY, token);
    // Stamp the registration time so the background task can check staleness
    await AsyncStorage.setItem(TOKEN_REGISTERED_AT_KEY, String(Date.now()));
  } catch (err) {
    console.warn("[usePushNotifications] Failed to register token:", err);
  }
}

async function syncLocation(lat: number, lng: number): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const deviceId = await getOrCreateDeviceId();
    await apiPost("/push/location", { deviceId, lat, lng });
    // Persist latest location so the background notification task can read it
    // and forward it to the server when the app receives a silent wake-up push.
    await AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({ lat, lng }));
  } catch {
    // Non-critical — silently swallow
  }
}

// Configure how notifications appear when the app is in the foreground.
// Three categories are suppressed:
//   (a) Silent background-refresh pushes (no title, no body) — data payload
//       is handled by addNotificationReceivedListener to trigger an immediate
//       report poll; the driver sees no banner.
//   (b) Explicit silent_ping payloads — belt-and-suspenders so a future send
//       with an accidental non-empty title doesn't slip through guard (a).
//   (c) Background drive-alert notifications (source: "bg_drive_alert") fired
//       by the bg location task — the in-app DriveAlertOverlay already handles
//       alerting when foregrounded, so showing a banner too would double-alert.
//
// iOS vs Android difference:
//   iOS 14+: shouldShowAlert maps to UNNotificationPresentationOptionAlert and
//            shouldShowBanner maps to UNNotificationPresentationOptionBanner —
//            two separate presentation options.  Setting BOTH to true causes the
//            OS to show the notification twice (the iOS double-notification bug).
//            Use shouldShowBanner only; set shouldShowAlert to false on iOS.
//   Android: shouldShowBanner is ignored entirely.  shouldShowAlert is the only
//            field that controls whether a foreground notification appears as a
//            heads-up banner.  Must be true (when not suppressed) on Android or
//            foreground notifications are silently invisible.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const { title, body } = notification.request.content;
    const data = notification.request.content.data as Record<string, unknown> | undefined;
    const isSilent = (!title && !body) || data?.type === "silent_ping";
    const isBgDriveAlert = data?.source === "bg_drive_alert";
    const suppress = isSilent || isBgDriveAlert;
    const isIos = Platform.OS === "ios";
    return {
      // iOS:     false — shouldShowBanner handles it; both true = double notification
      // Android: !suppress — only field that shows foreground heads-up banners
      shouldShowAlert:  isIos ? false : !suppress,
      shouldPlaySound:  !suppress,
      shouldSetBadge:   false,
      // iOS:     !suppress — the modern banner flag (iOS 14+)
      // Android: ignored, but set consistently for clarity
      shouldShowBanner: !suppress,
      shouldShowList:   !suppress,
    };
  },
});

export function usePushNotifications() {
  const router = useRouter();
  // Navigator-ready signal: cold launches via a notification tap can fire the
  // response listener before the root Stack mounts; navigating then throws
  // "attempted to navigate before mount". Instead of a blind retry, queue the
  // route and flush it once the root navigation state gets a key.
  const rootNavState = useRootNavigationState();
  const navReady = !!rootNavState?.key;
  const navReadyRef = useRef(navReady);
  const pendingRouteRef = useRef<Parameters<typeof router.push>[0] | null>(null);
  useEffect(() => {
    navReadyRef.current = navReady;
    if (navReady && pendingRouteRef.current) {
      const route = pendingRouteRef.current;
      pendingRouteRef.current = null;
      try { router.push(route); } catch (e) {
        console.warn("[usePushNotifications] deferred navigation failed:", e);
      }
    }
  }, [navReady, router]);
  const {
    communityReports,
    refreshReports,
    setPendingConfirmationReport,
    setPendingConfirmationSource,
    setPendingFocusCoords,
    markReportPrompted,
    stopSharingTrip,
  } = useApp();
  const { refreshVehicles } = useVehicle();
  const { currentLat, currentLng } = useLiveLocation();
  const communityReportsRef = useRef(communityReports);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  // Stable refs so the response listener (registered once with [] deps) always
  // calls the latest version of these functions without going stale.
  const stopSharingTripRef  = useRef(stopSharingTrip);
  const refreshReportsRef   = useRef(refreshReports);

  useEffect(() => { stopSharingTripRef.current = stopSharingTrip; }, [stopSharingTrip]);
  useEffect(() => { refreshReportsRef.current  = refreshReports;  }, [refreshReports]);

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

    // Register the background notification task so iOS wakes the app on
    // content-available pushes. No-op if already registered or on web.
    Notifications.registerTaskAsync(BG_NOTIFICATION_TASK).catch(() => {
      // Non-fatal — may not be available in Expo Go or before native modules load
    });

    // Navigate now if the navigator is mounted, otherwise queue the route so
    // the navReady effect above delivers it as soon as the Stack mounts.
    const safePush = (
      route: Parameters<typeof router.push>[0],
      opts?: { bypassNavBlock?: boolean },
    ) => {
      if (navReadyRef.current) {
        try { router.push(route); return; } catch { /* fall through to queue */ }
      }
      pendingRouteRef.current = route;
    };

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

          // Navigate to Drive Mode (hosts the map focus + confirmation prompt)
          // without auto-starting a trip.
          safePush({ pathname: "/(tabs)/drive", params: { noAutoStart: "1" } } as any);

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
        } else if (type === "vehicle_join_request") {
          // Someone sent a join request for one of our vehicles.
          // Navigate to the Garage where the pending-requests section is shown.
          safePush("/(tabs)/garage" as any);
        } else if (type === "vehicle_request_approved") {
          // Owner approved our plate-based join request. Persist the shared
          // vehicle locally so it appears in the Garage without requiring a
          // manual re-join.  All needed data is in the push payload.
          const vehicleId   = data?.vehicleId   as string | undefined;
          const displayName = data?.displayName as string | undefined;
          const vehicleType = data?.vehicleType as string | undefined;
          const plateNumber = data?.plateNumber as string | undefined;
          const memberToken = data?.memberToken as string | undefined;
          if (vehicleId && displayName) {
            // Persist to AsyncStorage then immediately refresh VehicleContext so
            // the Garage renders the new shared vehicle without needing a remount.
            addSharedVehicle({
              sharedVehicleId: vehicleId,
              displayName,
              vehicleType:     vehicleType ?? "car",
              plateNumber:     plateNumber ?? undefined,
              memberToken:     memberToken ?? undefined,
            })
              .then(() => refreshVehicles())
              .catch(() => {});
          }
          // Navigate to garage so the user sees their new shared vehicle
          safePush("/(tabs)/garage" as any);
        } else if (type === "dashcam_review_reminder") {
          // Driver tapped the 4-hour review reminder — take them to the drive
          // tab where the review banner lives (noAutoStart prevents trip auto-start)
          safePush({ pathname: "/(tabs)/drive", params: { noAutoStart: "1" } } as any);
        } else if (data?.source === "bg_drive_alert") {
          // Background drive-alert tapped (fired by the bg location task while
          // the app was backgrounded). Navigate to the map and pulse-highlight
          // the exact alert pin so the user can see what was ahead.
          const tapLat = data?.lat as number | undefined;
          const tapLng = data?.lng as number | undefined;
          const tapId  = data?.alertId as string | undefined;
          if (tapLat != null && tapLng != null) {
            safePush({
              pathname: "/(tabs)/map",
              params: {
                focusId:  tapId ?? "bg_alert",
                focusLat: String(tapLat),
                focusLng: String(tapLng),
                focusTs:  String(Date.now()),
              },
            } as any);
          } else {
            safePush("/(tabs)/map" as any);
          }
        } else if (data?.zoneId) {
          // Foreground zone notification tapped (fireZoneNotification in AppContext).
          // Navigate to the map and pulse-highlight the zone's exact pin.
          const tapLat = data?.lat as number | undefined;
          const tapLng = data?.lng as number | undefined;
          const tapId  = data?.zoneId as string;
          if (tapLat != null && tapLng != null) {
            safePush({
              pathname: "/(tabs)/map",
              params: {
                focusId:  tapId,
                focusLat: String(tapLat),
                focusLng: String(tapLng),
                focusTs:  String(Date.now()),
              },
            } as any);
          } else {
            safePush("/(tabs)/map" as any);
          }
        } else if (type === "incident") {
          // General incident notification — navigate to the map, pulse-
          // highlighting the pin if coordinates are in the payload.
          const tapLat = data?.lat as number | undefined;
          const tapLng = data?.lng as number | undefined;
          const tapId  = data?.id as string | undefined;
          if (tapLat != null && tapLng != null) {
            safePush({
              pathname: "/(tabs)/map",
              params: {
                focusId:  tapId ?? "incident",
                focusLat: String(tapLat),
                focusLng: String(tapLng),
                focusTs:  String(Date.now()),
              },
            } as any);
          } else {
            safePush("/(tabs)/map" as any);
          }
        } else if (type === "app_update") {
          // Push notification from admin publishing a new release.
          // Navigate to the update screen — isForceUpdate in the payload
          // controls whether the screen is dismissible or blocks the app.
          // Force updates bypass the navActive block: a mandatory update must
          // always reach the driver, even mid-journey.
          const isForce = data?.isForceUpdate === true || data?.isForceUpdate === "true";
          safePush({
            pathname: "/force-update",
            params: {
              latestVersion:   (data?.version as string) ?? "",
              releaseNotes:    (data?.releaseNotes as string) ?? "",
              storeUrlIos:     (data?.storeUrlIos as string) ?? "",
              storeUrlAndroid: (data?.storeUrlAndroid as string) ?? "",
              isSoft:          isForce ? "false" : "true",
            },
          } as any, { bypassNavBlock: isForce });
        } else {
          // All other types: go to home/map tab
          safePush("/(tabs)" as any);
        }
      });

    return () => {
      responseListener.current?.remove();
    };
  }, []);

  // Foreground silent-push handler — when the server notifies nearby devices of a
  // new report, devices in the foreground receive a data-only push with no title
  // or body. Intercept it here and trigger an immediate out-of-cycle report poll
  // so the new pin appears on the map within ~2 s. The setNotificationHandler
  // above suppresses any visible banner for silent pushes, so the driver sees nothing.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      if (data?.type === "reports_refresh") {
        refreshReportsRef.current().catch(() => {});
      }
    });
    return () => sub.remove();
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
