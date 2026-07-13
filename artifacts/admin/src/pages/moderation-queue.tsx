import { AdminLayout } from "@/components/layout/admin-layout";
import { useAdminGetModerationQueue, useAdminApproveReport, useAdminRejectReport } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2, ShieldAlert, TimerReset, Camera } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import type { AdminReport } from "@workspace/api-client-react";

const TYPE_LABELS: Record<string, string> = {
  camera: "Speed Camera",
  police: "Police Checkpoint",
};

function QueueRow({
  report,
  onApprove,
  onReject,
  isBusy,
  approveLabel,
  rejectLabel,
}: {
  report: AdminReport;
  onApprove: () => void;
  onReject: () => void;
  isBusy: boolean;
  approveLabel: string;
  rejectLabel: string;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between border rounded-lg px-4 py-3 bg-background">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="capitalize">{TYPE_LABELS[report.type] ?? report.type}</Badge>
          {report.speedLimit ? <span className="text-xs text-muted-foreground">{report.speedLimit} km/h</span> : null}
        </div>
        <div className="text-sm font-medium text-foreground mt-1 truncate">
          {report.roadName || `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 font-mono">
          Submitted {format(new Date(report.createdAt), "MMM d, HH:mm")} · device {report.deviceId.slice(0, 12)}…
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          className="gap-2 h-8 shadow-none border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
          disabled={isBusy}
          onClick={onApprove}
          data-testid={`btn-approve-${report.id}`}
        >
          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {approveLabel}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-2 h-8 shadow-none border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={isBusy}
          onClick={onReject}
          data-testid={`btn-reject-${report.id}`}
        >
          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          {rejectLabel}
        </Button>
      </div>
    </div>
  );
}

export default function ModerationQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useAdminGetModerationQueue({
    query: { queryKey: ["/api/admin/reports/moderation-queue"], refetchInterval: 30000 },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/moderation-queue"] });

  const approveMutation = useAdminApproveReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Report approved", description: "It is now live for drivers." });
        invalidate();
      },
      onError: () => toast({ title: "Approve failed", variant: "destructive" }),
    },
  });

  const rejectMutation = useAdminRejectReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Report rejected" });
        invalidate();
      },
      onError: () => toast({ title: "Reject failed", variant: "destructive" }),
    },
  });

  const busyId = approveMutation.isPending ? approveMutation.variables?.id : rejectMutation.isPending ? rejectMutation.variables?.id : undefined;

  const expired = data?.expired ?? [];
  const pendingReview = data?.pendingReview ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-page-title">Moderation Queue</h1>
          <p className="text-muted-foreground mt-1" data-testid="text-page-description">
            Review new camera/checkpoint submissions and decide whether to restore recently expired reports.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4 text-primary" /> Pending Review
              {pendingReview.length > 0 && <Badge className="ml-1">{pendingReview.length}</Badge>}
            </CardTitle>
            <CardDescription>New speed camera and checkpoint reports not yet visible to drivers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
            ) : pendingReview.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Nothing awaiting first review.</div>
            ) : (
              pendingReview.map((r) => (
                <QueueRow
                  key={r.id}
                  report={r}
                  isBusy={busyId === r.id}
                  approveLabel="Publish"
                  rejectLabel="Deny"
                  onApprove={() => approveMutation.mutate({ id: r.id })}
                  onReject={() => rejectMutation.mutate({ id: r.id })}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TimerReset className="h-4 w-4 text-primary" /> Recently Expired
              {expired.length > 0 && <Badge className="ml-1">{expired.length}</Badge>}
            </CardTitle>
            <CardDescription>Reports that expired automatically — restore if still valid, or dismiss to clear from this list.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
            ) : expired.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center flex flex-col items-center gap-2">
                <ShieldAlert className="h-5 w-5 opacity-50" />
                No expired reports awaiting a decision.
              </div>
            ) : (
              expired.map((r) => (
                <QueueRow
                  key={r.id}
                  report={r}
                  isBusy={busyId === r.id}
                  approveLabel="Restore"
                  rejectLabel="Dismiss"
                  onApprove={() => approveMutation.mutate({ id: r.id })}
                  onReject={() => rejectMutation.mutate({ id: r.id })}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
