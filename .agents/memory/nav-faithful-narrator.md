---
name: Phase 1 Faithful Narrator — navigation voice overhaul
description: What was built and the durable design rules for the along-road voice cue engine.
---

## What was built (Phase 1 — all OTA-shippable)

### RouteStep / AppRoute shape changes
- `RouteStep` gains `maneuverType: string`, `roadName: string`, `stepAlongRouteM: number`
- `AppRoute` gains `cumDist: number[]`
- All populated in `fetchOSRM` — cumDist built from coords, then each step's location is projected onto the polyline to get `stepAlongRouteM`

### Along-road distance replaces straight-line haversine
`stepAlongRouteM - driverAlongM` (computed fresh each GPS tick in `handleLocation` using route.cumDist + windowed `projectOntoRoute`) is the cue trigger distance.  Falls back to haversine when cumDist absent.  Fixes early/late signals on curves.

**Why:** straight-line from driver GPS to maneuver point reads much shorter on a tight bend than the actual road distance remaining.

### Three-cue gating discipline
- ANNOUNCE: fires freely (far from junction; previous cues are done)
- REMIND: gated on `!isNavVoicePlaying()` — waits for ANNOUNCE clip to finish before firing.  Without this, rapid GPS ticks while ANNOUNCE plays would kill it mid-sentence.
- NOW: always preempts — driver is at the junction and needs the word immediately.

### Compound instructions
When `step.distanceM < 100` (current leg < 100 m before next maneuver):
- ANNOUNCE: "Turn left onto X, then turn right onto Y"
- REMIND: "Turn left onto X, then turn right"
- NOW: just "Turn left" (single junction word, driver is executing it)

### Post-turn confirmation
After each step advances (driver passes maneuver point), speak "Continue on [roadName]" if:
- road is named, next leg ≥ 250 m, next step isn't arrive, and voice isn't currently playing
Gives the driver confirmation they turned correctly, then goes silent until next decision point.

### U-turn detection
`buildInstruction` now handles `maneuver.type === "uturn"` AND `maneuver.type === "turn" + modifier === "uturn"` → "Make a U-turn [onto X]".

### Post-reroute grace period
`rerouteGraceUntilRef` set to `Date.now() + 10_000` when reroute triggers; off-route detection skips while `Date.now() < rerouteGraceUntilRef`.  Prevents reroute loops at complex junctions.

### tts.ts hardening
- `isNavVoicePlaying()` exported — `activePlayer !== null`
- expo-speech fallback removed; road-name segment silently skipped on persistent cache miss (Keli maneuver token still plays without road name)
- `resolveRawClip` retries 3× with 1 s back-off before returning null

## Phase 2 — Pre-built full-sentence clips (DONE)

### prebuildRouteAudio
- Fetches each `step.instruction` as ONE complete Keli MP3 before nav starts (uses same `resolveRawClip` + 90-day disk cache)
- Called from `startNavigation` (now async) with an 8 s timeout
- Shows `voicePreparing: boolean` state → "Preparing…" spinner on Start button in index.tsx
- `stopNavigation` calls `cancelPrewarm()` + `setVoicePreparing(false)` to abort mid-prebuild

### speakPhrase fast paths
1. Full-text match: `sessionCache.get(text)` → play as single clip (covers REMIND — most important)
2. Prefix match: "In X metres, {instruction}" → play distance tokens, then pre-built instruction clip
3. Standard segment fallback for anything not yet pre-built (reroutes, first few seconds of nav)

### Key design rule
`sessionCache` (Map<text→filePath>) is the bridge between prebuild and speakPhrase; both use the exact `step.instruction` string as the cache key, so the lookup always matches.

## Phase 3 — All-Keli offline audio (DONE, pending Keli regeneration)

### Bundled clips
- Token vocabulary now ~120 clips (added all cleared-alert phrases to TOKENS list in `generateNavTokens.mjs`)
- Existing bundled files still use **Alice** voice — to switch all to Keli, run: `node artifacts/mobile/scripts/generateNavTokens.mjs --force` with a creator-tier ElevenLabs API key. The script now calls the `/api/tts` proxy (Keli, centralised settings) instead of ElevenLabs directly.
- 6 new cleared clips (checkpoint-cleared, camera-cleared, traffic-cleared, incident-cleared, road-closure-cleared, incident-ahead-cleared) are in TOKENS but **not yet in TOKEN_ASSETS** (files don't exist yet). Add `require()` entries to TOKEN_ASSETS in `utils/tts.ts` after generating them.

### expo-speech removed
- Import and `Speech.stop()` call removed from `utils/tts.ts`. Package removed from `package.json`. No device-TTS fallback anywhere.

### Reroute flow
- `speakText("Recalculating route.")` now fires at the TOP of the reroute callback (before the OSRM fetch) — was previously silent.
- After new route arrives: `void prebuildRouteAudio(primary.steps)` fires alongside the existing `prewarmRouteAudio` call. First steps fetch first (natural array order). Interim cues use bundled token without road name.

### Cleared-alert EXACT entries
Five cleared phrases now map to bundled tokens in `EXACT` lookup: police-cleared, accident-cleared, roadblock-cleared, roadworks-cleared, hazard-cleared. The remaining six fall through to on-demand TTS until clips are generated.
