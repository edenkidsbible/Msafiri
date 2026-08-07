import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_NAME;

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  console.error("Missing R2 credentials:", { accountId: !!accountId, accessKeyId: !!accessKeyId, secretAccessKey: !!secretAccessKey, bucket: !!bucket });
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const BASE_DIR = join(process.cwd(), "../../attached_assets/generated_images/cars");

function collectFiles(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) result.push(...collectFiles(full));
    else if (entry.endsWith(".png")) result.push(full);
  }
  return result;
}

const files = collectFiles(BASE_DIR);
console.log(`Found ${files.length} PNG files to upload`);

let uploaded = 0, skipped = 0, failed = 0;

const BATCH = 20;
for (let i = 0; i < files.length; i += BATCH) {
  const batch = files.slice(i, i + BATCH);
  await Promise.allSettled(batch.map(async (filePath) => {
    const rel = filePath.replace(BASE_DIR + "/", "");
    const parts = rel.split("/");
    const makeId = parts[0];
    const modelId = parts[1]?.replace(".png", "");
    if (!makeId || !modelId) { skipped++; return; }
    const key = `car-images/${makeId}/${modelId}.png`;
    try {
      const body = readFileSync(filePath);
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: body, ContentType: "image/png",
      }));
      uploaded++;
    } catch (err) {
      console.error(`FAILED ${key}:`, err.message);
      failed++;
    }
  }));
  console.log(`Progress: ${Math.min(i + BATCH, files.length)}/${files.length}`);
}

console.log(`\nDone! Uploaded: ${uploaded}, Skipped: ${skipped}, Failed: ${failed}`);
