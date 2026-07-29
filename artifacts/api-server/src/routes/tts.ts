/**
 * POST /api/tts
 *
 * Proxies text-to-speech requests to ElevenLabs using the Keli voice (Flash v2.5).
 * The API key stays server-side — never sent to the mobile client.
 *
 * Body: { text: string }   (max 500 chars)
 * Response: audio/mpeg stream
 *
 * Serving priority:
 *   1. pregen-tts/<hash>.mp3 on disk  — pre-generated Keli clips, served free
 *   2. ElevenLabs on-demand call      — falls back here for unknown roads;
 *      any successful response is written to pregen-tts/ so it becomes a
 *      permanent pregen hit going forward (the set grows organically).
 *
 * Rate limit: 20 requests per minute per IP to protect ElevenLabs spend.
 */

import { Router, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";

const router = Router();

// ─── Pre-generated clip cache ─────────────────────────────────────────────────
// Keli clips for common Kenyan road names are pre-generated (one-time, billed
// to Replit credits) and stored in pregen-tts/<djb2-hash>.mp3.  A hit serves
// the file directly — no ElevenLabs call, no rate-limit consumption.  The hash
// function is identical to the mobile app's cache-key hash so filenames match
// exactly what resolveRawClip() computes for each spoken text.

const PREGEN_DIR = [
  path.resolve(process.cwd(), "pregen-tts"),
  path.resolve(process.cwd(), "artifacts/api-server/pregen-tts"),
].find((d) => fs.existsSync(d)) ?? null;

/** djb2 hash — must stay byte-identical to hashText() in mobile utils/tts.ts */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h) ^ text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function findPregenClip(text: string): string | null {
  if (!PREGEN_DIR) return null;
  const p = path.join(PREGEN_DIR, `${hashText(text)}.mp3`);
  return fs.existsSync(p) ? p : null;
}

const VOICE_ID = "hzuja6LJVafBxphAzQRB"; // Keli — matches bundled token voice
const MODEL_ID  = "eleven_flash_v2_5";
const MAX_TEXT  = 500;

const VOICE_SETTINGS = {
  stability:         0.45,
  similarity_boost:  0.82,
  style:             0,
  use_speaker_boost: true,
};

// ─── Simple in-memory rate limiter ───────────────────────────────────────────
// 20 requests per 60-second window per IP.  Road names are permanently cached
// on device so a legitimate user hits this at most a few times per session.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX       = 20;
const rateBuckets    = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now    = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (bucket.count >= RATE_MAX) return true;
  bucket.count++;
  return false;
}

// Prune stale buckets every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) {
    if (now >= b.resetAt) rateBuckets.delete(ip);
  }
}, 5 * 60_000).unref();

// ─── Route ────────────────────────────────────────────────────────────────────

router.post("/tts", async (req: Request, res: Response): Promise<void> => {
  try {
    const { text } = req.body as { text?: unknown };

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "text required" });
      return;
    }
    if (text.length > MAX_TEXT) {
      res.status(400).json({ error: `text must be ≤ ${MAX_TEXT} characters` });
      return;
    }

    // Pre-generated clip hit — serve from disk, skip rate limit + ElevenLabs.
    const pregen = findPregenClip(text);
    if (pregen) {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-Tts-Source", "pregen");
      fs.createReadStream(pregen).pipe(res);
      return;
    }

    // Rate check (protects ElevenLabs spend — pregen hits above are free)
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim()
      ?? req.socket.remoteAddress
      ?? "unknown";
    if (isRateLimited(ip)) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error("[tts] ELEVENLABS_API_KEY not configured");
      res.status(503).json({ error: "TTS not configured" });
      return;
    }

    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: MODEL_ID,
          voice_settings: VOICE_SETTINGS,
        }),
      }
    );

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "(no body)");
      console.error(`[tts] ElevenLabs error ${upstream.status}:`, body);
      res.status(502).json({ error: "TTS upstream error" });
      return;
    }

    res.setHeader("Content-Type", "audio/mpeg");
    // Cache for 1 year — road names and the Keli voice model are stable.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Tts-Source", "elevenlabs");

    const upstreamBody = upstream.body as ReadableStream<Uint8Array> | null;
    if (!upstreamBody) {
      res.status(502).json({ error: "Empty TTS response" });
      return;
    }

    // Collect chunks so we can (a) stream to client and (b) persist to pregen-tts/
    // for future requests — the pregen set grows organically with every
    // successful on-demand generation.
    const chunks: Uint8Array[] = [];
    const reader = upstreamBody.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      chunks.push(value);
      res.write(Buffer.from(value));
      return pump();
    };
    await pump();

    // Persist to pregen-tts/ so this road never needs a live ElevenLabs call again.
    if (PREGEN_DIR && chunks.length > 0) {
      try {
        const audioBuffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
        const clipPath = path.join(PREGEN_DIR, `${hashText(text)}.mp3`);
        fs.writeFileSync(clipPath, audioBuffer);

        // Append to manifest (best-effort, non-blocking on error)
        const manifestPath = path.join(PREGEN_DIR, "manifest.json");
        try {
          const manifest: Record<string, string> = JSON.parse(
            fs.readFileSync(manifestPath, "utf8")
          );
          manifest[hashText(text)] = text;
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        } catch { /* manifest update is non-critical */ }

        console.log(`[tts] cached new pregen clip for: ${text}`);
      } catch (err) {
        console.warn("[tts] failed to persist pregen clip:", err);
      }
    }
  } catch (err) {
    console.error("[tts] error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
