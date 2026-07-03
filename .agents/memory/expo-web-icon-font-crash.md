---
name: Expo web vector-icons uncaught font timeout
description: "Uncaught Error: 6000ms timeout exceeded" from fontfaceobserver/expo-font on Expo web preview, and why a reactive unhandledrejection handler doesn't fix it.
---

Every `@expo/vector-icons` icon family (Ionicons, MaterialCommunityIcons, Feather, etc.) calls `Font.loadAsync()` for itself, uncaught, inside its own `componentDidMount` the first time that family mounts on web. On web, `expo-font` loads the webfont via `fontfaceobserver` with a hard timeout (default 6s); if the fetch is merely slow (common in sandboxed/proxied preview environments), the internal call rejects unhandled.

A `window.addEventListener('unhandledrejection', ...)` guard added in app code (e.g. `_layout.tsx`) does NOT reliably suppress the resulting dev-error redbox, even with `event.preventDefault()`. Expo's own web dev-error overlay registers its listener earlier than app code runs, and `preventDefault()` only suppresses the browser's default handling — it does not stop other listeners (including the overlay's) from firing.

**Why:** `Font.loadAsync()` synchronously inserts the `@font-face` CSS rule into the document before it starts the async wait for load confirmation, so `Font.isLoaded(fontName)` becomes `true` immediately once `loadAsync` is invoked — even before that promise settles.

**How to apply:** Preload every icon family used in the app once, up front (e.g. top of `_layout.tsx`, web-only), with your own `.catch(() => {})`: `[Ionicons, MaterialCommunityIcons, Feather].forEach(set => set.loadFont().catch(() => {}))`. This makes `Font.isLoaded()` true before any icon component constructs, so the icon component's own internal (uncatchable) `loadAsync` call never fires, and the rejection never has a chance to go unhandled.
