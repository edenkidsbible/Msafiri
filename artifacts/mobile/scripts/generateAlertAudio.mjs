/**
 * Generates bundled alert MP3s using ElevenLabs Multilingual v2 + Yna Agalo.
 * Run once from the workspace root:
 *   node artifacts/mobile/scripts/generateAlertAudio.mjs
 *
 * Requires ELEVENLABS_API_KEY in the environment.
 * Outputs to artifacts/mobile/assets/sounds/alerts/
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir    = dirname(fileURLToPath(import.meta.url));
const OUT_DIR  = join(__dir, "../assets/sounds/alerts");
const VOICE_ID = "ijKilL5CnjXKMWDHOJH8"; // Yna Agalo
const MODEL_ID = "eleven_multilingual_v2";

const PHRASES = [
  { text: "Speed Camera ahead",     file: "speed_camera_ahead.mp3"     },
  { text: "Police Checkpoint ahead", file: "police_checkpoint_ahead.mp3" },
  { text: "Speed Zone ahead",       file: "speed_zone_ahead.mp3"        },
  { text: "Alcoblow ahead",         file: "alcoblow_ahead.mp3"           },
  { text: "Accident ahead",         file: "accident_ahead.mp3"           },
  { text: "Traffic Jam ahead",      file: "traffic_jam_ahead.mp3"        },
  { text: "Roadblock ahead",        file: "roadblock_ahead.mp3"          },
  { text: "Road Works ahead",       file: "road_works_ahead.mp3"         },
  { text: "Hazard ahead",           file: "hazard_ahead.mp3"             },
  { text: "Pothole ahead",          file: "pothole_ahead.mp3"            },
  { text: "Debris ahead",           file: "debris_ahead.mp3"             },
  { text: "Broken Down ahead",      file: "broken_down_ahead.mp3"        },
  { text: "Bad Weather ahead",      file: "bad_weather_ahead.mp3"        },
  { text: "Road Closed ahead",      file: "road_closed_ahead.mp3"        },
  { text: "Road Clear ahead",       file: "road_clear_ahead.mp3"         },
];

async function generate(phrase) {
  const outPath = join(OUT_DIR, phrase.file);
  if (existsSync(outPath)) {
    console.log(`  ✓ ${phrase.file} (already exists, skipping)`);
    return true;
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key":   process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: phrase.text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.0 },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`  ✗ ${phrase.file} — HTTP ${res.status}: ${detail}`);
    return false;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  console.log(`  ✓ ${phrase.file} (${(buf.length / 1024).toFixed(1)} KB)`);
  return true;
}

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ERROR: ELEVENLABS_API_KEY not set");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

console.log(`Generating ${PHRASES.length} alert phrases via ElevenLabs Multilingual v2…\n`);

let ok = 0, fail = 0;
for (const phrase of PHRASES) {
  const success = await generate(phrase);
  if (success) ok++; else fail++;
  // Small delay to avoid rate-limit bursts
  await new Promise(r => setTimeout(r, 300));
}

console.log(`\nDone: ${ok} generated, ${fail} failed`);
if (fail > 0) process.exit(1);
