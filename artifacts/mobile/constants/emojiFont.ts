import { Platform } from "react-native";

/** Font family to force on Text nodes that render raw emoji characters.
 *
 *  Some Android builds (emulators/devices without Google Play Services)
 *  don't ship Google's Noto Color Emoji font. Without it, Android's font
 *  fallback lands on a CJK font that happens to have *a* glyph mapped to
 *  the same codepoint — so our incident emoji render as random Chinese/
 *  Japanese characters instead of tofu or the intended emoji.
 *
 *  We bundle a subsetted copy of Noto Color Emoji (only the ~18 codepoints
 *  this app actually uses, registered in app/_layout.tsx) and force it on
 *  Android only. iOS and web already render Apple/system color emoji
 *  correctly and don't need it — and applying an emoji-only font to a
 *  Text node containing other Latin text would blank that text out, so
 *  this must only ever be applied to Text nodes containing *just* an
 *  emoji character. */
export const EMOJI_FONT_FAMILY = Platform.OS === "android" ? "NotoColorEmoji" : undefined;
