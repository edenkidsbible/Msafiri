import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, getUser } from "@/lib/auth";
import { subscribeChatSocket, sendChatFrame, type ChatSocketEvent } from "@/lib/chat-socket";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageCircle, Users, Hash, Send, Plus } from "lucide-react";

interface ConversationItem {
  id: number;
  type: "all_team" | "department" | "direct";
  name: string | null;
  departmentId: number | null;
  departmentName: string | null;
  unreadCount: number;
  lastMessage: {
    id: number;
    body: string;
    createdAt: string;
    senderId: string;
    senderName: string | null;
  } | null;
  otherUser: { id: string; name: string | null } | null;
}

interface ChatMessage {
  id: number;
  conversationId: number;
  senderId: string;
  senderName: string | null;
  body: string;
  createdAt: string;
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
}

function conversationDisplayName(conv: ConversationItem): string {
  return (
    conv.name ??
    (conv.type === "direct"
      ? conv.otherUser?.name ?? "Direct message"
      : conv.departmentName ?? "Conversation")
  );
}

function ConversationIcon({ type }: { type: string }) {
  if (type === "all_team") return <Users className="w-4 h-4 text-primary" />;
  if (type === "department") return <Hash className="w-4 h-4 text-violet-500" />;
  return <MessageCircle className="w-4 h-4 text-emerald-500" />;
}

