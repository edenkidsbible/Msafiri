import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { persistReceivedEmail } from "../lib/resendInbound.js";

const router = Router();

const TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Verify a Resend/Svix webhook signature.
 *
 * Svix signs webhooks by HMAC-SHA256 over:
 *   "{svix-id}.{svix-timestamp}.{raw-body}"
 *
 * The signing secret has a "whsec_" prefix followed by base64-encoded key bytes.
 * The svix-signature header is one or more comma-separated "v1,<base64>" values.
 */
function verifySignature(
  rawBody: Buffer,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): boolean {
  // 1. Reject stale timestamps
  const ts = Number(svixTimestamp) * 1000;
  if (Math.abs(Date.now() - ts) > TOLERANCE_MS) return false;

  // 2. Decode the signing key (strip "whsec_" prefix, base64-decode the rest)
  const keyBytes = Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    "base64"
  );

  // 3. Build the signed content string
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString("utf8")}`;

  // 4. Compute HMAC-SHA256
  const computed = createHmac("sha256", keyBytes)
    .update(signedContent)
    .digest("base64");

  // 5. Compare against every signature in the header (format: "v1,<base64> v1,<base64>")
  const signatures = svixSignature.split(" ");
  return signatures.some((sig) => {
    const b64 = sig.startsWith("v1,") ? sig.slice(3) : sig;
    try {
      return timingSafeEqual(Buffer.from(computed), Buffer.from(b64));
    } catch {
      return false;
    }
  });
}

/**
 * POST /api/webhooks/email-inbound
 *
 * Resend inbound email webhook. Mounted with express.raw() in app.ts so
 * req.body is a Buffer — required for Svix signature verification.
 *
 * Resend inbound payload shape:
 * {
 *   type: "email.received",
 *   created_at: "...",
 *   data: {
 *     email_id: "...",
 *     to: ["hello@msafirikenya.com"],
 *     from: "sender@example.com",
 *     subject: "...",
 *     message_id: "...",
 *   }
 * }
 *
 * The webhook contains metadata only. The full body and headers are retrieved
 * from Resend's Receiving API before the message is stored.
 */
router.post("/", async (req, res) => {
  try {
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

    // Verify signature if secret is configured
    if (webhookSecret) {
      const svixId        = String(req.headers["svix-id"] ?? "");
      const svixTimestamp = String(req.headers["svix-timestamp"] ?? "");
      const svixSignature = String(req.headers["svix-signature"] ?? "");

      if (!svixId || !svixTimestamp || !svixSignature) {
        return res.status(401).json({ error: "Missing Svix signature headers" });
      }

      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      const valid = verifySignature(rawBody, svixId, svixTimestamp, svixSignature, webhookSecret);
      if (!valid) {
        return res.status(401).json({ error: "Invalid webhook signature" });
      }
    }

    // Parse the body — raw Buffer from express.raw(), so we JSON.parse it
    let body: any;
    try {
      body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8")) : req.body;
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    if (body?.type && body.type !== "email.received") {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const data = body?.data ?? body;
    if (!data) return res.status(400).json({ error: "Missing payload" });

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "RESEND_API_KEY not configured" });
    }

    await persistReceivedEmail(apiKey, data);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[inbound-email] webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
