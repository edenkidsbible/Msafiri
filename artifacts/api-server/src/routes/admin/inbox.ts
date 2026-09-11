import { Router } from "express";
import { db } from "@workspace/db";
import { inboxEmailsTable } from "@workspace/db/schema";
import { desc, eq, ilike, or, sql, and } from "drizzle-orm";
import type { Request, Response } from "express";

const router = Router();

const RESEND_API_URL = "https://api.resend.com";
const ALLOWED_DOMAIN = "msafirikenya.com";

function formatEmail(row: typeof inboxEmailsTable.$inferSelect) {
  return {
    id: row.id,
    messageId: row.messageId,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    toEmail: row.toEmail,
    subject: row.subject,
    bodyHtml: row.bodyHtml,
    bodyText: row.bodyText,
    isRead: row.isRead,
    isReplied: row.isReplied,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    replyCount: row.replyCount,
    inReplyTo: row.inReplyTo,
    spamScore: row.spamScore,
    direction: row.direction ?? "inbound",
    receivedAt: row.receivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function displayName(localPart: string) {
  return localPart.charAt(0).toUpperCase() + localPart.slice(1) + " — Msafiri Kenya";
}

async function sendViaResend(
  apiKey: string,
  from: string,
  to: string[],
  subject: string,
  text: string,
  extraHeaders?: Record<string, string>,
) {
  const res = await fetch(`${RESEND_API_URL}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      ...(extraHeaders && Object.keys(extraHeaders).length > 0 ? { headers: extraHeaders } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

// GET /inbox/stats — unread count for sidebar badge (inbound only)
router.get("/inbox/stats", async (_req: Request, res: Response) => {
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboxEmailsTable)
      .where(and(
        eq(inboxEmailsTable.isRead, false),
        eq(inboxEmailsTable.direction, "inbound"),
      ));
    return res.json({ unreadCount: count ?? 0 });
  } catch (err) {
    console.error("[admin/inbox] stats error:", err);
    return res.status(500).json({ error: "Failed to fetch inbox stats" });
  }
});

// GET /inbox
// ?view=inbox|sent   (default: inbox)
// ?mailbox=<email>   (filter by toEmail, inbox only)
// ?filter=unread|replied|""
// ?search=<text>
// ?page=1 &limit=30
router.get("/inbox", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "30"), 10)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search ?? "").trim();
    const filter = String(req.query.filter ?? "");
    const view = String(req.query.view ?? "inbox");
    const mailbox = String(req.query.mailbox ?? "").trim();

    const conditions = [];

    conditions.push(eq(inboxEmailsTable.direction, view === "sent" ? "outbound" : "inbound"));
    if (view === "inbox" && mailbox) conditions.push(eq(inboxEmailsTable.toEmail, mailbox));
    if (filter === "unread") conditions.push(eq(inboxEmailsTable.isRead, false));
    else if (filter === "replied") conditions.push(eq(inboxEmailsTable.isReplied, true));
    if (search) {
      conditions.push(
        or(
          ilike(inboxEmailsTable.subject, `%${search}%`),
          ilike(inboxEmailsTable.fromEmail, `%${search}%`),
          ilike(inboxEmailsTable.bodyText ?? sql`''`, `%${search}%`),
        ),
      );
    }

    const where = and(...conditions);

    const [emails, [{ total }], mailboxRows] = await Promise.all([
      db
        .select({
          id: inboxEmailsTable.id,
          messageId: inboxEmailsTable.messageId,
          fromEmail: inboxEmailsTable.fromEmail,
          fromName: inboxEmailsTable.fromName,
          toEmail: inboxEmailsTable.toEmail,
          subject: inboxEmailsTable.subject,
          bodyText: inboxEmailsTable.bodyText,
          isRead: inboxEmailsTable.isRead,
          isReplied: inboxEmailsTable.isReplied,
          replyCount: inboxEmailsTable.replyCount,
          direction: inboxEmailsTable.direction,
          receivedAt: inboxEmailsTable.receivedAt,
          createdAt: inboxEmailsTable.createdAt,
        })
        .from(inboxEmailsTable)
        .where(where)
        .orderBy(desc(inboxEmailsTable.receivedAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: sql<number>`count(*)::int` }).from(inboxEmailsTable).where(where),
      db
        .selectDistinct({ toEmail: inboxEmailsTable.toEmail })
        .from(inboxEmailsTable)
        .where(eq(inboxEmailsTable.direction, "inbound"))
        .orderBy(inboxEmailsTable.toEmail),
    ]);

    return res.json({
      emails: emails.map((e) => ({
        ...e,
        direction: e.direction ?? "inbound",
        receivedAt: e.receivedAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
      })),
      total: total ?? 0,
      page,
      limit,
      pages: Math.ceil((total ?? 0) / limit),
      mailboxes: mailboxRows.map((r) => r.toEmail),
    });
  } catch (err) {
    console.error("[admin/inbox] list error:", err);
    return res.status(500).json({ error: "Failed to fetch emails" });
  }
});

// GET /inbox/:id — fetch full email, auto-mark inbound as read
router.get("/inbox/:id", async (req: Request, res: Response) => {
  try {
    const [email] = await db
      .select()
      .from(inboxEmailsTable)
      .where(eq(inboxEmailsTable.id, req.params.id as string));

    if (!email) return res.status(404).json({ error: "Email not found" });

    if (!email.isRead && (email.direction ?? "inbound") === "inbound") {
      await db
        .update(inboxEmailsTable)
        .set({ isRead: true })
        .where(eq(inboxEmailsTable.id, email.id));
      email.isRead = true;
    }

    return res.json(formatEmail(email));
  } catch (err) {
    console.error("[admin/inbox] get error:", err);
    return res.status(500).json({ error: "Failed to fetch email" });
  }
});

// PATCH /inbox/:id/read — toggle read/unread
router.patch("/inbox/:id/read", async (req: Request, res: Response) => {
  try {
    const { isRead } = req.body as { isRead: boolean };
    const [updated] = await db
      .update(inboxEmailsTable)
      .set({ isRead: !!isRead })
      .where(eq(inboxEmailsTable.id, req.params.id as string))
      .returning();

    if (!updated) return res.status(404).json({ error: "Email not found" });
    return res.json(formatEmail(updated));
  } catch (err) {
    console.error("[admin/inbox] read toggle error:", err);
    return res.status(500).json({ error: "Failed to update email" });
  }
});

// POST /inbox/:id/reply — send reply from the address the email arrived at
router.post("/inbox/:id/reply", async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

    const [email] = await db
      .select()
      .from(inboxEmailsTable)
      .where(eq(inboxEmailsTable.id, req.params.id as string));

    if (!email) return res.status(404).json({ error: "Email not found" });

    const { subject, body } = req.body as { subject?: string; body: string };
    if (!body?.trim()) return res.status(400).json({ error: "Reply body is required" });

    const replySubject =
      subject?.trim() ||
      (email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`);

    // Reply comes from the same address it was sent to
    const fromEmail = email.toEmail;
    const fromFormatted = `${displayName(fromEmail.split("@")[0])} <${fromEmail}>`;

    const headers: Record<string, string> = {};
    if (email.messageId) {
      headers["In-Reply-To"] = email.messageId;
      headers["References"] = email.references
        ? `${email.references} ${email.messageId}`
        : email.messageId;
    }

    try {
      await sendViaResend(apiKey, fromFormatted, [email.fromEmail], replySubject, body.trim(), headers);
    } catch (err) {
      console.error("[admin/inbox] Resend reply error:", err);
      return res.status(502).json({ error: "Failed to send reply via Resend" });
    }

    // Update original email + store outbound record
    await Promise.all([
      db.update(inboxEmailsTable)
        .set({ isReplied: true, repliedAt: new Date(), replyCount: sql`${inboxEmailsTable.replyCount} + 1` })
        .where(eq(inboxEmailsTable.id, email.id)),
      db.insert(inboxEmailsTable).values({
        fromEmail,
        toEmail: email.fromEmail,
        subject: replySubject,
        bodyText: body.trim(),
        direction: "outbound",
        inReplyTo: email.messageId ?? null,
        isRead: true,
        receivedAt: new Date(),
      }),
    ]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/inbox] reply error:", err);
    return res.status(500).json({ error: "Failed to send reply" });
  }
});

