import { AdminLayout } from "@/components/layout/admin-layout";
import { useAdminListNotifications, useAdminMarkNotificationRead, useAdminMarkAllNotificationsRead, useAdminDeleteNotification } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, CheckCheck, Trash2, Loader2, Info, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<string, { icon: typeof Info; color: string }> = {
  info:    { icon: Info,          color: "text-blue-500" },
  warning: { icon: AlertTriangle, color: "text-amber-500" },
  error:   { icon: XCircle,       color: "text-destructive" },
  success: { icon: CheckCircle2,  color: "text-emerald-500" },
};

export default function Notifications() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useAdminListNotifications({
    query: { queryKey: ["/api/admin/notifications"], refetchInterval: 30000 },
  });

  const markReadMutation = useAdminMarkNotificationRead({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/notifications"] }),
    },
  });

  const markAllReadMutation = useAdminMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/notifications"] });
        toast({ title: "All notifications marked as read" });
      },
    },
  });

  const deleteMutation = useAdminDeleteNotification({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/notifications"] }),
    },
  });

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Notifications</h1>
            <p className="text-muted-foreground mt-1">
              Team alerts and system events.
              {data?.unreadCount ? (
                <span className="ml-2 text-primary font-medium">{data.unreadCount} unread</span>
              ) : null}
            </p>
          </div>
          {(data?.unreadCount ?? 0) > 0 && (
            <Button
              variant="outline"
              className="gap-2 shadow-none"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              {markAllReadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              Mark all read
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading notifications...
          </div>
        ) : data?.notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border rounded-xl bg-muted/10">
            <BellOff className="h-10 w-10 text-muted-foreground opacity-20 mb-3" />
            <p className="text-muted-foreground font-medium">No notifications</p>
            <p className="text-sm text-muted-foreground/70 mt-1">You're all caught up.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data?.notifications.map((n) => {
              const meta = TYPE_ICON[n.type] ?? TYPE_ICON.info;
              const Icon = meta.icon;
              return (
                <div
                  key={n.id}
                  className={cn(
                    "flex items-start gap-4 p-4 rounded-xl border transition-colors",
                    n.isRead
                      ? "bg-card border-border/50 opacity-70"
                      : "bg-card border-border shadow-sm"
                  )}
                >
                  <div className={cn("mt-0.5 shrink-0", meta.color)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn("text-sm font-medium", n.isRead ? "text-muted-foreground" : "text-foreground")}>
                        {n.title}
                      </p>
                      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                        {format(new Date(n.createdAt), "MMM d, HH:mm")}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!n.isRead && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="Mark as read"
                        onClick={() => markReadMutation.mutate({ id: n.id })}
                      >
                        <Bell className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete"
                      onClick={() => deleteMutation.mutate({ id: n.id })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
