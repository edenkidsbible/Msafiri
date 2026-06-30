---
name: Expo Router web navigation crash
description: router.replace() in root layout crashes on web because it fires before the Stack navigator mounts; fix via AppContext hydrated flag
---

## The rule
Never call `router.replace()` from `_layout.tsx` until AppContext has finished loading from AsyncStorage.

## Why
On web, `useEffect` in `RootLayoutNav` fires on the first render tick. At that point:
1. `onboardingComplete` is still `false` (its initial useState value)
2. The Stack navigator is not yet mounted

So `router.replace("/onboarding")` throws: *"Attempted to navigate before mounting the Root Layout component"*

## How to apply
`AppContext` exposes `hydrated: boolean` — starts `false`, set to `true` after the `Promise.all(AsyncStorage.getItem(...))` resolves.

In `_layout.tsx`, the navigation `useEffect` must check `if (!hydrated) return;` before proceeding.

```tsx
useEffect(() => {
  if (!hydrated) return;       // wait for storage load
  if (checked.current) return;
  checked.current = true;
  if (!onboardingComplete) router.replace("/onboarding");
}, [hydrated, onboardingComplete]);
```

Note: `useRootNavigationState` is NOT exported by expo-router v6 — do not try to import it.
