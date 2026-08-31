import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, EyeOff, Loader2, Radio, RefreshCw, ShieldAlert, Trash2, Volume2 } from "lucide-react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth";

interface RoadChannelRecord {
  id: string;
  channel: string;
  deviceId: string;
  contentType: string;
  sizeBytes: number | null;
  lat: number | null;
  lng: number | null;
  transcript: string | null;
  summary: string | null;
  proposedType: string | null;
  durationMs: number | null;
  status: string;
  moderationStatus: string;
  moderationReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
  reportCount: number;
  deviceBlocked: boolean;
  playbackUrl: string | null;
}

interface BlockedDevice {
  deviceId: string;
  reason: string | null;
  blockedBy: string;
  createdAt: string;
}

interface ModerationResponse {
  records: RoadChannelRecord[];
  blockedDevices: BlockedDevice[];
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function statusClass(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "hidden" || status === "rejected") return "destructive";
  return "secondary";
}

export default function RoadChannels() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const queryKey = ["/api/admin/road-channels/moderation"];
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: () => requestJson<ModerationResponse>("/api/admin/road-channels/moderation"),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const moderate = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "hide" | "remove" }) =>
      requestJson(`/api/admin/road-channels/moderation/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      }),
    onSuccess: (_data, variables) => {
      toast({ title: variables.action === "remove" ? "Contribution removed" : `Contribution ${variables.action}d` });
      invalidate();
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });
  const blockDevice = useMutation({
    mutationFn: (input: { deviceId: string; reason?: string }) => requestJson("/api/admin/road-channels/blocked-devices", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    onSuccess: () => {
      toast({ title: "Contributor device blocked" });
      setDeviceId("");
      setBlockReason("");
      invalidate();
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });
  const unblockDevice = useMutation({
    mutationFn: (id: string) => requestJson(`/api/admin/road-channels/blocked-devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Contributor device unblocked" });
      invalidate();
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });

  const records = data?.records ?? [];
  const blockedDevices = data?.blockedDevices ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="border-b pb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Road Channels moderation</h1>
            <p className="text-muted-foreground mt-1" data-testid="text-page-description">
              Review private driver audio contributions and channel-specific safety reports. Incident reports are moderated separately.
            </p>
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-road-channels">
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Contributor device controls</CardTitle>
            <CardDescription>Blocking prevents this device from uploading or confirming Road Channels voice reports.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="road-channel-device">Device ID</Label>
                <Input id="road-channel-device" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} placeholder="Contributor device ID" data-testid="input-block-device-id" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="road-channel-block-reason">Reason (optional)</Label>
                <Input id="road-channel-block-reason" value={blockReason} onChange={(event) => setBlockReason(event.target.value)} placeholder="Abuse or spam" data-testid="input-block-device-reason" />
              </div>
              <Button
                className="self-end"
                variant="destructive"
                disabled={!deviceId.trim() || blockDevice.isPending}
                onClick={() => blockDevice.mutate({ deviceId: deviceId.trim(), reason: blockReason.trim() || undefined })}
                data-testid="button-block-contributor-device"
              >
                {blockDevice.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldAlert className="h-4 w-4 mr-2" />} Block device
              </Button>
            </div>
            {blockedDevices.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                {blockedDevices.map((blocked) => (
                  <div key={blocked.deviceId} className="flex items-center justify-between gap-3 text-sm" data-testid={`text-blocked-device-${blocked.deviceId}`}>
                    <div className="min-w-0">
                      <span className="font-mono break-all">{blocked.deviceId}</span>
                      <span className="text-muted-foreground"> · {blocked.reason || "No reason provided"} · by {blocked.blockedBy}</span>
                    </div>
                    <Button size="sm" variant="outline" disabled={unblockDevice.isPending} onClick={() => unblockDevice.mutate(blocked.deviceId)} data-testid={`button-unblock-device-${blocked.deviceId}`}>
                      Unblock
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Radio className="h-5 w-5" /> Voice contributions <Badge variant="secondary">{records.length}</Badge></CardTitle>
            <CardDescription>Playback links are private, short-lived URLs available only in this moderation surface.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="py-10 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading contributions…</div>
            ) : records.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground" data-testid="text-empty-road-channel-records">No Road Channels contributions found.</div>
            ) : records.map((record) => {
              const busy = moderate.isPending && moderate.variables?.id === record.id;
              return (
                <article key={record.id} className="border rounded-lg p-4 space-y-3" data-testid={`road-channel-record-${record.id}`}>
                  <div className="flex flex-col lg:flex-row lg:justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex gap-2 flex-wrap items-center">
                        <Badge variant="outline">{record.channel}</Badge>
                        <Badge variant={statusClass(record.moderationStatus)} data-testid={`status-road-channel-${record.id}`}>{record.moderationStatus}</Badge>
                        <Badge variant="secondary">{record.reportCount} channel report{record.reportCount === 1 ? "" : "s"}</Badge>
                        {record.deviceBlocked && <Badge variant="destructive">Device blocked</Badge>}
                      </div>
                      <p className="font-medium" data-testid={`text-road-channel-summary-${record.id}`}>{record.summary || record.transcript || "No transcript available"}</p>
                      <p className="text-xs text-muted-foreground font-mono break-all">Device {record.deviceId} · {format(new Date(record.createdAt), "MMM d, yyyy HH:mm")} · {record.status}</p>
                      {record.transcript && record.summary && <p className="text-sm text-muted-foreground">Transcript: {record.transcript}</p>}
                      {record.moderationReason && <p className="text-sm text-destructive">Reason: {record.moderationReason}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2 items-start shrink-0">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => moderate.mutate({ id: record.id, action: "approve" })} data-testid={`button-approve-road-channel-${record.id}`}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => moderate.mutate({ id: record.id, action: "hide" })} data-testid={`button-hide-road-channel-${record.id}`}>
                        <EyeOff className="h-4 w-4 mr-1" /> Hide
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busy} onClick={() => moderate.mutate({ id: record.id, action: "remove" })} data-testid={`button-remove-road-channel-${record.id}`}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />} Remove
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                    <span className="text-sm text-muted-foreground flex items-center gap-2"><Volume2 className="h-4 w-4" /> Private playback</span>
                    {record.playbackUrl
                      ? <audio controls src={record.playbackUrl} className="max-w-full h-9" data-testid={`audio-road-channel-${record.id}`} />
                      : <span className="text-sm text-muted-foreground">Audio expired</span>}
                    <Button size="sm" variant={record.deviceBlocked ? "outline" : "secondary"} disabled={blockDevice.isPending || record.deviceBlocked} onClick={() => blockDevice.mutate({ deviceId: record.deviceId, reason: "Blocked from Road Channels moderation" })} data-testid={`button-block-record-device-${record.id}`}>
                      {record.deviceBlocked ? "Device blocked" : "Block device"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}