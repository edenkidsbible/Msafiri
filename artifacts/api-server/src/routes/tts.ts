/**
 * POST /api/tts
 *
 * Proxies text-to-speech requests to ElevenLabs using the Keli voice (Flash v2.5).
 * The API key stays server-side — never sent to the mobile client.
 *
 * Body: { text: string }   (max 500 chars)
 * Response: audio/mpeg stream
 */

import { Router, type Request, type Response } from "express";

const router = Router();

const VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2"; // Alice — British, clear/engaging, free-tier
const MODEL_ID  = "eleven_flash_v2_5";
const MAX_TEXT  = 500;

const VOICE_SETTINGS = {
  stability:         0.45,
  similarity_boost:  0.82,
  style:             0,
  use_speaker_boost: true,
};

router.post("/tts", async (req: Request, res: Response) => {
  try {
    const { text } = req.body as { text?: unknown };

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "text required" });
    }
    if (text.length > MAX_TEXT) {
      return res.status(400).json({ error: `text must be ≤ ${MAX_TEXT} characters` });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error("[tts] ELEVENLABS_API_KEY not configured");
      return res.status(503).json({ error: "TTS not configured" });
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
      return res.status(502).json({ error: "TTS upstream error" });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    // Cache for 1 day on the client — road names don't change
    res.setHeader("Cache-Control", "public, max-age=86400");

    const upstreamBody = upstream.body as ReadableStream<Uint8Array> | null;
    if (!upstreamBody) return res.status(502).json({ error: "Empty TTS response" });

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
