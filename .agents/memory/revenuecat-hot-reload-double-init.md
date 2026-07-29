---
name: RevenueCat double-init on Expo Go hot reload
description: Module-level Purchases.configure() re-runs on every Metro hot reload
---

# RevenueCat double-init on Expo Go hot reload

## The rule
Always guard `initializeRevenueCat()` with a module-level `let _rcInitialized = false` flag that returns early on the second call.

**Why:** Expo Go's hot reload re-evaluates module-level code on every file save. `initializeRevenueCat()` is called at module level in `_layout.tsx`, so it fires again on each hot reload. Calling `Purchases.configure()` twice logs a warning and creates a new SDK instance, potentially corrupting in-flight purchase or subscription state mid-session.

**How to apply:** The guard is already in `artifacts/mobile/lib/revenuecat.tsx` as `let _rcInitialized = false` checked at the top of `initializeRevenueCat()`. Do not remove it. Any future SDK that is initialized at module level should get the same guard.
