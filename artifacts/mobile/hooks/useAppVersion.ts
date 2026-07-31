import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
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
  const appState = useRef(AppState.currentState);

  const runCheck = useCallback(() => {
    if (Platform.OS === "web") {
      setResult({ ...INITIAL, checked: true });
      return;
    }

    const version  = getCurrentAppVersion();
    const build    = getCurrentBuildNumber();
    const platform = Platform.OS;

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

  useEffect(() => {
    // Initial check on mount
    runCheck();

    // Re-check every time the app comes back to the foreground so a force
    // update published while the app was running is caught immediately —
    // without this the user would need a cold restart to see the screen.
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        runCheck();
      }
      appState.current = next;
    });

    return () => sub.remove();
  }, [runCheck]);

  return result;
}
