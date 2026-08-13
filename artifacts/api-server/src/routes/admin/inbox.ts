import { Router } from "express";
import { db } from "@workspace/db";
import { inboxEmailsTable } from "@workspace/db/schema";
import { desc, eq, ilike, or, sql, and } from "drizzle-orm";

const router = Router();

const RESEND_API_URL = "https://api.resend.com";

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
    receivedAt: row.receivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /inbox/stats — unread count for sidebar badge
router.get("/inbox/stats", async (_req, res) => {
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboxEmailsTable)
      .where(eq(inboxEmailsTable.isRead, false));
    return res.json({ unreadCount: count ?? 0 });
  } catch (err) {
    console.error("[admin/inbox] stats error:", err);
    return res.status(500).json({ error: "Failed to fetch inbox stats" });
  }
});

// GET /inbox — paginated email list
router.get("/inbox", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "30"), 10)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search ?? "").trim();
    const filter = String(req.query.filter ?? ""); // "unread" | "replied" | ""

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(inboxEmailsTable.subject, `%${search}%`),
          ilike(inboxEmailsTable.fromEmail, `%${search}%`),
          ilike(inboxEmailsTable.fromName ?? sql`''`, `%${search}%`),
          ilike(inboxEmailsTable.bodyText ?? sql`''`, `%${search}%`)
        )
      );
    }
    if (filter === "unread") {
      conditions.push(eq(inboxEmailsTable.isRead, false));
    } else if (filter === "replied") {
      conditions.push(eq(inboxEmailsTable.isReplied, true));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [emails, [{ total }]] = await Promise.all([
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
          receivedAt: inboxEmailsTable.receivedAt,
          createdAt: inboxEmailsTable.createdAt,
        })
        .from(inboxEmailsTable)
        .where(where)
        .orderBy(desc(inboxEmailsTable.receivedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(inboxEmailsTable)
        .where(where),
    ]);

    return res.json({
      emails: emails.map((e) => ({
        ...e,
        receivedAt: e.receivedAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
      })),
      total: total ?? 0,
      page,
      limit,
      pages: Math.ceil((total ?? 0) / limit),
    });
  } catch (err) {
    console.error("[admin/inbox] list error:", err);
    return res.status(500).json({ error: "Failed to fetch emails" });
  }
});

// GET /inbox/:id — get single email, mark as read
router.get("/inbox/:id", async (req, res) => {
  try {
    const [email] = await db
      .select()
      .from(inboxEmailsTable)
      .where(eq(inboxEmailsTable.id, req.params.id as string));

    if (!email) return res.status(404).json({ error: "Email not found" });

    // Auto-mark as read when opened
    if (!email.isRead) {
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
router.patch("/inbox/:id/read", async (req, res) => {
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

// POST /inbox/:id/reply — send reply via Resend
router.post("/inbox/:id/reply", async (req, res) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "RESEND_API_KEY not configured" });
    }

    const [email] = await db
      .select()
      .from(inboxEmailsTable)
      .where(eq(inboxEmailsTable.id, req.params.id as string));

    if (!email) return res.status(404).json({ error: "Email not found" });

    const { subject, body } = req.body as { subject?: string; body: string };
    if (!body?.trim()) {
      return res.status(400).json({ error: "Reply body is required" });
    }

    const replySubject =
      subject?.trim() ||
      (email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`);

    // Build reply-to headers for proper threading
    const headers: Record<string, string> = {};
    if (email.messageId) headers["In-Reply-To"] = email.messageId;
    if (email.messageId) {
      headers["References"] = email.references
        ? `${email.references} ${email.messageId}`
        : email.messageId;
    }

    const resendPayload = {
      from: "Msafiri Kenya <hello@msafirikenya.com>",
      to: [email.fromEmail],
      subject: replySubject,
      text: body,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    };

    const resendRes = await fetch(`${RESEND_API_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      console.error("[admin/inbox] Resend error:", resendRes.status, errBody);
      return res.status(502).json({ error: "Failed to send reply via Resend" });
    }

    // Mark as replied
    await db
      .update(inboxEmailsTable)
      .set({
        isReplied: true,
        repliedAt: new Date(),
        replyCount: sql`${inboxEmailsTable.replyCount} + 1`,
      })
      .where(eq(inboxEmailsTable.id, email.id));

    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin/inbox] reply error:", err);
    return res.status(500).json({ error: "Failed to send reply" });
  }
});

// DELETE /inbox/:id — delete email
router.delete("/inbox/:id", async (req, res) => {
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
