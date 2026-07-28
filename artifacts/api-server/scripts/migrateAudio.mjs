/**
 * migrateAudio.mjs
 *
 * Uploads all committed course-audio MP3s to a (new) Replit Object Storage
 * bucket and updates the course_lessons.audio_url column so the API proxy
 * can serve them immediately.
 *
 * Safe to re-run: files already present in the bucket are skipped unless
 * --force is passed.
 *
 * Usage (from the repo root):
 *   node artifacts/api-server/scripts/migrateAudio.mjs
 *   node artifacts/api-server/scripts/migrateAudio.mjs --force    # re-upload all
 *   node artifacts/api-server/scripts/migrateAudio.mjs --dry-run  # plan only
 *
 * Required env vars (already set as Replit secrets in the dev environment):
 *   DEFAULT_OBJECT_STORAGE_BUCKET_ID  — target bucket name
 *   DATABASE_URL                      — Postgres connection string
 *
 * The sidecar auth endpoint (http://127.0.0.1:1106) is only available when
 * running inside a Replit workspace or deployment — this script will not work
 * from an external machine. On a fresh deployment, run it once from the Shell
 * tab after setting the two secrets above.
 */

import { Storage }         from '@google-cloud/storage';
import { readdir }         from 'fs/promises';
import { join, basename, dirname } from 'path';
import { fileURLToPath }   from 'url';
import pg                  from 'pg';

// ── Config ────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/** MP3s committed to the repo — source of truth for migration. */
const AUDIO_DIR = join(__dirname, '../public/course-audio');

/** GCS object prefix used by the API proxy route /api/course/audio/:slug */
const GCS_PREFIX = 'audio';

const FORCE   = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const DB_URL    = process.env.DATABASE_URL;

if (!BUCKET_ID) {
  console.error('✗  DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set.');
  console.error('   Add it as a Replit secret, then re-run this script.');
  process.exit(1);
}
if (!DB_URL) {
  console.error('✗  DATABASE_URL is not set.');
  process.exit(1);
}

// ── GCS client (Replit sidecar auth) ─────────────────────────────────────────

const SIDECAR = 'http://127.0.0.1:1106';

const storage = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${SIDECAR}/token`,
    type: 'external_account',
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: { type: 'json', subject_token_field_name: 'access_token' },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

const bucket = storage.bucket(BUCKET_ID);

// ── DB client ─────────────────────────────────────────────────────────────────

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function objectExists(gcsPath) {
  const [exists] = await bucket.file(gcsPath).exists();
  return exists;
}

function pad(n, width = 2) {
  return String(n).padStart(width, ' ');
}

// ── Main ──────────────────────────────────────────────────────────────────────

const files = (await readdir(AUDIO_DIR))
  .filter(f => f.endsWith('.mp3'))
  .sort();

console.log(`\nMsafiri Kenya — course audio migration`);
console.log(`Bucket : gs://${BUCKET_ID}/${GCS_PREFIX}/`);
console.log(`Source : ${AUDIO_DIR}`);
console.log(`Files  : ${files.length} MP3s`);
if (DRY_RUN)  console.log(`Mode   : DRY RUN (no changes)`);
else if (FORCE) console.log(`Mode   : FORCE (re-upload all)`);
else          console.log(`Mode   : incremental (skip existing)`);
console.log('');

// Fetch all current audio_url values so we can report what would change.
const { rows: lessons } = await db.query(
  'SELECT slug, audio_url FROM course_lessons ORDER BY slug'
);
const dbMap = Object.fromEntries(lessons.map(r => [r.slug, r.audio_url]));

let uploaded = 0, skipped = 0, dbUpdated = 0, failed = 0;
const problems = [];

for (let i = 0; i < files.length; i++) {
  const file     = files[i];
  const slug     = basename(file, '.mp3');
  const gcsPath  = `${GCS_PREFIX}/${file}`;
  const label    = `[${pad(i + 1)}/${files.length}] ${slug}`;

  try {
    // ── Upload step ──────────────────────────────────────────────────────────
    let alreadyUploaded = false;
    if (!FORCE) {
      alreadyUploaded = await objectExists(gcsPath);
    }

    if (alreadyUploaded) {
      process.stdout.write(`  ↷  ${label}\n`);
      skipped++;
    } else if (DRY_RUN) {
      process.stdout.write(`  ○  ${label}  (would upload)\n`);
      uploaded++;          // count as "would upload" for summary
    } else {
      await bucket.upload(join(AUDIO_DIR, file), {
        destination: gcsPath,
        metadata: {
          contentType: 'audio/mpeg',
          // Immutable for one year — filenames are content-addressed by lesson slug
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
      process.stdout.write(`  ✓  ${label}\n`);
      uploaded++;
    }

    // ── DB update step ───────────────────────────────────────────────────────
    // The audio_url column stores the GCS object path (e.g. audio/lesson-slug.mp3).
    // Update it whenever the stored value differs from what we just uploaded.
    const currentUrl = dbMap[slug];
    const targetUrl  = gcsPath;

    if (currentUrl !== targetUrl) {
      if (DRY_RUN) {
        process.stdout.write(`       DB: ${currentUrl ?? '(null)'} → ${targetUrl}  (dry run)\n`);
        dbUpdated++;
      } else {
        const result = await db.query(
          'UPDATE course_lessons SET audio_url = $1 WHERE slug = $2',
          [targetUrl, slug]
        );
        if (result.rowCount > 0) {
          process.stdout.write(`       DB: ${currentUrl ?? '(null)'} → ${targetUrl}\n`);
          dbUpdated++;
        } else {
          // File exists but no matching DB row — warn without failing.
          process.stdout.write(`       ⚠  No DB row for slug "${slug}" — file uploaded but audio_url not set\n`);
          problems.push(`No DB row for slug: ${slug}`);
        }
      }
    }
  } catch (err) {
    process.stdout.write(`  ✗  ${label}: ${err.message}\n`);
    failed++;
    problems.push(`${slug}: ${err.message}`);
  }
}

await db.end();

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log('─────────────────────────────────────────');
if (DRY_RUN) {
  console.log(`Would upload : ${uploaded}`);
  console.log(`Would skip   : ${skipped} (already in bucket)`);
  console.log(`DB rows to update : ${dbUpdated}`);
} else {
  console.log(`Uploaded   : ${uploaded}`);
  console.log(`Skipped    : ${skipped} (already in bucket)`);
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
