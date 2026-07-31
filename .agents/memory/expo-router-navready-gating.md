---
name: Expo Router navReady gating
description: Reliable pattern for avoiding "navigate before mount" crashes on cold start
---

Catch-and-retry around `router.replace/push` is unreliable: nothing guarantees an effect reruns after the Stack mounts, and one-shot timers drop deep links or fire after unmount.

**Rule:** gate all boot/cold-start navigation on `useRootNavigationState()?.key` (`navReady`) and include `navReady` in the effect deps so the effect is guaranteed to rerun post-mount. For event listeners (push-notification taps), keep a `navReadyRef` + `pendingRouteRef`: queue the route while not ready, flush it in a `[navReady]` effect.

**Why:** cold launches (version-check redirect, onboarding/paywall routing, notification deep links) can resolve before the root Stack mounts; a bare router call then throws and crashes the app.

**How to apply:** any new navigation triggered from _layout effects, context hydration, or native event listeners in the mobile app must use the navReady gate, not try/catch retries. Complements the older `hydrated` flag (which gates on AppContext state, not navigator mount).
