import { useColorScheme } from "react-native";

import { useApp } from "@/context/AppContext";
import colors from "@/constants/colors";

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 *
 * Falls back to the light palette when no dark key is defined in
 * constants/colors.ts (the scaffold ships light-only by default).
 * When a sibling web artifact's dark tokens are synced into a `dark`
 * key, this hook will automatically switch palettes based on the
 * device's appearance setting.
 *
 * We derive the effective scheme from AppContext's `themeOverride` rather
 * than relying solely on useColorScheme(). On Android, calling
 * Appearance.setColorScheme() does not always synchronously update the value
 * returned by useColorScheme() (a known RN limitation on some API levels).
 * Reading the state variable directly gives instant, synchronous updates on
 * every platform without waiting for the OS appearance event to propagate.
 */
export function useColors() {
  const { themeOverride } = useApp();
  // useColorScheme() is still needed for the "system" fallback path.
  const systemScheme = useColorScheme();
  const scheme = themeOverride === "system" ? systemScheme : themeOverride;
  const isDark = scheme === "dark" && "dark" in colors;
  const palette = isDark
    ? (colors as unknown as Record<string, typeof colors.light>).dark
    : colors.light;
  return { ...palette, radius: colors.radius, isDark };
}
