import { Platform } from "react-native";

/**
 * Spread onto every <ScrollView> to get iOS-level momentum physics on Android:
 * — decelerationRate "normal" matches iOS's ~0.998 deceleration curve
 * — overScrollMode "never" removes Android's edge-glow rubber-band (Android only, ignored on iOS)
 * — scrollEventThrottle 16 delivers scroll events at 60 fps on both platforms
 */
export const SCROLL_PROPS = {
  decelerationRate: "normal" as const,
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
