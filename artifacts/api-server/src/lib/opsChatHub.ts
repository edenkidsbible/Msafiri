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
        // Client keepalive — respond so the browser side can detect dead links.
        try {
          const msg = JSON.parse(String(raw));
          if (msg?.event === "ping") {
            ws.send(JSON.stringify({ event: "pong" }));
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
