/**
 * chat.ts — REST routes for the ops team chat.
 *
 * Conversations:
 *   - all_team    : one shared conversation for every admin (auto-created)
 *   - department  : one per active department (auto-created)
 *   - direct      : 1:1 conversations, created on demand
 *
 * Read state lives in ops_conversation_members.last_read_message_id, with a
 * membership row created lazily the first time a user reads or is added to a
 * conversation. Real-time delivery is handled by the WebSocket hub
 * (lib/opsChatHub.ts); these routes broadcast after each successful write.
 */

import { Router } from "express";
import {
  db,
  adminUsersTable,
  opsDepartmentsTable,
  opsConversationsTable,
  opsMessagesTable,
  opsConversationMembersTable,
} from "@workspace/db";
// admin_users.id is a UUID column while the ops chat tables store admin ids
// as TEXT — Postgres has no implicit uuid = text operator, so every join or
// filter across that boundary casts the uuid side to text.
import { eq, and, asc, desc, isNull, sql, inArray } from "drizzle-orm";

import { broadcastOpsChat } from "../../lib/opsChatHub";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Ensure the all_team conversation and one conversation per active department exist. */
async function ensureBaseConversations(): Promise<void> {
  const existing = await db
    .select({
      id: opsConversationsTable.id,
      type: opsConversationsTable.type,
      departmentId: opsConversationsTable.departmentId,
    })
    .from(opsConversationsTable);

  if (!existing.some((c) => c.type === "all_team")) {
    await db.insert(opsConversationsTable).values({ type: "all_team", name: "All Team" });
  }

  const departments = await db
    .select({ id: opsDepartmentsTable.id, name: opsDepartmentsTable.name })
    .from(opsDepartmentsTable)
    .where(eq(opsDepartmentsTable.isActive, true));

  const haveDept = new Set(
    existing.filter((c) => c.type === "department").map((c) => c.departmentId),
  );
  for (const dept of departments) {
    if (!haveDept.has(dept.id)) {
      await db
        .insert(opsConversationsTable)
        .values({ type: "department", departmentId: dept.id, name: dept.name });
    }
  }
}

/** Direct conversations the given user belongs to. */
async function directConversationIdsFor(userId: string): Promise<number[]> {
  const rows = await db
    .select({ conversationId: opsConversationMembersTable.conversationId })
    .from(opsConversationMembersTable)
    .innerJoin(
      opsConversationsTable,
      eq(opsConversationsTable.id, opsConversationMembersTable.conversationId),
    )
    .where(
      and(
        eq(opsConversationMembersTable.userId, userId),
        eq(opsConversationsTable.type, "direct"),
      ),
    );
  return rows.map((r) => r.conversationId);
}

/** Can `userId` see conversation `conv`? Direct convos require membership. */
async function canAccess(
  userId: string,
  conv: { id: number; type: string },
): Promise<boolean> {
  if (conv.type !== "direct") return true;
  const [member] = await db
    .select({ id: opsConversationMembersTable.id })
    .from(opsConversationMembersTable)
    .where(
      and(
        eq(opsConversationMembersTable.conversationId, conv.id),
        eq(opsConversationMembersTable.userId, userId),
      ),
    );
  return !!member;
}

/** For a direct conversation, the admin user ids of both members (WS targets). */
async function directRecipients(conversationId: number): Promise<string[]> {
  const rows = await db
    .select({ userId: opsConversationMembersTable.userId })
    .from(opsConversationMembersTable)
    .where(eq(opsConversationMembersTable.conversationId, conversationId));
  return rows.map((r) => r.userId);
}

