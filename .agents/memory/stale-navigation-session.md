---
name: Stale navigation session voice guidance
description: Why turn-by-turn voice guidance could keep firing long after a driver gave up on a trip, and how it was bounded.
---

Complaint pattern: "I never reached my destination, I stopped/ended navigation, but the voice guidance kept trying to route me there — even hours later."

Audited the full path (`stopNavigation`, `setNavDestination(null)`, the in-app Stop button, arrival-modal handlers, all speakText call sites, notification scheduling, AsyncStorage persistence) and every one of them correctly clears nav refs/state and calls `Speech.stop()`. No stale-closure or repeating-notification bug was found — nothing in the reviewed code path re-triggers old guidance once the state is nulled.

**Root cause theory (most plausible, not 100% confirmed):** the driver likely backgrounded/minimized the app (screen off, switched apps) instead of tapping the in-app "Stop" control. Because the location watch + keep-awake stay alive as long as the JS process survives in the background, `navigationActive` can remain true indefinitely with no self-correction — so turn-by-turn announcements keep firing for as long as Android lets that background session run (can be hours).

**Fix applied:** added a staleness safety net in the GPS handler — track `navStartRef` (set in `startNavigation`, cleared everywhere nav state is reset) and auto-call `stopNavigation` if the session has run longer than `max(routeDuration * 2.5, 45min)` capped at 4h. This bounds worst-case guidance persistence regardless of how the session was actually abandoned.

**Note:** general safety alerts (speed camera/police/community-report/speeding voice warnings) are intentionally NOT gated by navigation state — they fire on proximity alone, by design, whether or not navigation is active. If a similar complaint recurs, distinguish "turn-by-turn guidance toward an old destination" (bug candidate) from "standalone hazard alert while driving" (working as intended) when following up with the user.
