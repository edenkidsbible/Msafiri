---
name: Course audio generation
description: How the 64-lesson driving course audio was generated, stored, and served
---

## Narration formatter — key lessons
- **Script location**: `artifacts/api-server/scripts/buildNarration.mjs` — run with `node` from that dir; writes `attached_assets/narration_texts.json`
- **Pipeline is recursive** (`breakText(text, depth)`): each split produces pieces that are re-processed up to depth 5
- **Priority order matters**: colon-list split (E) must run BEFORE action-phrase split (F), otherwise `"A: RED means STOP  B: RED…"` gets split on `STOP` before the `A:/B:` boundary is detected
- **Root patterns fixed**:
  1. `(b)/(c)/…` parenthetical fusion → `PAREN_SPLIT_RE` at depth 0 only
  2. Wide whitespace (≥4 spaces, PDF columns) → `/ {4,}/` split, then recurse
  3. Repeating n-gram anywhere in text (not just at position 0) → scan all positions, `hits >= 3`
  4. `"Category header I intend to X"` header-item fusion → action-phrase regex
  5. `"Triangle: Warning Circle: Giving an order"` → uppercase-colon-list split
- **overwrite flag creates `_2` files** when target file already exists — rename after generation: `for f in *_2.mp3; do mv "$f" "${f/_2.mp3/.mp3}"; done`

## Voice & model
- Voice: **Keli** (`hzuja6LJVafBxphAzQRB`) — closest available African English on ElevenLabs (no Kenyan-specific voice)
- Model: **Flash v2.5** (`eleven_flash_v2_5`) — user confirmed good quality; significantly cheaper than Multilingual v2

## Narration text extraction
Content blocks are JSONB arrays typed `paragraph | callout | list | image`. Narration skips `image` blocks; text from `callout`/`paragraph` `.text` fields + `list.items` arrays is joined with `\n\n` separators.

## Storage
- Files uploaded to Replit Object Storage (GCS bucket) under `audio/` prefix
- Bucket has **public access prevention enforced** — `makePublic()` / allUsers ACL throws error
- Audio URLs stored in `course_lessons.audio_url` as GCS object paths (e.g. `audio/lesson-slug.mp3`)
- Audio served via **API proxy**: `GET /api/course/audio/:slug` streams from GCS with Range request support
- `GET /api/course/lessons/:slug` returns `audioUrl: "/course/audio/<slug>"` (relative, consumed as `${API_BASE}${audioUrl}` in mobile)

**Why:** Public ACL is blocked by bucket policy. The API proxy approach works for both dev and production without needing public GCS ACLs.

## Slug truncation gotcha
TTS output filenames were capped at 60 chars (`slug.substring(0, 60)`). 10 lessons had slugs >60 chars — their DB `audio_url` must reference the truncated filename, not the full slug. Fixed by matching truncated filename back to full DB slug after upload.

## AudioPlayer component
- Location: `artifacts/mobile/components/AudioPlayer.tsx`
- Uses `useAudioPlayer` + `useAudioPlayerStatus` from `expo-audio`
- Props: `audioUrl: string` (full URL)
- Integrated into `artifacts/mobile/app/course/[slug].tsx` between meta row and content blocks, conditionally rendered when `lesson.audioUrl` is non-null

## DB schema
- Column: `audio_url TEXT` on `course_lessons` (added via raw SQL `ALTER TABLE … ADD COLUMN IF NOT EXISTS`)
- Drizzle schema updated in `lib/db/src/schema/course.ts`

## object-storage template
- Files copied to `artifacts/api-server/src/lib/objectStorage.ts` + `objectAcl.ts`
- `storage.ts` route template NOT wired into `routes/index.ts` — it requires `RequestUploadUrlBody`/`RequestUploadUrlResponse` from `@workspace/api-zod` (codegen step) which hasn't been run yet. Wire it later after running codegen.
