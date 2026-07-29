---
name: Kenya road-name voice clips & code mapping
description: Pre-generated Keli road-name clips, route-code→common-name mapping, and Google instruction rewrite rules
---

- Kenyans never hear route codes ("A1", "B9"): the api-server routing route rewrites every Google instruction — codes map to common point-to-point names (segmented by nearest anchor coord for codes spanning multiple stretches); unmapped codes are DROPPED, never voiced.
- Google Routes instructions arrive as "Head north on Uhuru Hwy/A104\nPass by X (on the right)": only the first line is kept, road extracted after onto/on/toward, abbreviations expanded (Rd→Road, Hwy→Highway, …), then a final scrub pass removes any surviving code.
- **Why abbreviation expansion matters:** pre-generated clips + the mobile djb2 cache key are computed on the full-word title-cased name + "." ("Ngong Road."); "Ngong Rd" would miss the cache.
- Pre-generated Keli clips (~290, one-time via Replit ElevenLabs proxy on credits) live in `artifacts/api-server/pregen-tts/<djb2>.mp3` + manifest.json; /api/tts serves a hit from disk (header `X-Tts-Source: pregen`) before rate-limit or ElevenLabs. Hash function must stay byte-identical to mobile utils/tts.ts hashText.
- The direct ELEVENLABS_API_KEY still fails 400 "creator tier required" for the Keli voice, so on-demand /api/tts for names OUTSIDE the pregen set currently 502s — pregen coverage is the only working Keli source until the key is upgraded.
