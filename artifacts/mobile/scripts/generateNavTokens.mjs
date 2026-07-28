/**
 * One-time script: generates the Keli (ElevenLabs) navigation audio token library.
 * Run from the repo root:
 *   node artifacts/mobile/scripts/generateNavTokens.mjs
 *
 * Requires ELEVENLABS_API_KEY in the environment.
 * Outputs to: artifacts/mobile/assets/nav-audio/<key>.mp3
 * Skips any file that already exists (idempotent).
 */

import { writeFile, mkdir, access } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "../assets/nav-audio");

const VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2"; // Alice — British, clear/engaging, free-tier
const MODEL_ID  = "eleven_flash_v2_5";

const VOICE_SETTINGS = {
  stability:        0.45,
  similarity_boost: 0.82,
  style:            0,
  use_speaker_boost: true,
};

// ── Complete token list ───────────────────────────────────────────────────────
// key → text sent to ElevenLabs TTS.
// Keys without a trailing period/comma are mid-phrase clips (road-name follows).
export const TOKENS = [
  // Distance intro prefixes (comma creates natural pause)
  { key: "in-100m",  text: "In 100 metres," },
  { key: "in-150m",  text: "In 150 metres," },
  { key: "in-200m",  text: "In 200 metres," },
  { key: "in-250m",  text: "In 250 metres," },
  { key: "in-300m",  text: "In 300 metres," },
  { key: "in-350m",  text: "In 350 metres," },

  // Standalone maneuvers (complete sentence — no road name follows)
  { key: "turn-left",           text: "Turn left." },
  { key: "turn-right",          text: "Turn right." },
  { key: "turn-slight-left",    text: "Turn slightly left." },
  { key: "turn-slight-right",   text: "Turn slightly right." },
  { key: "turn-sharp-left",     text: "Turn sharp left." },
  { key: "turn-sharp-right",    text: "Turn sharp right." },
  { key: "u-turn",              text: "Make a U-turn." },
  { key: "continue",            text: "Continue." },
  { key: "keep-left",           text: "Keep left at the fork." },
  { key: "keep-right",          text: "Keep right at the fork." },
  { key: "keep-straight",       text: "Keep straight at the fork." },
  { key: "end-of-road-left",    text: "Turn left at the end of the road." },
  { key: "end-of-road-right",   text: "Turn right at the end of the road." },
  { key: "merge-left",          text: "Merge left." },
  { key: "merge-right",         text: "Merge right." },

  // Maneuvers + "onto" (road name follows — no period, open inflection)
  { key: "turn-left-onto",          text: "Turn left onto" },
  { key: "turn-right-onto",         text: "Turn right onto" },
  { key: "turn-slight-left-onto",   text: "Turn slightly left onto" },
  { key: "turn-slight-right-onto",  text: "Turn slightly right onto" },
  { key: "turn-sharp-left-onto",    text: "Turn sharp left onto" },
  { key: "turn-sharp-right-onto",   text: "Turn sharp right onto" },
  { key: "u-turn-onto",             text: "Make a U-turn onto" },
  { key: "continue-onto",           text: "Continue onto" },
  { key: "continue-on",             text: "Continue on" },
  { key: "merge-left-onto",         text: "Merge left onto" },
  { key: "merge-right-onto",        text: "Merge right onto" },

  // Roundabout — standalone
  { key: "roundabout-1st",  text: "At the roundabout, take the 1st exit." },
  { key: "roundabout-2nd",  text: "At the roundabout, take the 2nd exit." },
  { key: "roundabout-3rd",  text: "At the roundabout, take the 3rd exit." },
  { key: "roundabout-4th",  text: "At the roundabout, take the 4th exit." },
  { key: "roundabout-5th",  text: "At the roundabout, take the 5th exit." },

  // Roundabout — with road name following
  { key: "roundabout-1st-onto",  text: "At the roundabout, take the 1st exit onto" },
  { key: "roundabout-2nd-onto",  text: "At the roundabout, take the 2nd exit onto" },
  { key: "roundabout-3rd-onto",  text: "At the roundabout, take the 3rd exit onto" },
  { key: "roundabout-4th-onto",  text: "At the roundabout, take the 4th exit onto" },
  { key: "roundabout-5th-onto",  text: "At the roundabout, take the 5th exit onto" },

  // Roundabout exit-count cues (speakRoundaboutExitCue in sound.ts)
  { key: "the-1st-exit",   text: "The 1st exit." },
  { key: "the-2nd-exit",   text: "The 2nd exit." },
  { key: "the-3rd-exit",   text: "The 3rd exit." },
  { key: "the-4th-exit",   text: "The 4th exit." },
  { key: "the-5th-exit",   text: "The 5th exit." },
  { key: "the-6th-exit",   text: "The 6th exit." },
  { key: "take-this-exit", text: "Take this exit." },

  // Fixed navigation phrases
  { key: "approaching-destination", text: "Approaching your destination." },
  { key: "arrived",                 text: "You have arrived at your destination." },
  { key: "arriving",                text: "Arriving at your destination." },
  { key: "navigation-started",      text: "Navigation started." },
  { key: "recalculating",           text: "Recalculating route." },
  { key: "report-submitted",        text: "Report submitted." },
  { key: "speed-limit-exceeded",    text: "You are exceeding the speed limit." },

  // Road alert phrases
  { key: "speed-camera-ahead",       text: "Speed camera ahead." },
  { key: "speed-camera-ahead-slow",  text: "Speed camera ahead. Reduce your speed." },
  { key: "police-ahead",             text: "Police checkpoint ahead." },
  { key: "police-ahead-slow",        text: "Police checkpoint ahead. Reduce your speed." },
  { key: "speed-zone-ahead",         text: "Speed zone ahead." },
  { key: "accident-ahead",           text: "Accident reported ahead." },
  { key: "pothole-ahead",            text: "Pothole ahead." },
  { key: "roadblock-ahead",          text: "Road block ahead." },
  { key: "police-reported-ahead",    text: "Police reported ahead." },
  { key: "alcoblow-ahead",           text: "Alcoblow checkpoint ahead." },
  { key: "roadworks-ahead",          text: "Road works ahead." },
  { key: "camera-reported-ahead",    text: "Speed camera reported ahead." },
  { key: "traffic-ahead",            text: "Traffic congestion ahead." },
  { key: "hazard-ahead",             text: "Road hazard ahead." },
  { key: "debris-ahead",             text: "Debris on road ahead." },
  { key: "breakdown-ahead",          text: "Vehicle breakdown ahead." },
  { key: "weather-hazard-ahead",     text: "Weather hazard ahead." },
  { key: "road-closure-ahead",       text: "Road closure ahead." },
];

