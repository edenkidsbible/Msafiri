import AsyncStorage from "@react-native-async-storage/async-storage";
import { PermissionsAndroid, Platform } from "react-native";

export type AndroidCameraPermissionState = {
  granted: boolean;
  canAskAgain: boolean;
  status: "granted" | "denied" | "undetermined";
};

const CAMERA_DECISION_KEY = "@msafiri/androidCameraPermissionDecision";
const NEVER_ASK_AGAIN = PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;

let cameraRequestInFlight: Promise<AndroidCameraPermissionState> | null = null;
let microphoneRequestInFlight: Promise<boolean> | null = null;

function grantedState(): AndroidCameraPermissionState {
  return { granted: true, canAskAgain: true, status: "granted" };
}

/**
 * Reads Android's actual CAMERA grant instead of expo-camera's hook cache.
 *
 * Android does not expose whether a denied permission can be asked again without
 * asking it. We persist only a concrete NEVER_ASK_AGAIN result and always clear
 * it after Settings grants the permission.
 */
export async function getAndroidCameraPermissionState(): Promise<AndroidCameraPermissionState> {
  if (Platform.OS !== "android") {
    return { granted: false, canAskAgain: false, status: "undetermined" };
  }

  const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
  if (granted) {
    await AsyncStorage.removeItem(CAMERA_DECISION_KEY).catch(() => {});
    return grantedState();
  }

  const lastDecision = await AsyncStorage.getItem(CAMERA_DECISION_KEY).catch(() => null);
  const permanentlyDenied = lastDecision === NEVER_ASK_AGAIN;
  return {
    granted: false,
    canAskAgain: !permanentlyDenied,
    status: lastDecision ? "denied" : "undetermined",
  };
}

/**
 * The only Android camera request in the app. A module-level promise serializes
 * competing taps so Android never receives overlapping runtime-permission calls.
 */
export async function requestAndroidCameraPermission(): Promise<AndroidCameraPermissionState> {
  if (Platform.OS !== "android") return getAndroidCameraPermissionState();
  if (cameraRequestInFlight) return cameraRequestInFlight;

  const request = (async (): Promise<AndroidCameraPermissionState> => {
    const current = await getAndroidCameraPermissionState();
    if (current.granted || !current.canAskAgain) return current;

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: "Camera Access",
        message:
          "Msafiri needs camera access for dashcam recording and the Crash Assistant. " +
          "Footage stays on your device.",
        buttonPositive: "Allow",
        buttonNegative: "Not Now",
      },
    );

    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      await AsyncStorage.removeItem(CAMERA_DECISION_KEY).catch(() => {});
      return grantedState();
    }

    await AsyncStorage.setItem(CAMERA_DECISION_KEY, result).catch(() => {});
    return {
      granted: false,
      canAskAgain: result !== NEVER_ASK_AGAIN,
      status: "denied" as const,
    };
  })().finally(() => {
    cameraRequestInFlight = null;
  });
  cameraRequestInFlight = request;

  return request;
}

/**
 * Audio is optional for dashcam video. This is intentionally separate from the
 * camera request so a microphone denial never prevents video capture.
 */
export async function requestAndroidMicrophonePermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (microphoneRequestInFlight) return microphoneRequestInFlight;

  microphoneRequestInFlight = (async () => {
    const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    if (await PermissionsAndroid.check(permission)) return true;

    const result = await PermissionsAndroid.request(permission, {
      title: "Microphone Access",
      message:
        "Msafiri can include sound in dashcam clips and capture Crash Assistant voice statements.",
      buttonPositive: "Allow",
      buttonNegative: "Not Now",
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  })().finally(() => {
    microphoneRequestInFlight = null;
  });

  return microphoneRequestInFlight;
}

export async function getAndroidMicrophonePermissionGranted(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
}