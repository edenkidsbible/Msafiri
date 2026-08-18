import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageCircle, Users, Hash } from "lucide-react";

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
    senderFirst: string | null;
    senderLast: string | null;
  } | null;
  otherUser: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

function ConversationIcon({ type }: { type: string }) {
  if (type === "all_team") return <Users className="w-5 h-5 text-primary" />;
  if (type === "department") return <Hash className="w-5 h-5 text-violet-500" />;
  return <MessageCircle className="w-5 h-5 text-emerald-500" />;
}

export default function Chat() {
  const { data: conversations, isLoading } = useQuery<ConversationItem[]>({
    queryKey: ["ops-chat-conversations"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/chat/conversations");
      if (!r.ok) throw new Error("Failed to fetch conversations");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Team Chat</h1>
        <p className="text-muted-foreground mt-1">Real-time messaging for the team.</p>
      </div>

      {/* Coming soon banner */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <MessageCircle className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Real-time chat coming soon</h2>
            <p className="text-muted-foreground mt-1 text-sm max-w-sm">
              Full WebSocket-powered chat with channels, direct messages, and file sharing is on the roadmap.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Existing conversations if available */}
      {isLoading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      )}

      {!isLoading && conversations && conversations.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Conversations</h2>
          <div className="border rounded-lg overflow-hidden divide-y">
            {conversations.map(conv => {
              const displayName = conv.name
                ?? (conv.type === "direct" && conv.otherUser
                  ? `${conv.otherUser.firstName ?? ""} ${conv.otherUser.lastName ?? ""}`.trim() || "Direct message"
                  : conv.departmentName ?? "Conversation");

              return (
                <div
                  key={conv.id}
                  className="flex items-start gap-3 p-4 hover:bg-muted/20 cursor-pointer transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <ConversationIcon type={conv.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm truncate">{displayName}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        {conv.lastMessage && (
                          <span className="text-[10px] text-muted-foreground">
                            {formatRelativeTime(conv.lastMessage.createdAt)}
                          </span>
                        )}
                        {conv.unreadCount > 0 && (
                          <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                            {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                    {conv.lastMessage && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {conv.lastMessage.senderFirst && `${conv.lastMessage.senderFirst}: `}
                        {conv.lastMessage.body}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
