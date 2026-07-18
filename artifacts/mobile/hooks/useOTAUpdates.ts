import * as Updates from "expo-updates";

/**
 * Checks for an available OTA update and silently applies it.
 *
 * Should be called during the splash-screen phase (before SplashScreen.hideAsync)
 * so the reload — if triggered — is invisible to the user.
 *
 * Returns true  → Updates.reloadAsync() was called; the app is restarting.
 *                  The caller must NOT hide the splash screen.
 * Returns false → No update available, not in an OTA-capable build (Expo Go /
 *                  dev client without a channel), or a network error occurred.
 *                  The caller should proceed normally.
 */
export async function checkForOTAUpdate(): Promise<boolean> {
  // Updates.isEnabled is false in Expo Go and development builds that have no
  // EAS Update channel configured.  Guard here so dev workflow is unaffected.
  if (!Updates.isEnabled) return false;

  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return false;

    await Updates.fetchUpdateAsync();
    // reloadAsync() restarts the JS engine with the new bundle.
    // Code after this line is unreachable.
    await Updates.reloadAsync();
    return true;
  } catch {
    // Network error, bad manifest, etc. — silently skip.
    return false;
  }
}
