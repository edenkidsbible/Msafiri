import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiPost, apiGet } from "@/utils/apiClient";
import { useApp, CommunityReport } from "@/context/AppContext";

const DEVICE_ID_KEY = "@msafiri/deviceId";
const TOKEN_KEY = "@msafiri/pushToken";

async function getOrCreateDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function registerToken(): Promise<void> {
  // Push notifications are not available on web or in Expo simulators
  if (Platform.OS === "web") return;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return;

  let tokenData: Notifications.ExpoPushToken;
  try {
    tokenData = await Notifications.getExpoPushTokenAsync();
  } catch {
    // Not a physical device or projectId not set — skip silently
    return;
  }

  const token = tokenData.data;
  const cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  if (cachedToken === token) return; // Already registered, nothing changed

  const deviceId = await getOrCreateDeviceId();

  try {
    await apiPost("/push/register", {
      deviceId,
      token,
      platform: Platform.OS,
    });
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    console.warn("[usePushNotifications] Failed to register token:", err);
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
  const { communityReports, setPendingConfirmationReport, setPendingFocusCoords } = useApp();
  const communityReportsRef = useRef(communityReports);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    communityReportsRef.current = communityReports;
  }, [communityReports]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    registerToken().catch((err) =>
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
}
