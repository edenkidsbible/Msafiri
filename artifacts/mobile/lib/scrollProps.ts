import { Platform } from "react-native";

/**
 * Spread onto every <ScrollView> to get iOS-level momentum physics on Android:
 * — decelerationRate 0.998 as an explicit number, not the "normal" string.
 *   RN's named presets do NOT mean the same thing on both platforms: "normal"
 *   resolves to 0.998 on iOS but only 0.985 on Android (Android's "normal" is
 *   tuned for its own scrollbar-flick feel), so the list actually stopped
 *   noticeably sooner on Android even with this prop "set". Passing the raw
 *   number applies identically on both platforms and is what actually closes
 *   the gap.
 * — overScrollMode "never" removes Android's edge-glow rubber-band (Android only, ignored on iOS)
 * — scrollEventThrottle 16 delivers scroll events at 60 fps on both platforms
 */
export const SCROLL_PROPS = {
  decelerationRate: 0.998,
  overScrollMode: "never" as const,
  scrollEventThrottle: 16,
};

/**
 * Spread onto every <FlatList> — includes the scroll-feel props above plus
 * Android-specific render windowing that prevents frame drops on long lists.
 */
export const FLAT_LIST_PROPS = {
  ...SCROLL_PROPS,
  removeClippedSubviews: Platform.OS === "android",
  maxToRenderPerBatch: 10,
  windowSize: 10,
  initialNumToRender: 8,
};
