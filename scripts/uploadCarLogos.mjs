/**
 * uploadCarLogos.mjs — Download brand logos from worldvectorlogo.com (SVG),
 * convert to transparent-background PNG at 400×200, and upload to R2
 * under car-logos/{makeId}.png
 *
 * Usage: NODE_PATH=artifacts/api-server/node_modules node scripts/uploadCarLogos.mjs
 * Pass --force to re-upload already-uploaded logos.
 */

import { createRequire } from "module";
import https from "https";
import http from "http";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const sharp = require("sharp");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const FORCE = process.argv.includes("--force");

// ── Logo source mapping ───────────────────────────────────────────────────────
const LOGO_SOURCES = {
  "audi":          "audi-2",
  "bmw":           "bmw-1",
  "chevrolet":     "chevrolet",
  "daihatsu":      "daihatsu",
  "ford":          "ford-1",
  "honda":         "honda",
  "hyundai":       "hyundai",
  "isuzu":         "isuzu",
  "jaguar":        "jaguar",
  "jeep":          "jeep",
  "kia":           "kia",
  "land-rover":    "land-rover",
  "lexus":         "lexus",
  "mazda":         "mazda",
  "mercedes-benz": "mercedes-benz-1",
  "mitsubishi":    "mitsubishi",
  "nissan":        "nissan",
  "peugeot":       "peugeot-1",
  "porsche":       "porsche-1",
  "renault":       "renault",
  "subaru":        "subaru",
  "suzuki":        "suzuki",
  "toyota":        "toyota-1",
  "volkswagen":    "volkswagen-1",
  "volvo":         "volvo",
};

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) throw new Error("R2_ACCOUNT_ID not set");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

const BUCKET = process.env.R2_BUCKET_NAME;

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const req = proto.get(url, {
      headers: { "User-Agent": "MsafiriCarLogoBot/1.0", "Accept": "image/svg+xml,image/*,*/*" },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

async function alreadyUploaded(client, makeId) {
  if (FORCE) return false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: `car-logos/${makeId}.png` }));
    return true;
  } catch { return false; }
}

async function main() {
  const client = getR2Client();
  const results = { ok: [], skipped: [], failed: [] };

  for (const [makeId, slug] of Object.entries(LOGO_SOURCES)) {
    const url = `https://cdn.worldvectorlogo.com/logos/${slug}.svg`;
    process.stdout.write(`  ${makeId.padEnd(16)} `);

    try {
      if (await alreadyUploaded(client, makeId)) {
        console.log("⏭  already in R2");
        results.skipped.push(makeId);
        continue;
      }

      const svgBuf = await fetchBuffer(url);

      // Convert SVG → transparent-background PNG, max 400×200
      // Keep the logo's original colors — no flatten; transparent background
      // is intentional so logos render well against both dark and light UIs.
      const pngBuf = await sharp(svgBuf, { density: 300 })
        .resize(400, 200, {
          fit: "inside",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9 })
        .toBuffer();

      await client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `car-logos/${makeId}.png`,
        Body: pngBuf,
        ContentType: "image/png",
      }));
      console.log(`✅  uploaded (${Math.round(pngBuf.length / 1024)} KB)`);
      results.ok.push(makeId);
    } catch (err) {
      console.log(`❌  ${err.message}`);
      results.failed.push(makeId);
    }
  }

  console.log("\n──────────────────────────────");
  console.log(`✅  Uploaded:  ${results.ok.length}  (${results.ok.join(", ")})`);
  console.log(`⏭  Skipped:   ${results.skipped.length}  (${results.skipped.join(", ")})`);
  if (results.failed.length) {
    console.log(`❌  Failed:    ${results.failed.length}  (${results.failed.join(", ")})`);
    console.log("    These makes will show an emoji fallback.");
  }
}

main().catch(err => { console.error(err); process.exit(1); });
