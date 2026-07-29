#!/usr/bin/env tsx
/**
 * validatePregenClips.ts
 *
 * CI guard: verifies that the pregen-tts/ clip set is in lockstep with the
 * curated road-name list in kenyaRoads.ts.  Three checks are performed:
 *
 *  1. Every KENYA_ROAD_NAMES entry has a matching pregen-tts/<hash>.mp3.
 *     Missing clips mean that road will fall back to on-demand ElevenLabs,
 *     which currently 502s for the Keli voice (creator-tier required).
 *
 *  2. The hashText() djb2 implementation in src/routes/tts.ts and
 *     artifacts/mobile/utils/tts.ts are byte-identical (after whitespace
 *     normalisation).  A drift here silently breaks every cache lookup.
 *
 *  3. (Warning only) Orphaned clips in pregen-tts/ that have no
 *     corresponding road name are listed — they waste disk space but do not
 *     break anything.
 *
 * Exit 0 = all checks passed.
 * Exit 1 = missing clips or hash-function divergence.
 *
 * Run:
 *   pnpm --filter @workspace/api-server validate:pregen
 * or from the repo root:
 *   cd artifacts/api-server && npx tsx scripts/validatePregenClips.ts
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { KENYA_ROAD_NAMES } from "../src/data/kenyaRoads.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREGEN_DIR = path.resolve(__dirname, "../pregen-tts");

// ─── djb2 hash (must stay byte-identical to hashText in routes/tts.ts) ───────
// Intentionally inlined here so the script itself is a reference implementation
// that can be compared against both tts files without a circular import.
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h) ^ text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip all whitespace so minor formatting differences don't cause false divergence */
function normalise(src: string): string {
  return src.replace(/\s+/g, "");
}

/** Extract the body of `function hashText(...)` from a TypeScript source file */
function extractHashFn(filePath: string): string | null {
  let src: string;
  try {
    src = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  // Match from "function hashText(" to the closing "}" that sits on its own line
  const match = src.match(/function hashText\([^)]*\)[^{]*\{[\s\S]+?\n\}/);
  return match ? normalise(match[0]) : null;
}

// ─── Check 1: every KENYA_ROAD_NAMES entry has a matching clip ────────────────
console.log(`\nChecking ${KENYA_ROAD_NAMES.length} road names against ${PREGEN_DIR} …\n`);

const missing: string[] = [];
const expected = new Set<string>();

for (const name of KENYA_ROAD_NAMES) {
  // Clips are keyed on "Road Name." — the same text string the mobile app sends
  // to /api/tts as the `raw` segment (title-cased + period appended).
  const text = `${name}.`;
  const hash = hashText(text);
  expected.add(hash);
  const filePath = path.join(PREGEN_DIR, `${hash}.mp3`);
  if (!fs.existsSync(filePath)) {
    missing.push(`  ✗ "${name}"  →  expected ${hash}.mp3`);
  }
}

let failed = false;

if (missing.length > 0) {
  console.error(`❌  ${missing.length} of ${KENYA_ROAD_NAMES.length} road name(s) have no pre-generated clip:\n`);
  missing.forEach((m) => console.error(m));
  console.error(`
  To fix: re-run the pregen generation script for the missing names, then
  commit the new .mp3 files and update pregen-tts/manifest.json.
`);
  failed = true;
} else {
  console.log(`✅  All ${KENYA_ROAD_NAMES.length} road names have a matching pregen clip.`);
}

// ─── Check 2: hashText() is byte-identical in server and mobile ───────────────

const SERVER_TTS = path.resolve(__dirname, "../src/routes/tts.ts");
const MOBILE_TTS = path.resolve(__dirname, "../../mobile/utils/tts.ts");

const serverFn = extractHashFn(SERVER_TTS);
const mobileFn = extractHashFn(MOBILE_TTS);

if (!serverFn) {
  console.error(`❌  Could not extract hashText() from server tts file:\n    ${SERVER_TTS}`);
  failed = true;
} else if (!mobileFn) {
  console.error(`❌  Could not extract hashText() from mobile tts file:\n    ${MOBILE_TTS}`);
  failed = true;
} else if (serverFn !== mobileFn) {
  console.error("❌  hashText() has diverged between server and mobile:\n");
  console.error("  Server (normalised):", serverFn.slice(0, 200));
  console.error("  Mobile (normalised):", mobileFn.slice(0, 200));
  console.error(`
  The server's pregen-tts filenames will no longer match what the mobile
  app requests.  Update one file so both implementations are identical.
`);
  failed = true;
} else {
  console.log("✅  hashText() is byte-identical in server and mobile tts files.");
}

// ─── Check 3 (warning): orphaned clips not referenced by KENYA_ROAD_NAMES ─────

const allMp3s = fs.readdirSync(PREGEN_DIR).filter((f) => f.endsWith(".mp3"));
const orphaned = allMp3s.filter((f) => !expected.has(f.replace(/\.mp3$/, "")));

if (orphaned.length > 0) {
  console.warn(`\n⚠️   ${orphaned.length} orphaned clip(s) in pregen-tts/ (safe to delete):`);
  const preview = orphaned.slice(0, 8);
  preview.forEach((f) => {
    // Try to reverse-lookup from manifest.json for a human-readable name
    let label = f;
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(PREGEN_DIR, "manifest.json"), "utf8")
      ) as Record<string, string>;
      const hash = f.replace(/\.mp3$/, "");
      if (manifest[hash]) label = `${f}  (${manifest[hash]})`;
    } catch { /* manifest missing or malformed — hash only */ }
    console.warn(`  ${label}`);
  });
  if (orphaned.length > 8) console.warn(`  … and ${orphaned.length - 8} more`);
}

// ─── Result ───────────────────────────────────────────────────────────────────

if (failed) {
  console.error("\n❌  Pregen clip validation FAILED.\n");
  process.exit(1);
} else {
  console.log("\n✅  Pregen clip validation passed.\n");
}