// POST /inbox/compose — send a new outbound email from any @msafirikenya.com address
router.post("/inbox/compose", async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

    const { from, to, subject, body } = req.body as {
      from: string; to: string; subject: string; body: string;
    };

    if (!from?.trim() || !from.trim().endsWith(`@${ALLOWED_DOMAIN}`)) {
      return res.status(400).json({ error: `From address must be @${ALLOWED_DOMAIN}` });
    }
    if (!to?.trim()) return res.status(400).json({ error: "To address is required" });
    if (!subject?.trim()) return res.status(400).json({ error: "Subject is required" });
    if (!body?.trim()) return res.status(400).json({ error: "Body is required" });

    const fromEmail = from.trim();
    const toEmail = to.trim();
    const fromFormatted = `${displayName(fromEmail.split("@")[0])} <${fromEmail}>`;

    try {
      await sendViaResend(apiKey, fromFormatted, [toEmail], subject.trim(), body.trim());
    } catch (err) {
      console.error("[admin/inbox] Resend compose error:", err);
      return res.status(502).json({ error: "Failed to send email via Resend" });
    }

    await db.insert(inboxEmailsTable).values({
      fromEmail,
      toEmail,
      subject: subject.trim(),
      bodyText: body.trim(),
      direction: "outbound",
      isRead: true,
      receivedAt: new Date(),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/inbox] compose error:", err);
    return res.status(500).json({ error: "Failed to compose email" });
  }
});

// DELETE /inbox/:id — delete email
router.delete("/inbox/:id", async (req: Request, res: Response) => {
  try {
    const [deleted] = await db
      .delete(inboxEmailsTable)
      .where(eq(inboxEmailsTable.id, req.params.id as string))
      .returning({ id: inboxEmailsTable.id });

    if (!deleted) return res.status(404).json({ error: "Email not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/inbox] delete error:", err);
    return res.status(500).json({ error: "Failed to delete email" });
  }
});

export default router;