// ── ElevenLabs API call ───────────────────────────────────────────────────────

async function generateClip(text, apiKey) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: VOICE_SETTINGS,
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("❌  ELEVENLABS_API_KEY not set");
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

const totalChars = TOKENS.reduce((s, t) => s + t.text.length, 0);
console.log(`\n🎙  Generating ${TOKENS.length} navigation audio clips`);
console.log(`   Total characters: ${totalChars.toLocaleString()}`);
console.log(`   Estimated ElevenLabs cost: ~$${(totalChars * 0.00005).toFixed(3)}\n`);

let generated = 0;
let skipped   = 0;
let errors    = 0;

for (const { key, text } of TOKENS) {
  const outPath = join(OUT_DIR, `${key}.mp3`);

  if (await fileExists(outPath)) {
    skipped++;
    continue;
  }

  try {
    const buf = await generateClip(text, apiKey);
    await writeFile(outPath, buf);
    generated++;
    process.stdout.write(`  ✓  ${key}\n`);
  } catch (err) {
    errors++;
    console.error(`  ✗  ${key}: ${err.message}`);
  }

  // Brief pause between requests to stay within rate limits
  await new Promise(r => setTimeout(r, 120));
}

console.log(`\n✅  Done — ${generated} generated, ${skipped} skipped, ${errors} errors`);
console.log(`   Output: ${OUT_DIR}\n`);
