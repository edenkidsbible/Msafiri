---
name: Mapbox + expo-speech navigation migration
description: Navigation routing moved from OSRM to Mapbox Directions API; navigation voice moved from ElevenLabs/Keli clips to expo-speech device TTS. Covers what was removed and what remains.
---

# Mapbox + expo-speech navigation migration

## What changed
- **Routing**: `fetchOSRM` removed entirely. `fetchMapbox` (AppContext.tsx) now calls `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/…` using `EXPO_PUBLIC_MAPBOX_TOKEN`. Uses `maneuver.instruction` directly from Mapbox response — no custom instruction building needed. `buildInstruction` kept as safety-net fallback only.
- **Voice**: `artifacts/mobile/utils/tts.ts` is now a thin expo-speech wrapper (`speakPhrase` → `Speech.speak(…, { language:"en-GB", rate:0.9 })`). `stopNavVoice` → `Speech.stop()`. `prewarmRouteAudio` and `cancelPrewarm` are no-ops kept for API compat.
- **Assets deleted**: entire `artifacts/mobile/assets/nav-audio/` directory (~100 Keli MP3 clips) removed.
- **Notification sounds** (`assets/sounds/confirm_chime.mp3`, `alert_tone.mp3`, `notify_pop.mp3`) are NOT affected — still played via expo-audio in `sound.ts`.

## What still uses OSRM
- `artifacts/mobile/utils/snapToRoad.ts` — snaps community-report coordinates to nearest road via OSRM nearest API. Not navigation routing; acceptable short-term.

## Token
`EXPO_PUBLIC_MAPBOX_TOKEN` — public `pk.…` token, no secret scopes needed. Set in Replit secrets.

**Why:** ElevenLabs two-speaker / clip-cutoff issues made navigation voice unreliable. Mapbox instructions are better quality than OSRM's raw maneuver data (handles u-turns, merges, forks). Device TTS (expo-speech) has zero startup latency vs token fetch.
