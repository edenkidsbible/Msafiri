import { useEffect, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiGet } from "@/utils/apiClient";

export interface VersionCheckResult {
  checked:            boolean;
  isForceRequired:    boolean;
  updateAvailable:    boolean;
  latestVersion:      string | null;
  releaseNotes:       string | null;
  storeUrlIos:        string | null;
  storeUrlAndroid:    string | null;
}

const INITIAL: VersionCheckResult = {
  checked:         false,
  isForceRequired: false,
  updateAvailable: false,
  latestVersion:   null,
  releaseNotes:    null,
  storeUrlIos:     null,
  storeUrlAndroid: null,
};

export function getCurrentAppVersion(): string {
  return Constants.expoConfig?.version ?? "1.0.0";
}

export function getCurrentBuildNumber(): number {
  if (Platform.OS === "ios") {
    const bn = (Constants.expoConfig?.ios as any)?.buildNumber;
    return bn ? parseInt(bn, 10) : 1;
  }
  if (Platform.OS === "android") {
    const vc = (Constants.expoConfig?.android as any)?.versionCode;
    return vc ?? 1;
  }
  return 1;
}

export function useAppVersion(): VersionCheckResult {
  const [result, setResult] = useState<VersionCheckResult>(INITIAL);

  useEffect(() => {
    if (Platform.OS === "web") {
      // Web always has the latest version — skip check
      setResult({ ...INITIAL, checked: true });
      return;
    }

    const version = getCurrentAppVersion();
    const build   = getCurrentBuildNumber();
    const platform = Platform.OS; // "ios" | "android"

    apiGet<VersionCheckResult & { error?: string }>(
      `/app/version?platform=${platform}&version=${encodeURIComponent(version)}&build=${build}`
    )
      .then((data) => {
        setResult({
          checked:         true,
          isForceRequired: data.isForceRequired ?? false,
          updateAvailable: data.updateAvailable ?? false,
          latestVersion:   data.latestVersion ?? null,
          releaseNotes:    data.releaseNotes ?? null,
          storeUrlIos:     data.storeUrlIos ?? null,
          storeUrlAndroid: data.storeUrlAndroid ?? null,
        });
      })
      .catch(() => {
        // Network failure: allow the app to continue
        setResult({ ...INITIAL, checked: true });
      });
  }, []);

  return result;
}
