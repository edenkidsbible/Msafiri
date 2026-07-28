/**
 * POST /api/tts
 *
 * Proxies text-to-speech requests to ElevenLabs using the Keli voice (Flash v2.5).
 * The API key stays server-side — never sent to the mobile client.
 *
 * Body: { text: string }   (max 500 chars)
 * Response: audio/mpeg stream
 *
 * Rate limit: 20 requests per minute per IP to protect ElevenLabs spend.
 */

import { Router, type Request, type Response } from "express";

const router = Router();

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
    // Rate check
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim()
      ?? req.socket.remoteAddress
      ?? "unknown";
    if (isRateLimited(ip)) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    const { text } = req.body as { text?: unknown };

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      res.status(400).json({ error: "text required" });
      return;
    }
    if (text.length > MAX_TEXT) {
      res.status(400).json({ error: `text must be ≤ ${MAX_TEXT} characters` });
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
    // Cache for 1 day — road names don't change
    res.setHeader("Cache-Control", "public, max-age=86400");

    const upstreamBody = upstream.body as ReadableStream<Uint8Array> | null;
    if (!upstreamBody) {
      res.status(502).json({ error: "Empty TTS response" });
      return;
    }

    const reader = upstreamBody.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(Buffer.from(value));
      return pump();
    };
    await pump();
  } catch (err) {
    console.error("[tts] error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
