/**
 * chat-socket.ts — shared WebSocket client for the ops team chat.
 *
 * A single connection is shared by every subscriber (chat page, sidebar
 * badge). It authenticates with the admin JWT as a `?token=` query param,
 * reconnects with backoff, and keeps the link alive with periodic pings.
 */

import { getToken } from "@/lib/auth";

export interface ChatSocketEvent {
  event: string;
  conversationId?: number;
  message?: {
    id: number;
    conversationId: number;
    senderId: string;
    senderName: string | null;
    body: string;
    createdAt: string;
  };
}

type Listener = (evt: ChatSocketEvent) => void;

const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let backoffMs = 1000;

function wsUrl(): string | null {
  const token = getToken();
  if (!token) return null;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const base = import.meta.env.BASE_URL; // includes trailing slash
  return `${proto}//${window.location.host}${base}api/ops/chat/ws?token=${encodeURIComponent(token)}`;
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = wsUrl();
  if (!url) return;

  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    backoffMs = 1000;
    for (const l of listeners) l({ event: "connected" });
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "ping" }));
      }
    }, 25_000);
  };

  ws.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data) as ChatSocketEvent;
      if (evt.event === "pong") return;
      for (const l of listeners) l(evt);
    } catch {
      /* ignore malformed frames */
    }
  };

  ws.onclose = () => {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    ws = null;
    if (listeners.size > 0) scheduleReconnect();
  };

  ws.onerror = () => {
    try { ws?.close(); } catch { /* noop */ }
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (listeners.size > 0) connect();
  }, backoffMs);
  backoffMs = Math.min(backoffMs * 2, 30_000);
}

/** Subscribe to chat events. Opens the shared connection on first subscriber. */
export function subscribeChatSocket(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      try { ws?.close(); } catch { /* noop */ }
      ws = null;
    }
  };
}
