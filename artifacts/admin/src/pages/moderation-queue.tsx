import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import {
  useAdminGetModerationQueue,
  useAdminApproveReport,
  useAdminRejectReport,
  useAdminKeepFlaggedReport,
  useAdminRemoveFlaggedReport,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2, ShieldAlert, TimerReset, Camera, Flag, RefreshCw, MapPin } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import type { AdminReport } from "@workspace/api-client-react";
import { LocationEditorDialog } from "@/components/location-editor-dialog";

const TYPE_LABELS: Record<string, string> = {
  camera: "Speed Camera",
  police: "Police Checkpoint",
};

const FLAG_REASON_LABELS: Record<string, string> = {
  inaccurate_location: "Inaccurate location",
  already_gone: "Already gone",
  duplicate: "Duplicate",
  spam: "Spam",
  inappropriate: "Inappropriate",
  other: "Other",
};

function QueueRow({
  report,
  onApprove,
  onReject,
  onViewMap,
  isBusy,
  approveLabel,
  rejectLabel,
}: {
  report: AdminReport;
  onApprove: () => void;
  onReject: () => void;
  onViewMap: () => void;
  isBusy: boolean;
  approveLabel: string;
  rejectLabel: string;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between border rounded-lg px-4 py-3 bg-background">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="capitalize">{TYPE_LABELS[report.type] ?? report.type}</Badge>
          {report.speedLimit ? <span className="text-xs text-muted-foreground">{report.speedLimit} km/h</span> : null}
          {report.deviceBlocked && (
            <Badge variant="outline" className="gap-1 shadow-none border-destructive/30 text-destructive bg-destructive/10" title="Reporting device is blocked">
              <ShieldAlert className="h-3 w-3" /> Blocked
            </Badge>
          )}
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
          variant="ghost"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          title="View & edit location on map"
          onClick={onViewMap}
        >
          <MapPin className="h-3.5 w-3.5" />
        </Button>
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

function FlagRow({
  report,
  onKeep,
  onRemove,
  onViewMap,
  isBusy,
}: {
  report: AdminReport;
  onKeep: () => void;
  onRemove: () => void;
  onViewMap: () => void;
  isBusy: boolean;
}) {
  const reasons = report.flagReasons ?? [];
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between border rounded-lg px-4 py-3 bg-background">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="capitalize">{TYPE_LABELS[report.type] ?? report.type}</Badge>
          {report.speedLimit ? <span className="text-xs text-muted-foreground">{report.speedLimit} km/h</span> : null}
          <Badge variant="destructive" className="gap-1">
            <Flag className="h-3 w-3" /> {report.flagCount ?? reasons.length} flag{(report.flagCount ?? 0) !== 1 ? "s" : ""}
          </Badge>
          {report.status === "flagged" && (
            <Badge variant="outline" className="gap-1 shadow-none border-amber-500/30 text-amber-600 bg-amber-500/10">
              Hidden from drivers
            </Badge>
          )}
          {report.deviceBlocked && (
            <Badge variant="outline" className="gap-1 shadow-none border-destructive/30 text-destructive bg-destructive/10" title="Reporting device is blocked">
              <ShieldAlert className="h-3 w-3" /> Blocked
            </Badge>
          )}
        </div>
        <div className="text-sm font-medium text-foreground mt-1 truncate">
          {report.roadName || `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}`}
        </div>
        {reasons.length > 0 && (
          <div className="text-xs text-muted-foreground mt-0.5">
            Reasons: {reasons.map((r) => FLAG_REASON_LABELS[r] ?? r).join(", ")}
          </div>
        )}
        <div className="text-xs text-muted-foreground mt-0.5 font-mono">
          Submitted {format(new Date(report.createdAt), "MMM d, HH:mm")} · device {report.deviceId.slice(0, 12)}…
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          title="View & edit location on map"
          onClick={onViewMap}
        >
          <MapPin className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-2 h-8 shadow-none border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
          disabled={isBusy}
          onClick={onKeep}
          data-testid={`btn-keep-${report.id}`}
        >
          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {report.status === "flagged" ? "Restore" : "Keep"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-2 h-8 shadow-none border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={isBusy}
          onClick={onRemove}
          data-testid={`btn-remove-flagged-${report.id}`}
        >
          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          Delete
        </Button>
      </div>
    </div>
  );
}

export default function ModerationQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [locationEditorReport, setLocationEditorReport] = useState<AdminReport | null>(null);

  const { data, isLoading, isFetching, refetch } = useAdminGetModerationQueue();

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

  const keepMutation = useAdminKeepFlaggedReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Report kept live" });
        invalidate();
      },
      onError: () => toast({ title: "Action failed", variant: "destructive" }),
    },
  });

  const removeMutation = useAdminRemoveFlaggedReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Report removed", description: "It is no longer visible to drivers." });
        invalidate();
      },
      onError: () => toast({ title: "Remove failed", variant: "destructive" }),
    },
  });

  const busyId = approveMutation.isPending ? approveMutation.variables?.id : rejectMutation.isPending ? rejectMutation.variables?.id : undefined;
  const flagBusyId = keepMutation.isPending ? keepMutation.variables?.id : removeMutation.isPending ? removeMutation.variables?.id : undefined;

  const expired = data?.expired ?? [];
  const pendingReview = data?.pendingReview ?? [];
  const flagged = data?.flagged ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="border-b pb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-page-title">Moderation Queue</h1>
            <p className="text-muted-foreground mt-1" data-testid="text-page-description">
              Review new camera/checkpoint submissions and decide whether to restore recently expired reports.
            </p>
          </div>
          <Button
            variant="outline"
            className="gap-2 shadow-none shrink-0"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Fetch latest items from the server"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flag className="h-4 w-4 text-primary" /> Flagged by Drivers
              {flagged.length > 0 && <Badge className="ml-1">{flagged.length}</Badge>}
            </CardTitle>
            <CardDescription>
              Reports drivers flagged as inaccurate or inappropriate. Drivers can't remove reports themselves — decide here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
            ) : flagged.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">No flagged reports awaiting review.</div>
            ) : (
              flagged.map((r) => (
                <FlagRow
                  key={r.id}
                  report={r}
                  isBusy={flagBusyId === r.id}
                  onKeep={() => keepMutation.mutate({ id: r.id })}
                  onRemove={() => removeMutation.mutate({ id: r.id })}
                  onViewMap={() => setLocationEditorReport(r)}
                />
              ))
            )}
          </CardContent>
        </Card>

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
                  onViewMap={() => setLocationEditorReport(r)}
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
                  onViewMap={() => setLocationEditorReport(r)}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {locationEditorReport && (
        <LocationEditorDialog
          open={true}
          onOpenChange={(open) => { if (!open) setLocationEditorReport(null); }}
          report={locationEditorReport}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/moderation-queue"] })}
        />
      )}
    </AdminLayout>
  );
}
