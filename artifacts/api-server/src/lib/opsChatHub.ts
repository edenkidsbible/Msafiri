/**
 * opsChatHub.ts — WebSocket hub for the ops team chat.
 *
 * Upgrades HTTP connections on /api/ops/chat/ws to WebSocket. Authentication
 * uses the same admin JWT as REST routes, passed as a `?token=` query param
 * in the handshake (browsers cannot set an Authorization header on a
 * WebSocket connection).
 *
 * Events pushed to clients (JSON):
 *   { event: "message:new", conversationId, message }   — a new chat message
 *
 * Direct conversations are only pushed to their two members; all_team and
 * department conversations are pushed to every connected admin.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { eq, sql } from "drizzle-orm";
import { db, adminUsersTable, opsConversationsTable, opsConversationMembersTable } from "@workspace/db";
import { logger } from "./logger";
import type { AdminJwtPayload } from "../middleware/adminAuth";

interface ChatClient {
  ws: WebSocket;
  userId: string;
  alive: boolean;
}

const clients = new Set<ChatClient>();

export function setupOpsChatWs(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/api/ops/chat/ws") {
      // Not ours — no other WS handlers exist, so reject cleanly.
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token");
    const secret = process.env.ADMIN_JWT_SECRET;
    let payload: AdminJwtPayload | null = null;
    if (token && secret) {
      try {
        payload = jwt.verify(token, secret) as AdminJwtPayload;
      } catch {
        payload = null;
      }
    }
    if (!payload?.id) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const userId = payload.id;
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: ChatClient = { ws, userId, alive: true };
      clients.add(client);
      logger.info({ userId, connections: clients.size }, "ops chat WS connected");

      ws.on("pong", () => {
        client.alive = true;
      });
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(String(raw));
          if (msg?.event === "ping") {
            // Client keepalive — respond so the browser side can detect dead links.
            ws.send(JSON.stringify({ event: "pong" }));
          } else if (msg?.event === "typing" && typeof msg.conversationId === "number") {
            // Relay typing indicator to other conversation members.
            // senderName is resolved server-side; we never trust client-supplied identity.
            void relayTyping(userId, msg.conversationId);
          }
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.on("close", () => {
        clients.delete(client);
      });
      ws.on("error", () => {
        clients.delete(client);
        try { ws.close(); } catch { /* noop */ }
      });

      ws.send(JSON.stringify({ event: "connected" }));
    });
  });

  // Server-side heartbeat: drop connections that stop answering pings so the
  // client set doesn't accumulate dead sockets behind proxies.
  const interval = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        clients.delete(client);
        try { client.ws.terminate(); } catch { /* noop */ }
        continue;
      }
      client.alive = false;
      try { client.ws.ping(); } catch { /* noop */ }
    }
  }, 30_000);
  interval.unref();
}

/**
 * Relay a typing indicator to the other members of a conversation.
 *
 * Access control:
 *   - For direct conversations the sender must have a membership row; if not,
 *     the frame is silently dropped.
 *   - For group conversations being an authenticated admin (already verified by
 *     the JWT check on connect) is sufficient.
 *
 * Identity: senderName is resolved server-side from admin_users — the client-
 * supplied value is never used.
 */
async function relayTyping(senderId: string, conversationId: number): Promise<void> {
  try {
    // 1. Look up conversation type.
    const [conv] = await db
      .select({ type: opsConversationsTable.type })
      .from(opsConversationsTable)
      .where(eq(opsConversationsTable.id, conversationId))
      .limit(1);
    if (!conv) return;

    // 2. Look up conversation members (needed for DM auth and targeting).
    const members = await db
      .select({ userId: opsConversationMembersTable.userId })
      .from(opsConversationMembersTable)
      .where(eq(opsConversationMembersTable.conversationId, conversationId));
    const memberIds = members.map((m) => m.userId);

    // 3. For direct conversations enforce membership — prevents cross-conversation snooping.
    if (conv.type === "direct" && !memberIds.includes(senderId)) return;

    // 4. Resolve the sender's display name server-side.
    //    admin_users.id is UUID; senderId comes from the JWT as a string, so cast.
    const [sender] = await db
      .select({ name: adminUsersTable.name })
      .from(adminUsersTable)
      .where(sql`${adminUsersTable.id}::text = ${senderId}`)
      .limit(1);
    const senderName = sender?.name ?? "Unknown";

    const frame = JSON.stringify({ event: "typing", conversationId, userId: senderId, senderName });

    if (conv.type === "direct") {
      // Only relay to the other member of the DM.
      const recipients = new Set(memberIds.filter((id) => id !== senderId));
      for (const client of clients) {
        if (recipients.has(client.userId) && client.ws.readyState === WebSocket.OPEN) {
          try { client.ws.send(frame); } catch { /* noop */ }
        }
      }
    } else {
      // Group conversation — broadcast to all connected clients except the sender.
      for (const client of clients) {
        if (client.userId === senderId) continue;
        if (client.ws.readyState === WebSocket.OPEN) {
          try { client.ws.send(frame); } catch { /* noop */ }
        }
      }
    }
  } catch {
    /* ignore relay errors — typing indicators are best-effort */
  }
}

/**
 * Push an event to connected chat clients.
 * @param recipients — explicit admin user ids to target, or null for all.
 */
export function broadcastOpsChat(
  event: string,
  payload: Record<string, unknown>,
  recipients: string[] | null = null,
): void {
  const frame = JSON.stringify({ event, ...payload });
  for (const client of clients) {
    if (recipients && !recipients.includes(client.userId)) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      try { client.ws.send(frame); } catch { /* noop */ }
    }
  }
}
