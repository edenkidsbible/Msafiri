import { Storage } from '@google-cloud/storage';
import { readFile, readdir } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDECAR = 'http://127.0.0.1:1106';
const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
const DB_URL = process.env.DATABASE_URL;

if (!BUCKET_ID) { console.error('DEFAULT_OBJECT_STORAGE_BUCKET_ID not set'); process.exit(1); }
if (!DB_URL)    { console.error('DATABASE_URL not set'); process.exit(1); }

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
const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

const audioDir = join(__dirname, '../../../attached_assets/generated_audio/course');
const files = (await readdir(audioDir)).filter(f => f.endsWith('.mp3'));
console.log(`Uploading ${files.length} files to gs://${BUCKET_ID}/audio/ ...`);

let ok = 0, failed = 0;
for (const file of files) {
  const lessonSlug = basename(file, '.mp3');
  const gcsPath = `audio/${file}`;
  try {
    await bucket.upload(join(audioDir, file), {
      destination: gcsPath,
      metadata: { contentType: 'audio/mpeg', cacheControl: 'public, max-age=31536000' },
    });
    // Store the GCS path — audio is served via /api/course/audio/:slug (API proxy, no public ACL needed)
    const gcsObjectPath = gcsPath; // e.g. audio/lesson-slug.mp3
    await client.query(
      'UPDATE course_lessons SET audio_url = $1 WHERE slug = $2',
      [gcsObjectPath, lessonSlug]
    );
    console.log(`✓ ${lessonSlug}`);
    ok++;
  } catch (e) {
    console.error(`✗ ${lessonSlug}: ${e.message}`);
    failed++;
  }
}

await client.end();
console.log(`\nDone: ${ok} uploaded, ${failed} failed`);
