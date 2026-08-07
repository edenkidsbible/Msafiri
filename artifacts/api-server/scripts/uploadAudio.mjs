/**
 * uploadAudio.mjs
 *
 * Uploads all committed course-audio MP3s from the local filesystem to
 * Cloudflare R2 and updates the course_lessons.audio_url column so the
 * /api/course/audio/:slug proxy can serve them immediately.
 *
 * Safe to re-run: files already present in R2 are skipped unless --force is passed.
 *
 * Usage (from the repo root):
 *   node artifacts/api-server/scripts/uploadAudio.mjs
 *   node artifacts/api-server/scripts/uploadAudio.mjs --force
 *   node artifacts/api-server/scripts/uploadAudio.mjs --dry-run
 *
 * Required env vars (set as Replit secrets):
 *   R2_ACCOUNT_ID      — Cloudflare account ID
 *   R2_ACCESS_KEY_ID   — R2 access key
 *   R2_SECRET_ACCESS_KEY — R2 secret key
 *   R2_BUCKET_NAME     — R2 bucket name
 *   DATABASE_URL       — Postgres connection string
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readFile, readdir } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FORCE   = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');

const ACCOUNT_ID        = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID     = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME       = process.env.R2_BUCKET_NAME;
const DB_URL            = process.env.DATABASE_URL;

if (!ACCOUNT_ID)        { console.error('R2_ACCOUNT_ID not set');        process.exit(1); }
if (!ACCESS_KEY_ID)     { console.error('R2_ACCESS_KEY_ID not set');     process.exit(1); }
if (!SECRET_ACCESS_KEY) { console.error('R2_SECRET_ACCESS_KEY not set'); process.exit(1); }
if (!BUCKET_NAME)       { console.error('R2_BUCKET_NAME not set');       process.exit(1); }
if (!DB_URL)            { console.error('DATABASE_URL not set');          process.exit(1); }

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

const audioDir = join(__dirname, '../../../attached_assets/generated_audio/course');
const files = (await readdir(audioDir)).filter(f => f.endsWith('.mp3'));
console.log(`${DRY_RUN ? '[DRY-RUN] ' : ''}Uploading ${files.length} files to R2 bucket "${BUCKET_NAME}/audio/" ...`);

let ok = 0, failed = 0, skipped = 0;
for (const file of files) {
  const lessonSlug = basename(file, '.mp3');
  const r2Key = `audio/${file}`;

  if (!FORCE) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: r2Key }));
      // Already exists in R2 — skip upload but still ensure DB is current.
      if (!DRY_RUN) {
        await client.query(
          'UPDATE course_lessons SET audio_url = $1 WHERE slug = $2',
          [r2Key, lessonSlug]
        );
      }
      console.log(`⟳ ${lessonSlug} (already in R2)`);
      skipped++;
      continue;
    } catch { /* not found — upload below */ }
  }

  try {
    const body = await readFile(join(audioDir, file));
    if (!DRY_RUN) {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: r2Key,
        Body: body,
        ContentType: 'audio/mpeg',
        CacheControl: 'public, max-age=31536000',
      }));
      await client.query(
        'UPDATE course_lessons SET audio_url = $1 WHERE slug = $2',
        [r2Key, lessonSlug]
      );
    }
    console.log(`✓ ${lessonSlug}`);
    ok++;
  } catch (e) {
    console.error(`✗ ${lessonSlug}: ${e.message}`);
    failed++;
  }
}

await client.end();
console.log(`\n${DRY_RUN ? '[DRY-RUN] ' : ''}Done: ${ok} uploaded, ${skipped} skipped, ${failed} failed`);
