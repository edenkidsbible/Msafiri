---
name: GPS subscription leak via async watchdog
description: watchPositionAsync race condition causing subscription leaks and OOM crashes in Expo Go
---

# GPS subscription leak via async watchdog

## The rule
The GPS watchdog must never call `subscribe()` while one is already in-flight, and each resolved subscription must verify it is still the current generation before storing itself in `liveSub`.

**Why:** `watchPositionAsync` is async and can take several seconds to resolve when GPS hardware is slow or the device is indoors. If the watchdog fires again before the first call resolves, two concurrent subscriptions are both in flight. Whichever resolves *later* overwrites `liveSub`, leaking the subscription created by the call that resolved *earlier* — that earlier `remove()` is never called. Seven stall cycles = seven leaked native location subscriptions = OOM hard crash in Expo Go.

**How to apply:**
- Add `let isSubscribing = false` and `let generation = 0` as local-to-effect variables.
- At the top of `subscribe()`: `if (isSubscribing) return; isSubscribing = true; const myGen = ++generation;`
- After `await watchPositionAsync(...)`: `if (cancelled || myGen !== generation) { sub.remove(); return; }`
- In a `finally` block: `isSubscribing = false;`
- In the watchdog `setInterval`: add `if (isSubscribing) return;` before the stall check.
- Set `distanceInterval: 0` so stationary users still receive timed fixes — otherwise no fix ever arrives indoors and the watchdog fires every 8s forever, exercising the race aggressively.
