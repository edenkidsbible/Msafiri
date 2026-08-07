/**
 * migrateAudio.mjs
 *
 * Uploads all committed course-audio MP3s to Cloudflare R2 and updates the
 * course_lessons.audio_url column so the API proxy can serve them immediately.
 *
 * Safe to re-run: files already present in R2 are skipped unless --force is passed.
 *
 * Usage (from the repo root):
 *   node artifacts/api-server/scripts/migrateAudio.mjs
 *   node artifacts/api-server/scripts/migrateAudio.mjs --force    # re-upload all
 *   node artifacts/api-server/scripts/migrateAudio.mjs --dry-run  # plan only
 *
 * Required env vars (set as Replit secrets):
 *   R2_ACCOUNT_ID        — Cloudflare account ID
 *   R2_ACCESS_KEY_ID     — R2 access key
 *   R2_SECRET_ACCESS_KEY — R2 secret key
 *   R2_BUCKET_NAME       — R2 bucket name
 *   DATABASE_URL         — Postgres connection string
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readFile, readdir } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FORCE   = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');

/** MP3s committed to the repo — source of truth for migration. */
const AUDIO_DIR = join(__dirname, '../public/course-audio');

/** R2 object prefix used by the API proxy route /api/course/audio/:slug */
const R2_PREFIX = 'audio';

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

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();

let files;
try {
  files = (await readdir(AUDIO_DIR)).filter(f => f.endsWith('.mp3'));
} catch {
  console.error(`Audio directory not found: ${AUDIO_DIR}`);
  await db.end();
  process.exit(1);
}

console.log(`${DRY_RUN ? '[DRY-RUN] ' : ''}Found ${files.length} MP3s in ${AUDIO_DIR}`);
console.log(`Target bucket: ${BUCKET_NAME} / prefix: ${R2_PREFIX}/`);
console.log('─────────────────────────────────────────');

let uploaded = 0, skipped = 0, failed = 0, dbUpdated = 0;
const problems = [];

for (const file of files) {
  const slug = basename(file, '.mp3');
  const r2Key = `${R2_PREFIX}/${file}`;
  const label = `${slug}`;
  let shouldUpload = FORCE;

  if (!FORCE) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: r2Key }));
      process.stdout.write(`  ⟳  ${label}: already in R2\n`);
      skipped++;
      shouldUpload = false;
    } catch {
      shouldUpload = true; // Not found — upload
    }
  }

  try {
    if (shouldUpload) {
      const body = await readFile(join(AUDIO_DIR, file));
      if (!DRY_RUN) {
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: r2Key,
          Body: body,
          ContentType: 'audio/mpeg',
          CacheControl: 'public, max-age=31536000',
        }));
        process.stdout.write(`  ✓  ${label}: uploaded (${(body.length / 1024).toFixed(1)} KB)\n`);
      } else {
        process.stdout.write(`  ✓  ${label}: would upload\n`);
      }
      uploaded++;
    }

    // Update DB regardless of whether we uploaded (idempotent)
    if (!DRY_RUN) {
      const result = await db.query(
        'UPDATE course_lessons SET audio_url = $1 WHERE slug = $2',
        [r2Key, slug]
      );
      if (result.rowCount > 0) {
        process.stdout.write(`       DB: audio_url → ${r2Key}\n`);
        dbUpdated++;
      } else {
        process.stdout.write(`       ⚠  No DB row for slug "${slug}" — uploaded but audio_url not set\n`);
        problems.push(`No DB row for slug: ${slug}`);
      }
    }
  } catch (err) {
    process.stdout.write(`  ✗  ${label}: ${err.message}\n`);
    failed++;
    problems.push(`${slug}: ${err.message}`);
  }
}

await db.end();

console.log('');
console.log('─────────────────────────────────────────');
if (DRY_RUN) {
  console.log(`Would upload : ${uploaded}`);
  console.log(`Would skip   : ${skipped} (already in R2)`);
  console.log(`DB rows to update : ${dbUpdated}`);
} else {
  console.log(`Uploaded   : ${uploaded}`);
  console.log(`Skipped    : ${skipped} (already in R2)`);
  console.log(`DB updated : ${dbUpdated} rows`);
  console.log(`Failed     : ${failed}`);
}

if (problems.length > 0) {
  console.log('\nProblems:');
  problems.forEach(p => console.log(`  • ${p}`));
  process.exit(1);
} else {
  console.log('\n✓ Migration complete.');
}
