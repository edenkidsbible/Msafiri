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
  { text: "Speed Camera ahead",     file: "camera.mp3"    },
  { text: "Police Checkpoint ahead", file: "police.mp3"   },
  { text: "Speed Zone ahead",       file: "zone.mp3"      },
  { text: "Alcoblow ahead",         file: "alcoblow.mp3"  },
  { text: "Accident ahead",         file: "accident.mp3"  },
  { text: "Traffic Jam ahead",      file: "traffic.mp3"   },
  { text: "Roadblock ahead",        file: "roadblock.mp3" },
  { text: "Road Works ahead",       file: "roadworks.mp3" },
  { text: "Hazard ahead",           file: "hazard.mp3"    },
  { text: "Pothole ahead",          file: "pothole.mp3"   },
  { text: "Debris ahead",           file: "debris.mp3"    },
  { text: "Broken Down ahead",      file: "breakdown.mp3" },
  { text: "Bad Weather ahead",      file: "weather.mp3"   },
  { text: "Road Closed ahead",      file: "closure.mp3"   },
  { text: "Road Clear ahead",       file: "clear.mp3"     },
];

// Multi-alert variants — played when lead alert has additional incidents nearby
const MULTI_PHRASES = [
  { text: "Speed Camera and more alerts ahead — please slow down.",          file: "camera_multi.mp3"    },
  { text: "Police Checkpoint and more alerts ahead — please stay cautious.", file: "police_multi.mp3"   },
  { text: "Speed Zone and more alerts ahead — please slow down.",            file: "zone_multi.mp3"     },
  { text: "Alcoblow checkpoint and more alerts ahead — please stay cautious.", file: "alcoblow_multi.mp3" },
  { text: "Accident and more alerts ahead — please drive carefully.",        file: "accident_multi.mp3"  },
  { text: "Traffic Jam and more alerts ahead — please drive carefully.",     file: "traffic_multi.mp3"   },
  { text: "Roadblock and more alerts ahead — please drive carefully.",       file: "roadblock_multi.mp3" },
  { text: "Road Works and more alerts ahead — please stay cautious.",        file: "roadworks_multi.mp3" },
  { text: "Hazard and more alerts ahead — please stay cautious.",            file: "hazard_multi.mp3"    },
  { text: "Pothole and more alerts ahead — please stay cautious.",           file: "pothole_multi.mp3"   },
  { text: "Debris and more alerts ahead — please stay cautious.",            file: "debris_multi.mp3"    },
  { text: "Broken down vehicle and more alerts ahead — please drive carefully.", file: "breakdown_multi.mp3" },
  { text: "Bad Weather and more alerts ahead — please stay cautious.",       file: "weather_multi.mp3"   },
  { text: "Road Closed and more alerts ahead — please drive carefully.",     file: "closure_multi.mp3"   },
  { text: "Road Clear and more alerts ahead — please drive safely.",         file: "clear_multi.mp3"     },
  { text: "Report submitted. Thank you for keeping Msafiri safe.",           file: "report_submitted.mp3" },

  // Navigation lifecycle (Yna Agalo — bundled so playback is instant & offline)
  { text: "Navigation started! Your route is ready — follow along as I guide you. If you spot anything on the road, tap to report it. Watch out for incidents flagged by other drivers — I will sound an alert before you reach them. Stay focused on the road, and have a safe journey!", file: "nav_start.mp3" },
  { text: "You've arrived! If any of the incidents you passed are now clear, please update them so other drivers know. Have a lovely time ahead, and remember to come back!", file: "nav_end.mp3" },
  { text: "Trip ended. As you head out, please update any hazards you passed on that route, or add what you saw. Your reports keep other Msafiri drivers safe. Drive well!", file: "nav_cancel.mp3" },
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

const ALL_PHRASES = [...PHRASES, ...MULTI_PHRASES];
console.log(`Generating ${ALL_PHRASES.length} alert phrases via ElevenLabs Multilingual v2…\n`);

let ok = 0, fail = 0;
for (const phrase of ALL_PHRASES) {
  const success = await generate(phrase);
  if (success) ok++; else fail++;
  // Small delay to avoid rate-limit bursts
  await new Promise(r => setTimeout(r, 300));
}

console.log(`\nDone: ${ok} generated, ${fail} failed`);
if (fail > 0) process.exit(1);