async function markRead(userId: string, conversationId: number): Promise<void> {
  const [latest] = await db
    .select({ id: opsMessagesTable.id })
    .from(opsMessagesTable)
    .where(
      and(
        eq(opsMessagesTable.conversationId, conversationId),
        isNull(opsMessagesTable.deletedAt),
      ),
    )
    .orderBy(desc(opsMessagesTable.id))
    .limit(1);

  const [member] = await db
    .select({ id: opsConversationMembersTable.id })
    .from(opsConversationMembersTable)
    .where(
      and(
        eq(opsConversationMembersTable.conversationId, conversationId),
        eq(opsConversationMembersTable.userId, userId),
      ),
    );

  if (member) {
    await db
      .update(opsConversationMembersTable)
      .set({ lastReadMessageId: latest?.id ?? null })
      .where(eq(opsConversationMembersTable.id, member.id));
  } else {
    await db.insert(opsConversationMembersTable).values({
      conversationId,
      userId,
      lastReadMessageId: latest?.id ?? null,
    });
  }
}

// ─── GET /chat/conversations ─────────────────────────────────────────────────

router.get("/chat/conversations", async (req, res) => {
  const userId = req.adminUser!.id;
  try {
    await ensureBaseConversations();

    const directIds = await directConversationIdsFor(userId);

    const conversations = await db
      .select()
      .from(opsConversationsTable)
      .orderBy(asc(opsConversationsTable.id));

    const visible = conversations.filter(
      (c) => c.type !== "direct" || directIds.includes(c.id),
    );
    const visibleIds = visible.map((c) => c.id);
    if (visibleIds.length === 0) return res.json([]);

    // Last message per conversation.
    const lastMessages = await db
      .select({
        id: opsMessagesTable.id,
        conversationId: opsMessagesTable.conversationId,
        body: opsMessagesTable.body,
        createdAt: opsMessagesTable.createdAt,
        senderId: opsMessagesTable.senderId,
        senderName: adminUsersTable.name,
        rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${opsMessagesTable.conversationId} ORDER BY ${opsMessagesTable.id} DESC)`.as("rn"),
      })
      .from(opsMessagesTable)
      .leftJoin(adminUsersTable, sql`${adminUsersTable.id}::text = ${opsMessagesTable.senderId}`)
      .where(
        and(
          inArray(opsMessagesTable.conversationId, visibleIds),
          isNull(opsMessagesTable.deletedAt),
        ),
      );
    const lastByConv = new Map<number, (typeof lastMessages)[number]>();
    for (const m of lastMessages) {
      const prev = lastByConv.get(m.conversationId);
      if (!prev || m.id > prev.id) lastByConv.set(m.conversationId, m);
    }

    // This user's read markers.
    const memberships = await db
      .select({
        conversationId: opsConversationMembersTable.conversationId,
        lastReadMessageId: opsConversationMembersTable.lastReadMessageId,
      })
      .from(opsConversationMembersTable)
      .where(eq(opsConversationMembersTable.userId, userId));
    const lastReadByConv = new Map(
      memberships.map((m) => [m.conversationId, m.lastReadMessageId ?? 0]),
    );

    // Unread counts (messages from others after the read marker).
    const unreadRows = await db
      .select({
        conversationId: opsMessagesTable.conversationId,
        id: opsMessagesTable.id,
        senderId: opsMessagesTable.senderId,
      })
      .from(opsMessagesTable)
      .where(
        and(
          inArray(opsMessagesTable.conversationId, visibleIds),
          isNull(opsMessagesTable.deletedAt),
        ),
      );
    const unreadByConv = new Map<number, number>();
    for (const m of unreadRows) {
      if (m.senderId === userId) continue;
      const lastRead = lastReadByConv.get(m.conversationId) ?? 0;
      if (m.id > lastRead) {
        unreadByConv.set(m.conversationId, (unreadByConv.get(m.conversationId) ?? 0) + 1);
      }
    }

    // Department names + direct counterparts.
    const departments = await db
      .select({ id: opsDepartmentsTable.id, name: opsDepartmentsTable.name })
      .from(opsDepartmentsTable);
    const deptNameById = new Map(departments.map((d) => [d.id, d.name]));

    const directMembers = directIds.length
      ? await db
          .select({
            conversationId: opsConversationMembersTable.conversationId,
            userId: opsConversationMembersTable.userId,
            name: adminUsersTable.name,
          })
          .from(opsConversationMembersTable)
          .leftJoin(adminUsersTable, sql`${adminUsersTable.id}::text = ${opsConversationMembersTable.userId}`)
          .where(inArray(opsConversationMembersTable.conversationId, directIds))
      : [];

    const result = visible.map((c) => {
      const last = lastByConv.get(c.id);
      const other =
        c.type === "direct"
          ? directMembers.find((m) => m.conversationId === c.id && m.userId !== userId)
          : undefined;
      return {
        id: c.id,
        type: c.type,
        name: c.name,
        departmentId: c.departmentId,
        departmentName: c.departmentId ? deptNameById.get(c.departmentId) ?? null : null,
        unreadCount: unreadByConv.get(c.id) ?? 0,
        lastMessage: last
          ? {
              id: last.id,
              body: last.body,
              createdAt: last.createdAt,
              senderId: last.senderId,
              senderName: last.senderName,
            }
          : null,
        otherUser: other ? { id: other.userId, name: other.name } : null,
      };
    });

    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list chat conversations");
    return res.status(500).json({ error: "Failed to list conversations" });
  }
});

// ─── GET /chat/unread ────────────────────────────────────────────────────────

router.get("/chat/unread", async (req, res) => {
  const userId = req.adminUser!.id;
  try {
    await ensureBaseConversations();
    const directIds = await directConversationIdsFor(userId);

    const conversations = await db
      .select({ id: opsConversationsTable.id, type: opsConversationsTable.type })
      .from(opsConversationsTable);
    const visibleIds = conversations
      .filter((c) => c.type !== "direct" || directIds.includes(c.id))
      .map((c) => c.id);
    if (visibleIds.length === 0) return res.json({ total: 0 });

    const memberships = await db
      .select({
        conversationId: opsConversationMembersTable.conversationId,
        lastReadMessageId: opsConversationMembersTable.lastReadMessageId,
      })
      .from(opsConversationMembersTable)
      .where(eq(opsConversationMembersTable.userId, userId));
    const lastReadByConv = new Map(
      memberships.map((m) => [m.conversationId, m.lastReadMessageId ?? 0]),
    );

    const rows = await db
      .select({
        conversationId: opsMessagesTable.conversationId,
        id: opsMessagesTable.id,
        senderId: opsMessagesTable.senderId,
      })
      .from(opsMessagesTable)
      .where(
        and(
          inArray(opsMessagesTable.conversationId, visibleIds),
          isNull(opsMessagesTable.deletedAt),
        ),
      );
    let total = 0;
    for (const m of rows) {
      if (m.senderId === userId) continue;
      if (m.id > (lastReadByConv.get(m.conversationId) ?? 0)) total++;
    }
    return res.json({ total });
  } catch (err) {
    req.log.error({ err }, "Failed to compute chat unread count");
    return res.status(500).json({ error: "Failed to compute unread count" });
  }
});

// ─── GET /chat/conversations/:id/messages ────────────────────────────────────

router.get("/chat/conversations/:id/messages", async (req, res) => {
  const userId = req.adminUser!.id;
  try {
    const id = parseInt(req.params.id as string);
    const [conv] = await db
      .select()
      .from(opsConversationsTable)
      .where(eq(opsConversationsTable.id, id));
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    if (!(await canAccess(userId, conv))) return res.status(403).json({ error: "Forbidden" });

    const limit = Math.min(parseInt((req.query.limit as string) ?? "100") || 100, 500);
    const rows = await db
      .select({
        id: opsMessagesTable.id,
        conversationId: opsMessagesTable.conversationId,
        senderId: opsMessagesTable.senderId,
        senderName: adminUsersTable.name,
        body: opsMessagesTable.body,
        createdAt: opsMessagesTable.createdAt,
      })
      .from(opsMessagesTable)
      .leftJoin(adminUsersTable, sql`${adminUsersTable.id}::text = ${opsMessagesTable.senderId}`)
      .where(and(eq(opsMessagesTable.conversationId, id), isNull(opsMessagesTable.deletedAt)))
      .orderBy(desc(opsMessagesTable.id))
      .limit(limit);

    return res.json(rows.reverse());
  } catch (err) {
    req.log.error({ err }, "Failed to list chat messages");
    return res.status(500).json({ error: "Failed to list messages" });
  }
});

// ─── POST /chat/conversations/:id/messages ───────────────────────────────────

router.post("/chat/conversations/:id/messages", async (req, res) => {
  const userId = req.adminUser!.id;
  try {
    const id = parseInt(req.params.id as string);
    const body = (req.body?.body ?? "").toString().trim();
    if (!body) return res.status(400).json({ error: "Message body is required" });
    if (body.length > 4000) return res.status(400).json({ error: "Message too long" });

    const [conv] = await db
      .select()
      .from(opsConversationsTable)
      .where(eq(opsConversationsTable.id, id));
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    if (!(await canAccess(userId, conv))) return res.status(403).json({ error: "Forbidden" });

    const [inserted] = await db
      .insert(opsMessagesTable)
      .values({ conversationId: id, senderId: userId, body })
      .returning();

    await markRead(userId, id);

    const message = {
      id: inserted!.id,
      conversationId: id,
      senderId: userId,
      senderName: req.adminUser!.name ?? null,
      body: inserted!.body,
      createdAt: inserted!.createdAt,
    };

    const recipients = conv.type === "direct" ? await directRecipients(id) : null;
    broadcastOpsChat("message:new", { conversationId: id, message }, recipients);

    return res.status(201).json(message);
  } catch (err) {
    req.log.error({ err }, "Failed to send chat message");
    return res.status(500).json({ error: "Failed to send message" });
  }
});

// ─── POST /chat/conversations/:id/read ───────────────────────────────────────

router.post("/chat/conversations/:id/read", async (req, res) => {
  const userId = req.adminUser!.id;
  try {
    const id = parseInt(req.params.id as string);
    const [conv] = await db
      .select()
      .from(opsConversationsTable)
      .where(eq(opsConversationsTable.id, id));
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    if (!(await canAccess(userId, conv))) return res.status(403).json({ error: "Forbidden" });

    await markRead(userId, id);
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to mark conversation read");
    return res.status(500).json({ error: "Failed to mark read" });
  }
});

// ─── POST /chat/direct — find or create a 1:1 conversation ─────────────────

router.post("/chat/direct", async (req, res) => {
  const userId = req.adminUser!.id;
  try {
    const otherId = (req.body?.userId ?? "").toString();
    if (!otherId || otherId === userId) {
      return res.status(400).json({ error: "A different userId is required" });
    }
    const [other] = await db
      .select({ id: adminUsersTable.id })
      .from(adminUsersTable)
      .where(sql`${adminUsersTable.id}::text = ${otherId}`);
    if (!other) return res.status(404).json({ error: "User not found" });

    // Existing direct conversation containing both users?
    const mine = await directConversationIdsFor(userId);
    if (mine.length > 0) {
      const [shared] = await db
        .select({ conversationId: opsConversationMembersTable.conversationId })
        .from(opsConversationMembersTable)
        .where(
          and(
            inArray(opsConversationMembersTable.conversationId, mine),
            eq(opsConversationMembersTable.userId, otherId),
          ),
        );
      if (shared) return res.json({ id: shared.conversationId, existing: true });
    }

    const [conv] = await db
      .insert(opsConversationsTable)
      .values({ type: "direct" })
      .returning();
    await db.insert(opsConversationMembersTable).values([
      { conversationId: conv!.id, userId },
      { conversationId: conv!.id, userId: otherId },
    ]);
    return res.status(201).json({ id: conv!.id, existing: false });
  } catch (err) {
    req.log.error({ err }, "Failed to create direct conversation");
    return res.status(500).json({ error: "Failed to create conversation" });
  }
});

export default router;
