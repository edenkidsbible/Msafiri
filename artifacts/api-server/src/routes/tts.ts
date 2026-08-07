import { Router, type Request, type Response } from "express";
import { createHash } from "crypto";
import * as r2 from "../lib/r2Storage.js";

const router = Router();

const VOICE_ID  = "ijKilL5CnjXKMWDHOJH8"; // Yna Agalo
const MODEL_ID  = "eleven_multilingual_v2"; // highest quality for alert voices
const CACHE_DIR = "tts/alert";              // object-storage prefix
const MAX_TEXT  = 300;                      // characters

/** Stable cache key: sha256(text) → first 24 hex chars */
function objPath(text: string): string {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 24);
  return `${CACHE_DIR}/${hash}.mp3`;
}

// GET /tts?text=...
// Returns audio/mpeg of Yna Agalo speaking the given text.
// Results are cached in object storage for 90 days so each phrase is only
// generated once (ElevenLabs is billed per character).
router.get("/tts", async (req: Request, res: Response) => {
  const text = String(req.query.text ?? "").trim();
  if (!text)              return res.status(400).json({ error: "text is required" });
  if (text.length > MAX_TEXT)
    return res.status(400).json({ error: `text must be ≤ ${MAX_TEXT} characters` });

  const apiKey  = process.env.ELEVENLABS_API_KEY;
  const r2Ready = r2.isR2Configured();
  if (!apiKey)   return res.status(503).json({ error: "TTS not configured" });
  if (!r2Ready)  return res.status(503).json({ error: "Storage not configured" });

  const path = objPath(text);

  // ── Try R2 cache first ────────────────────────────────────────────────────
  try {
    const meta = await r2.headObject(path);
    if (meta) {
      const { body, contentLength } = await r2.getObjectStream(path);
      res.setHeader("Content-Type",   "audio/mpeg");
      res.setHeader("Cache-Control",  "public, max-age=7776000"); // 90 days
      res.setHeader("Content-Length", String(contentLength));
      res.setHeader("X-TTS-Cache",    "HIT");
      body.pipe(res);
      return;
    }
  } catch (err) {
    // Cache miss or storage error — fall through to generate
    console.warn("[tts] cache check failed:", err);
  }

  // ── Generate via ElevenLabs ────────────────────────────────────────────────
  try {
    const elRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key":   apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.0 },
        }),
      }
    );

    if (!elRes.ok) {
      const detail = await elRes.text().catch(() => "");
      console.error(`[tts] ElevenLabs ${elRes.status}:`, detail);
      return res.status(502).json({ error: "TTS generation failed" });
    }

    const buf = Buffer.from(await elRes.arrayBuffer());

    // Save to R2 cache non-blocking — don't let a storage hiccup delay the response
    r2.uploadBuffer(path, buf, "audio/mpeg")
      .catch((err) => console.warn("[tts] R2 cache save failed:", err));

    res.setHeader("Content-Type",   "audio/mpeg");
    res.setHeader("Cache-Control",  "public, max-age=7776000");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("X-TTS-Cache",    "MISS");
    return res.send(buf);
  } catch (err) {
    console.error("[tts] error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
