---
name: Modal refetch-storm from live GPS state
description: A modal or panel that fetches data (e.g. route/incident status) kept re-fetching every few seconds because a continuously-updating GPS value was in its useEffect dependency array.
---

A one-shot "check this now" fetch (e.g. RouteCheckModal's `checkRouteStatus`) should not re-run every time a live-tracked value like `currentLat`/`currentLng` updates from GPS. GPS location state in this app updates on every fix (every few seconds), so including it directly in a `useEffect` dependency array causes the effect to fire repeatedly, producing a visible "keeps refreshing" UX bug and unnecessary network calls.

**Why:** The user (driver) perceives this as the whole panel/modal flickering or resetting every <5s, which is disorienting and makes it hard to read incident info. The underlying fetch function itself may already read location from a ref internally (not needing the reactive value at all) — the dependency was only there to gate "wait until we have a location fix," not to keep re-fetching.

**How to apply:**
- If a value is only needed as a readiness gate (has GPS fixed yet?), depend on a derived boolean (`hasLocation = currentLat != null`) instead of the raw continuously-changing number. Booleans are referentially stable once true, so the effect won't re-fire on every subsequent tick.
- If the underlying data-fetching function reads live state via a ref (e.g. `currentLatRef.current`) rather than a function argument, you often don't need the raw value in the dependency array at all — only the boolean gate.
- Pair this with a manual refresh affordance (refresh button + "Updated Xs/min ago" label) so the user can still get fresh data on demand without silent background churn.
- General rule: before adding any state var to a `useEffect` dep array, ask whether it changes continuously (timers, GPS, animation frames, websocket ticks) — if so, it almost always needs to be converted to a derived boolean/ref/transition-based dependency, not used raw.
