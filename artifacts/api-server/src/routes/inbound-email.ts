import { Router } from "express";
import { db } from "@workspace/db";
import { inboxEmailsTable } from "@workspace/db/schema";

const router = Router();

/**
 * POST /webhooks/email-inbound
 *
 * Resend inbound email webhook. No authentication — Resend posts here when
 * an email is received. We validate it's a real inbound event by checking
 * the payload shape before persisting anything.
 *
 * Resend inbound payload shape:
 * {
 *   type: "email.received",
 *   created_at: "...",
 *   data: {
 *     to: "hello@msafirikenya.com" | [{email, name}],
 *     from: "Name <email>" | {email, name},
 *     subject: "...",
 *     html: "...",
 *     text: "...",
 *     headers: { "Message-Id": "...", "In-Reply-To": "...", ... },
 *     spamScore: 0,
 *     spamVerdict: "PASS"
 *   }
 * }
 */
router.post("/webhooks/email-inbound", async (req, res) => {
  try {
    const body = req.body;

    // Accept both "email.received" type and raw inbound payloads
    const data = body?.data ?? body;
    if (!data) {
      return res.status(400).json({ error: "Missing payload" });
    }

    // Parse `from` — can be "Name <email@domain.com>", "email@domain.com", or {email, name}
    let fromEmail = "";
    let fromName: string | undefined;
    if (typeof data.from === "string") {
      const match = data.from.match(/^(.+?)\s*<(.+?)>$/);
      if (match) {
        fromName = match[1].trim();
        fromEmail = match[2].trim();
      } else {
        fromEmail = data.from.trim();
      }
    } else if (data.from && typeof data.from === "object") {
      fromEmail = data.from.email ?? "";
      fromName = data.from.name ?? undefined;
    }

    if (!fromEmail) {
      return res.status(400).json({ error: "Missing from address" });
    }

    // Parse `to` — can be string, array of strings, or array of {email, name}
    let toEmail = "";
    if (typeof data.to === "string") {
      toEmail = data.to.trim();
    } else if (Array.isArray(data.to)) {
      const first = data.to[0];
      toEmail = typeof first === "string" ? first : (first?.email ?? "");
    }

    // Extract headers
    const headers = data.headers ?? {};
    const messageId =
      headers["Message-Id"] ??
      headers["message-id"] ??
      headers["Message-ID"] ??
      null;
    const inReplyTo =
      headers["In-Reply-To"] ??
      headers["in-reply-to"] ??
      null;
    const references =
      headers["References"] ??
      headers["references"] ??
      null;

    const subject = data.subject ?? "(no subject)";
    const bodyHtml = data.html ?? null;
    const bodyText = data.text ?? null;
    const spamScore = data.spamScore != null ? String(data.spamScore) : null;

    // Insert — on conflict (same Message-Id) do nothing to avoid duplicates
    await db
      .insert(inboxEmailsTable)
      .values({
        messageId: messageId ?? undefined,
        fromEmail,
        fromName: fromName ?? null,
        toEmail: toEmail || "hello@msafirikenya.com",
        subject,
        bodyHtml,
        bodyText,
        inReplyTo: inReplyTo ?? null,
        references: references ?? null,
        spamScore,
        rawHeaders: JSON.stringify(headers),
        receivedAt: body.created_at ? new Date(body.created_at) : new Date(),
      })
      .onConflictDoNothing({ target: inboxEmailsTable.messageId });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[inbound-email] webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
