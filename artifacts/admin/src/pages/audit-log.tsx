import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useAdminListAuditLogs } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ArrowRight, ClipboardList, Loader2 } from "lucide-react";
import { format } from "date-fns";

const ACTION_COLORS: Record<string, string> = {
  "report.create":       "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
  "report.update":       "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20",
  "report.delete":       "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
  "report.bulk_confirm": "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/20",
  "report.bulk_deny":    "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20",
  "report.bulk_delete":  "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
  "report.export":       "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20",
  "user.create":         "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20",
  "user.update":         "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20",
  "user.delete":         "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20",
};

const ROLE_BADGE: Record<string, string> = {
  admin:     "bg-primary/10 text-primary border-primary/20",
  moderator: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  staff:     "bg-secondary text-secondary-foreground border-secondary",
};

const ACTION_LABELS: Record<string, string> = {
  "report.create":       "Created Report",
  "report.update":       "Updated Report",
  "report.delete":       "Deleted Report",
  "report.bulk_confirm": "Bulk Confirmed",
  "report.bulk_deny":    "Bulk Denied",
  "report.bulk_delete":  "Bulk Deleted",
  "report.export":       "Exported Reports",
  "user.create":         "Created User",
  "user.update":         "Updated User",
  "user.delete":         "Deleted User",
};

const KNOWN_ACTIONS = Object.keys(ACTION_LABELS);

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>("all");

  const { data, isLoading } = useAdminListAuditLogs({
    page,
    limit: 25,
    action: actionFilter !== "all" ? actionFilter : undefined,
  });

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Activity Log</h1>
            <p className="text-muted-foreground mt-1">Complete record of who changed what and when.</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[200px] bg-background">
                <SelectValue placeholder="All Actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {KNOWN_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>{ACTION_LABELS[a]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-[180px]">Timestamp</TableHead>
                <TableHead className="w-[160px]">Actor</TableHead>
                <TableHead className="w-[70px]">Role</TableHead>
                <TableHead className="w-[180px]">Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />
                    Loading audit log...
                  </TableCell>
                </TableRow>
              ) : data?.logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center">
                    <ClipboardList className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-20" />
                    <p className="text-muted-foreground font-medium">No activity yet</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">Actions will appear here as the team uses the platform.</p>
                  </TableCell>
                </TableRow>
              ) : (
                data?.logs.map((log) => (
                  <TableRow key={log.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.createdAt), "MMM d, HH:mm:ss")}
                    </TableCell>
                    <TableCell className="font-medium text-sm text-foreground">{log.actorName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize text-xs shadow-none ${ROLE_BADGE[log.actorRole] ?? "bg-secondary"}`}>
                        {log.actorRole}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs shadow-none ${ACTION_COLORS[log.action] ?? "bg-secondary text-secondary-foreground"}`}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.targetType && log.targetId ? (
                        <span className="capitalize">{log.targetType} <span className="font-mono text-xs">{log.targetId.slice(0, 8)}…</span></span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                      {log.details ? JSON.stringify(log.details) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {data && data.total > data.limit && (
          <div className="flex items-center justify-between px-2">
            <span className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{(page - 1) * data.limit + 1}</span> to{" "}
              <span className="font-medium text-foreground">{Math.min(page * data.limit, data.total)}</span> of{" "}
              <span className="font-medium text-foreground">{data.total}</span> entries
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 shadow-none" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Previous
              </Button>
              <Button variant="outline" size="sm" className="h-8 shadow-none" disabled={page * data.limit >= data.total} onClick={() => setPage((p) => p + 1)}>
                Next <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
