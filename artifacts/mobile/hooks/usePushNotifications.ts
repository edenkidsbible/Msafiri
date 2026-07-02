import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiPost } from "@/utils/apiClient";

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
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

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

        if (type === "incident") {
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
