import { useState, useEffect, useRef } from "react";
import { Mail, MailOpen, Reply, Trash2, RefreshCw, Search, Inbox, ChevronLeft, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import { cn } from "@/lib/utils";

function authFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${getToken()}`, ...(opts.headers ?? {}) },
  });
}
import { format, formatDistanceToNow } from "date-fns";
import { PageGuide } from "@/components/page-guide";

interface Email {
  id: string;
  messageId: string | null;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string;
  bodyHtml: string | null;
  bodyText: string | null;
  isRead: boolean;
  isReplied: boolean;
  repliedAt: string | null;
  replyCount: number;
  inReplyTo: string | null;
  spamScore: string | null;
  receivedAt: string;
  createdAt: string;
}

interface EmailList {
  emails: Email[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

function senderInitials(email: Email) {
  const name = email.fromName ?? email.fromEmail;
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function avatarColor(email: string) {
  const colors = [
    "bg-blue-500", "bg-purple-500", "bg-green-500",
    "bg-orange-500", "bg-pink-500", "bg-teal-500",
  ];
  let hash = 0;
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

export default function InboxPage() {
  const { toast } = useToast();
  const [emails, setEmails] = useState<Email[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [selected, setSelected] = useState<Email | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function fetchEmails(p = 1, q = search, f = filter) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: "30" });
      if (q) params.set("search", q);
      if (f !== "all") params.set("filter", f);
      const res = await authFetch(`/api/admin/inbox?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data: EmailList = await res.json();
      setEmails(data.emails);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch {
      toast({ title: "Failed to load emails", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function fetchStats() {
    try {
      const res = await authFetch("/api/admin/inbox/stats");
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {}
  }

  useEffect(() => {
    fetchEmails(1, search, filter);
    fetchStats();
  }, [filter]);

  function handleSearch(v: string) {
    setSearch(v);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchEmails(1, v, filter);
    }, 400);
  }

  async function openEmail(e: Email) {
    setLoadingEmail(true);
    setSelected(null);
    setReplying(false);
    setReplyBody("");
    try {
      const res = await authFetch(`/api/admin/inbox/${e.id}`);
      if (!res.ok) throw new Error("Failed");
      const full: Email = await res.json();
      setSelected(full);
      // Update read state in list
      setEmails((prev) =>
        prev.map((em) => (em.id === full.id ? { ...em, isRead: true } : em))
      );
      fetchStats();
    } catch {
      toast({ title: "Failed to open email", variant: "destructive" });
    } finally {
      setLoadingEmail(false);
    }
  }

  async function toggleRead(e: Email) {
    try {
      const res = await authFetch(`/api/admin/inbox/${e.id}/read`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: !e.isRead }),
      });
      if (!res.ok) throw new Error("Failed");
      const updated: Email = await res.json();
      setEmails((prev) => prev.map((em) => (em.id === updated.id ? { ...em, isRead: updated.isRead } : em)));
      if (selected?.id === updated.id) setSelected(updated);
      fetchStats();
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  }

  async function sendReply() {
    if (!selected || !replyBody.trim()) return;
    setSendingReply(true);
    try {
      const res = await authFetch(`/api/admin/inbox/${selected.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Reply sent" });
      setReplying(false);
      setReplyBody("");
      setSelected((prev) => prev ? { ...prev, isReplied: true, replyCount: prev.replyCount + 1 } : prev);
      setEmails((prev) =>
        prev.map((em) => em.id === selected.id ? { ...em, isReplied: true } : em)
      );
    } catch {
      toast({ title: "Failed to send reply", variant: "destructive" });
    } finally {
      setSendingReply(false);
    }
  }

  async function deleteEmail(e: Email) {
    setDeleting(true);
    try {
      const res = await authFetch(`/api/admin/inbox/${e.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Email deleted" });
      setEmails((prev) => prev.filter((em) => em.id !== e.id));
      setTotal((t) => t - 1);
      if (selected?.id === e.id) setSelected(null);
      fetchStats();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div className="flex flex-col gap-0 -m-4 md:-m-8 h-[calc(100vh-3.5rem)]">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b bg-background shrink-0">
        <Inbox className="h-5 w-5 text-primary" />
        <h1 className="font-semibold text-base">Inbox</h1>
        {unreadCount > 0 && (
          <Badge variant="default" className="text-xs px-1.5 py-0">{unreadCount} unread</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 w-48 text-sm"
              placeholder="Search emails…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v)}>
            <SelectTrigger className="h-8 w-28 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="replied">Replied</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => { fetchEmails(1, search, filter); fetchStats(); }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="px-4 md:px-6 py-3 border-b bg-background shrink-0">
        <PageGuide
          title="Handling user messages"
          steps={[
            { label: "Message source", detail: "messages arrive as inbound emails sent to the Msafiri support address." },
            { label: "Replying", detail: "reply here to send an email back to the sender — replies are delivered via the email provider, not push notifications." },
            { label: "Triage filters", detail: "use the All / Unread / Replied filter to work through the queue; mark items read or delete them once actioned." },
          ]}
        />
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0">
        {/* Email list panel */}
        <div
          className={cn(
            "flex flex-col border-r bg-background shrink-0 overflow-y-auto",
            selected ? "hidden md:flex w-80 xl:w-96" : "flex w-full md:w-80 xl:w-96"
          )}
        >
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
              <Inbox className="h-10 w-10 opacity-30" />
              <p className="text-sm">No emails found</p>
            </div>
          ) : (
            <>
              <div className="px-3 py-2 text-xs text-muted-foreground border-b">
                {total} email{total !== 1 ? "s" : ""}
              </div>
              {emails.map((email) => (
                <button
                  key={email.id}
                  onClick={() => openEmail(email)}
                  className={cn(
                    "w-full text-left px-3 py-3 border-b hover:bg-muted/50 transition-colors flex gap-3 items-start",
                    selected?.id === email.id && "bg-primary/5 border-l-2 border-l-primary",
                    !email.isRead && "bg-blue-50/50 dark:bg-blue-950/20"
                  )}
                >
                  {/* Avatar */}
                  <div className={cn(
                    "h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0",
                    avatarColor(email.fromEmail)
                  )}>
                    {senderInitials(email)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 justify-between">
                      <span className={cn("text-sm truncate", !email.isRead && "font-semibold")}>
                        {email.fromName ?? email.fromEmail}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-1">
                        {formatDistanceToNow(new Date(email.receivedAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className={cn("text-xs truncate mt-0.5", !email.isRead ? "text-foreground font-medium" : "text-muted-foreground")}>
                      {email.subject}
                    </p>
                    {email.bodyText && (
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {email.bodyText.slice(0, 80)}
                      </p>
                    )}
                    <div className="flex gap-1 mt-1">
                      {!email.isRead && <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">New</Badge>}
                      {email.isReplied && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">Replied</Badge>}
                    </div>
                  </div>
                </button>
              ))}
              {/* Pagination */}
              {pages > 1 && (
                <div className="flex items-center justify-center gap-2 p-3 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => fetchEmails(page - 1)}
                    className="h-7 text-xs"
                  >
                    Prev
                  </Button>
                  <span className="text-xs text-muted-foreground">{page} / {pages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pages}
                    onClick={() => fetchEmails(page + 1)}
                    className="h-7 text-xs"
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Email reader panel */}
        <div className={cn(
          "flex-1 flex flex-col min-h-0 min-w-0",
          !selected && "hidden md:flex"
        )}>
          {loadingEmail ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !selected ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <MailOpen className="h-16 w-16 opacity-20" />
              <p className="text-sm">Select an email to read</p>
            </div>
          ) : (
            <div className="flex flex-col h-full min-h-0">
              {/* Email header */}
              <div className="px-4 md:px-6 py-4 border-b shrink-0">
                {/* Back button on mobile */}
                <button
                  className="md:hidden flex items-center gap-1 text-sm text-muted-foreground mb-3 hover:text-foreground"
                  onClick={() => setSelected(null)}
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-base leading-tight">{selected.subject}</h2>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <div className={cn(
                        "h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0",
                        avatarColor(selected.fromEmail)
                      )}>
                        {senderInitials(selected)}
                      </div>
                      <div>
                        <span className="text-sm font-medium">{selected.fromName ?? selected.fromEmail}</span>
                        {selected.fromName && (
                          <span className="text-xs text-muted-foreground ml-1">&lt;{selected.fromEmail}&gt;</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        → {selected.toEmail}
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {format(new Date(selected.receivedAt), "d MMM yyyy, h:mm a")}
                      </span>
                    </div>
                    <div className="flex gap-1 mt-2">
                      {selected.isReplied && (
                        <Badge variant="outline" className="text-[11px]">
                          Replied {selected.replyCount > 1 ? `(${selected.replyCount}×)` : ""}
                        </Badge>
                      )}
                      {selected.spamScore && parseFloat(selected.spamScore) > 5 && (
                        <Badge variant="destructive" className="text-[11px]">Spam risk</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title={selected.isRead ? "Mark as unread" : "Mark as read"}
                      onClick={() => toggleRead(selected)}
                    >
                      {selected.isRead ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:text-destructive hover:bg-destructive/10"
                      title="Delete"
                      onClick={() => deleteEmail(selected)}
                      disabled={deleting}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Email body */}
              <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 min-h-0">
                {selected.bodyHtml ? (
                  <iframe
                    srcDoc={selected.bodyHtml}
                    className="w-full border-0 rounded-lg bg-white"
                    style={{ minHeight: 400, height: "100%" }}
                    sandbox="allow-same-origin"
                    title="Email body"
                  />
                ) : (
                  <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                    {selected.bodyText ?? "(No body)"}
                  </pre>
                )}
              </div>

              <Separator />

              {/* Reply area */}
              <div className="px-4 md:px-6 py-3 shrink-0">
                {!replying ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setReplying(true)}
                  >
                    <Reply className="h-4 w-4" />
                    Reply to {selected.fromName ?? selected.fromEmail}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">
                        Reply to: {selected.fromEmail}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => { setReplying(false); setReplyBody(""); }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Textarea
                      placeholder="Write your reply…"
                      className="min-h-[120px] resize-none text-sm"
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      autoFocus
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={sendReply}
                        disabled={sendingReply || !replyBody.trim()}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {sendingReply ? "Sending…" : "Send Reply"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
