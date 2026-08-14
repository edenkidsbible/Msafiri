import { AdminLayout } from "@/components/layout/admin-layout";
import { PageGuide } from "@/components/page-guide";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, HardDrive, RefreshCw, XCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface DeviceQuota {
  deviceId: string;
  clipCount: number;
  unlockedCount: number;
  lockedCount: number;
  percentOfQuota: number;
  quota: number;
}

interface DevicesResponse {
  devices: DeviceQuota[];
  quota: number;
}

function statusBadge(pct: number) {
  if (pct >= 100) {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        Full
      </Badge>
    );
  }
  if (pct >= 80) {
    return (
      <Badge variant="outline" className="gap-1 border-yellow-500 text-yellow-600 dark:text-yellow-400">
        <AlertTriangle className="h-3 w-3" />
        Near Limit
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-green-500 text-green-600 dark:text-green-400">
      <CheckCircle2 className="h-3 w-3" />
      OK
    </Badge>
  );
}

function progressColor(pct: number) {
  if (pct >= 100) return "bg-destructive";
  if (pct >= 80) return "bg-yellow-500";
  return "bg-primary";
}

export default function DashcamDevices() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<DevicesResponse>({
    queryKey: ["admin-dashcam-devices"],
    queryFn: async () => {
      const token = getToken();
      const r = await fetch("/api/admin/dashcam/devices", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to load dashcam device data");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const devices    = data?.devices ?? [];
  const quota      = data?.quota   ?? 100;
  const atQuota    = devices.filter((d) => d.percentOfQuota >= 100).length;
  const nearQuota  = devices.filter((d) => d.percentOfQuota >= 80 && d.percentOfQuota < 100).length;

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-1 border-b pb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                <HardDrive className="h-7 w-7" />
                Dashcam Storage
              </h1>
              <p className="text-muted-foreground mt-1">
                Cloud clip quota per device. Each device can store up to {quota} clips.
                Oldest unlocked clips are auto-evicted when a device is full.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <PageGuide
          title="Reading dashcam storage"
          steps={[
            { label: "Quota per device", detail: "each row shows how many clips a device has stored against its per-device quota limit." },
            { label: "Locked vs unlocked clips", detail: "locked clips (user-protected) are never auto-evicted; when a device hits its quota, the oldest unlocked clips are removed automatically." },
            { label: "Monitoring only", detail: "this view is read-only — use it to spot devices at or near their quota; clip management happens on the device itself." },
          ]}
        />

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Devices</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-3xl font-bold">{devices.length}</p>
              )}
            </CardContent>
          </Card>

          <Card className={nearQuota > 0 ? "border-yellow-500/50" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Near Limit (≥ 80%)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">
                  {nearQuota}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className={atQuota > 0 ? "border-destructive/50" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <XCircle className="h-4 w-4 text-destructive" />
                At Quota (100%)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-3xl font-bold text-destructive">{atQuota}</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Device table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-Device Clip Counts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : isError ? (
              <div className="p-6 text-center text-muted-foreground">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
                Failed to load device data.{" "}
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="underline text-primary"
                >
                  Retry
                </button>
              </div>
            ) : devices.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">
                <HardDrive className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No devices have uploaded clips yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Device ID</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground w-32">Clips</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground w-24">Locked</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground w-24">Unlocked</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground w-48">Usage</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground w-28">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device) => (
                      <tr
                        key={device.deviceId}
                        className={`border-b last:border-0 hover:bg-muted/20 transition-colors ${
                          device.percentOfQuota >= 100
                            ? "bg-destructive/5"
                            : device.percentOfQuota >= 80
                            ? "bg-yellow-500/5"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {device.deviceId}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">
                          {device.clipCount}
                          <span className="text-muted-foreground font-normal">/{quota}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                          {device.lockedCount}
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                          {device.unlockedCount}
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full transition-all ${progressColor(device.percentOfQuota)}`}
                                style={{ width: `${Math.min(device.percentOfQuota, 100)}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground text-right">
                              {device.percentOfQuota}%
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {statusBadge(device.percentOfQuota)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