export default function Chat() {
  const me = getUser();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Typing indicators: map of conversationId → list of currently-typing users.
  const [typingMap, setTypingMap] = useState<
    Record<number, { userId: string; senderName: string; expiresAt: number }[]>
  >({});
  // Throttle ref: only send one "typing" frame every 2 s while the user keeps typing.
  const typingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: conversations, isLoading } = useQuery<ConversationItem[]>({
    queryKey: ["ops-chat-conversations"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/chat/conversations");
      if (!r.ok) throw new Error("Failed to fetch conversations");
      return r.json();
    },
  });

  const { data: teamUsers } = useQuery<AdminUser[]>({
    queryKey: ["ops-team-users"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/team/users");
      if (!r.ok) throw new Error("Failed to fetch users");
      return r.json();
    },
  });

  const { data: messages, isLoading: messagesLoading } = useQuery<ChatMessage[]>({
    queryKey: ["ops-chat-messages", selectedId],
    enabled: selectedId != null,
    queryFn: async () => {
      const r = await authFetch(`/api/ops/chat/conversations/${selectedId}/messages`);
      if (!r.ok) throw new Error("Failed to fetch messages");
      return r.json();
    },
  });

  // Auto-select the first conversation once loaded.
  useEffect(() => {
    if (selectedId == null && conversations && conversations.length > 0) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, selectedId]);

  // Mark the open conversation read (on open and when new messages arrive in it).
  useEffect(() => {
    if (selectedId == null || !messages) return;
    authFetch(`/api/ops/chat/conversations/${selectedId}/read`, { method: "POST" })
      .then(() => queryClient.invalidateQueries({ queryKey: ["ops-chat-conversations"] }))
      .catch(() => {});
  }, [selectedId, messages?.length]);

  // Live updates via WebSocket — no polling.
  useEffect(() => {
    const unsubscribe = subscribeChatSocket((evt: ChatSocketEvent) => {
      if (evt.event === "connected") {
        // (Re)connected — refresh in case anything arrived while offline.
        queryClient.invalidateQueries({ queryKey: ["ops-chat-conversations"] });
        if (selectedIdRef.current != null) {
          queryClient.invalidateQueries({ queryKey: ["ops-chat-messages", selectedIdRef.current] });
        }
        return;
      }
      if (evt.event === "message:new" && evt.message) {
        const msg = evt.message;
        // Clear typing indicator for the sender once their message arrives.
        if (msg.senderId) {
          setTypingMap((prev) => ({
            ...prev,
            [msg.conversationId]: (prev[msg.conversationId] ?? []).filter(
              (t) => t.userId !== msg.senderId,
            ),
          }));
        }
        queryClient.setQueryData<ChatMessage[]>(
          ["ops-chat-messages", msg.conversationId],
          (old) => {
            if (!old) return old;
            if (old.some((m) => m.id === msg.id)) return old;
            return [...old, msg];
          },
        );
        queryClient.invalidateQueries({ queryKey: ["ops-chat-conversations"] });
        return;
      }
      if (
        evt.event === "typing" &&
        evt.conversationId != null &&
        evt.userId &&
        evt.userId !== me?.id
      ) {
        const { conversationId, userId, senderName = "Someone" } = evt;
        const expiresAt = Date.now() + 4000;
        setTypingMap((prev) => {
          const existing = (prev[conversationId] ?? []).filter((t) => t.userId !== userId);
          return { ...prev, [conversationId]: [...existing, { userId, senderName, expiresAt }] };
        });
        // Auto-expire the indicator after the grace period.
        setTimeout(() => {
          setTypingMap((prev) => ({
            ...prev,
            [conversationId]: (prev[conversationId] ?? []).filter((t) => t.expiresAt > Date.now()),
          }));
        }, 4100);
      }
    });
    return unsubscribe;
  }, [queryClient, me?.id]);

  // Keep the message pane scrolled to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, selectedId]);

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      const r = await authFetch(`/api/ops/chat/conversations/${selectedId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      if (!r.ok) throw new Error("Failed to send message");
      return r.json() as Promise<ChatMessage>;
    },
    onSuccess: (msg) => {
      queryClient.setQueryData<ChatMessage[]>(["ops-chat-messages", msg.conversationId], (old) => {
        if (!old) return [msg];
        if (old.some((m) => m.id === msg.id)) return old;
        return [...old, msg];
      });
      queryClient.invalidateQueries({ queryKey: ["ops-chat-conversations"] });
    },
  });

  const startDirectMutation = useMutation({
    mutationFn: async (userId: string) => {
      const r = await authFetch("/api/ops/chat/direct", {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      if (!r.ok) throw new Error("Failed to start conversation");
      return r.json() as Promise<{ id: number }>;
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["ops-chat-conversations"] });
      setSelectedId(data.id);
    },
  });

  const handleSend = () => {
    const body = draft.trim();
    if (!body || selectedId == null || sendMutation.isPending) return;
    setDraft("");
    sendMutation.mutate(body);
  };

  const selectedConv = conversations?.find((c) => c.id === selectedId) ?? null;

  const dmCandidates = useMemo(
    () => (teamUsers ?? []).filter((u) => u.id !== me?.id),
    [teamUsers, me?.id],
  );

  return (
    <div className="space-y-4 animate-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Team Chat</h1>
        <p className="text-muted-foreground mt-1">Real-time messaging for the team.</p>
      </div>

      <div className="border rounded-lg overflow-hidden flex h-[calc(100vh-16rem)] min-h-[420px] bg-background">
        {/* ── Conversation list ── */}
        <div className="w-72 shrink-0 border-r flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Conversations
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" data-testid="btn-new-dm" title="New direct message">
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {dmCandidates.length === 0 && (
                  <DropdownMenuItem disabled>No other team members</DropdownMenuItem>
                )}
                {dmCandidates.map((u) => (
                  <DropdownMenuItem
                    key={u.id}
                    onClick={() => startDirectMutation.mutate(u.id)}
                    data-testid={`dm-user-${u.id}`}
                  >
                    <MessageCircle className="w-4 h-4 mr-2 text-emerald-500" />
                    {u.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex-1 overflow-y-auto divide-y">
            {isLoading && (
              <div className="p-3 space-y-2">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            )}
            {!isLoading && conversations?.map((conv) => {
              const isActive = conv.id === selectedId;
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={`w-full text-left flex items-start gap-2.5 p-3 transition-colors ${
                    isActive ? "bg-muted/60" : "hover:bg-muted/20"
                  }`}
                  data-testid={`conversation-${conv.id}`}
                >
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <ConversationIcon type={conv.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm truncate">{conversationDisplayName(conv)}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {conv.lastMessage && (
                          <span className="text-[10px] text-muted-foreground">
                            {formatRelativeTime(conv.lastMessage.createdAt)}
                          </span>
                        )}
                        {conv.unreadCount > 0 && (
                          <span className="w-4.5 h-4.5 min-w-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                            {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                    {conv.lastMessage && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {conv.lastMessage.senderName && `${conv.lastMessage.senderName.split(" ")[0]}: `}
                        {conv.lastMessage.body}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Message pane ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedConv ? (
            <>
              <div className="p-3 border-b flex items-center gap-2">
                <ConversationIcon type={selectedConv.type} />
                <span className="font-semibold text-sm">{conversationDisplayName(selectedConv)}</span>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {messagesLoading && (
                  <div className="space-y-3">
                    {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-2/3" />)}
                  </div>
                )}
                {!messagesLoading && messages?.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-muted-foreground">
                    <MessageCircle className="w-8 h-8" />
                    <p className="text-sm">No messages yet. Say hello!</p>
                  </div>
                )}
                {messages?.map((msg) => {
                  const mine = msg.senderId === me?.id;
                  return (
                    <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                          mine
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                        data-testid={`message-${msg.id}`}
                      >
                        {!mine && (
                          <p className="text-[11px] font-semibold mb-0.5 opacity-80">
                            {msg.senderName ?? "Unknown"}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                        <p className={`text-[10px] mt-1 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {formatMessageTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Typing indicator */}
              {(() => {
                const now = Date.now();
                const typingUsers =
                  selectedId != null
                    ? (typingMap[selectedId] ?? []).filter((t) => t.expiresAt > now)
                    : [];
                if (typingUsers.length === 0) return null;
                const label =
                  typingUsers.length === 1
                    ? `${typingUsers[0].senderName} is typing…`
                    : "Several people are typing…";
                return (
                  <div className="px-4 py-1 flex items-center gap-1.5">
                    <span className="flex gap-0.5">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </span>
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                );
              })()}
              <div className="p-3 border-t flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    // Emit a typing frame at most once every 2 s.
                    if (selectedId != null && !typingThrottleRef.current) {
                      sendChatFrame({
                        event: "typing",
                        conversationId: selectedId,
                      });
                      typingThrottleRef.current = setTimeout(() => {
                        typingThrottleRef.current = null;
                      }, 2000);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={1}
                  placeholder="Type a message…"
                  className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring max-h-32"
                  data-testid="input-chat-message"
                />
                <Button
                  onClick={handleSend}
                  disabled={!draft.trim() || sendMutation.isPending}
                  size="icon"
                  data-testid="btn-send-message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 text-muted-foreground p-8">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageCircle className="w-7 h-7 text-primary" />
              </div>
              <p className="text-sm">Select a conversation to start chatting.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
