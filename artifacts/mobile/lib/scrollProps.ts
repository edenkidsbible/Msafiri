import { Platform } from "react-native";

/**
 * Spread onto every <ScrollView> to get a premium, iOS-level scroll feel on
 * both platforms:
 *
 * — decelerationRate 0.998 as an explicit number, not the "normal" string.
 *   RN's named presets do NOT mean the same thing on both platforms: "normal"
 *   resolves to 0.998 on iOS but only 0.985 on Android (Android's "normal" is
 *   tuned for its own scrollbar-flick feel), so the list actually stopped
 *   noticeably sooner on Android even with this prop "set". Passing the raw
 *   number applies identically on both platforms and is what actually closes
 *   the gap.
 * — overScrollMode "never" removes Android's edge-glow rubber-band
 * — scrollEventThrottle 16 delivers scroll events at 60 fps on both platforms
 * — showsVerticalScrollIndicator/showsHorizontalScrollIndicator false gives a
 *   cleaner look; the scroll position is evident from content alone.
 * — fadingEdgeLength (Android only) renders a subtle gradient fade at the top
 *   and bottom of the scroll area, signalling overflowed content without the
 *   heavy glow — the same technique Google uses in their own premium Android
 *   apps (e.g. Gmail, Maps).  Ignored on iOS.
 */
export const SCROLL_PROPS = {
  decelerationRate: 0.998,
  overScrollMode: "never" as const,
  scrollEventThrottle: 16,
  showsVerticalScrollIndicator: false,
  showsHorizontalScrollIndicator: false,
  ...(Platform.OS === "android" ? { fadingEdgeLength: 24 } : {}),
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
