---
name: ElevenLabs direct API tier gate
description: Direct ElevenLabs API calls for the Keli voice (hzuja6LJVafBxphAzQRB) require creator tier and return 400 from shell/sandbox; the /api/tts server proxy works and caches responses 90 days on device.
---

## Rule
When adding new voice phrases to the Msafiri app, do **not** try to pre-generate MP3s by calling the ElevenLabs API directly from the shell or a CodeExecution sandbox. The Keli voice requires the creator tier and returns `{"status":"free_users_not_allowed"}`.

## Why
The workspace API key is associated with an account that cannot directly clone/use the professional voice. The `/api/tts` server-side proxy (artifacts/api-server) uses the same key but the server-side call succeeds — likely because it bypasses the SDK's tier check. Results are cached on-device for 90 days via `speakPhrase`.

## How to apply
- For new bundled tokens: attempt generation, fall back to on-demand TTS path (no code change needed — `speakPhrase` handles missing EXACT/TOKEN_ASSETS entries automatically by fetching from `/api/tts`).
- If genuinely need bundled MP3s (offline-first or latency), they must be generated on an account with creator tier and committed to `assets/nav-audio/` manually.
- The on-demand path is perfectly acceptable for infrequently-heard phrases (speed zone limits, cleared cues, distance callouts).
