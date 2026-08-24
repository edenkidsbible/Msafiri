import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Bell,
  Plus,
  Trash2,
  Smartphone,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Zap,
  WifiOff,
} from "lucide-react";
import { PageGuide } from "@/components/page-guide";

const API_BASE = "/api";

async function authFetch(path: string, init?: RequestInit) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

interface DeviceStats {
  total: number;
  byPlatform: Record<string, number>;
  bgWakeupTotal: number;
  bgWakeupByPlatform: Record<string, number>;
  lastBgWakeupAt: string | null;
}

interface DeviceRow {
  deviceId: string;
  platform: string;
  lastSeenAt: string | null;
  lastBgWakeupAt: string | null;
}

interface DeviceListResponse {
  total: number;
  page: number;
  limit: number;
  devices: DeviceRow[];
}

interface Campaign {
  id: string;
  title: string;
  body: string;
  type: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  sentCount: number;
  failedCount: number;
  targetCount: number | null;
  createdBy: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  sent:      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  sending:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  scheduled: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  draft:     "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
  failed:    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const TYPE_LABELS: Record<string, string> = {
  broadcast:      "Broadcast",
  scheduled:      "Scheduled",
  daily_morning:  "Morning Reminder",
  daily_evening:  "Evening Reminder",
  engagement:     "Engagement",
  incident:       "Incident Alert",
  incident_check: "Incident Check",
  silent_ping:    "Silent Wake-up Ping",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? STATUS_COLORS.draft}`}>
      {status === "sent"      && <CheckCircle2 className="h-3 w-3" />}
      {status === "sending"   && <RotateCcw className="h-3 w-3 animate-spin" />}
      {status === "scheduled" && <Clock className="h-3 w-3" />}
      {status === "failed"    && <AlertCircle className="h-3 w-3" />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ComposeDialog({ onSent }: { onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Required fields", description: "Title and message are required.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await authFetch("/admin/push/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          scheduledAt: scheduledAt || undefined,
        }),
      });
      toast({ title: scheduledAt ? "Notification scheduled!" : "Notification sent!", description: scheduledAt ? `Scheduled for ${new Date(scheduledAt).toLocaleString()}` : `Sent to all registered devices.` });
      setTitle("");
      setBody("");
      setScheduledAt("");
      setOpen(false);
      onSent();
    } catch {
      toast({ title: "Failed", description: "Could not send notification. Try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const charCount = body.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          New Notification
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Push Notification</DialogTitle>
          <DialogDescription>
            Send immediately to all devices, or schedule for a specific time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="push-title">Title</Label>
            <Input
              id="push-title"
              placeholder="e.g. 🚨 New hazard reported on Thika Road"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
            />
            <p className="text-xs text-muted-foreground text-right">{title.length}/80</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="push-body">Message</Label>
            <Textarea
              id="push-body"
              placeholder="e.g. An accident has been reported near Westlands roundabout. Check Msafiri for the latest updates."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={250}
            />
            <p className="text-xs text-muted-foreground text-right">{charCount}/250</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="push-schedule">Schedule for (optional)</Label>
            <Input
              id="push-schedule"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Leave empty to send immediately to all devices.</p>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSend} disabled={loading} className="gap-2">
              {loading ? <RotateCcw className="h-4 w-4 animate-spin" /> : scheduledAt ? <Clock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {scheduledAt ? "Schedule" : "Send Now"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SilentPingDialog({ onSent }: { onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ sent: number; dormantDevices: number } | null>(null);
  const { toast } = useToast();

  const handlePing = async () => {
    setLoading(true);
    try {
      const data = await authFetch("/admin/push/silent-ping", { method: "POST" });
      setResult({ sent: data.sent, dormantDevices: data.dormantDevices });
      toast({
        title: "Silent ping sent",
        description: `Woke up ${data.sent} of ${data.dormantDevices} dormant device(s). No visible notification shown.`,
      });
      onSent();
    } catch {
      toast({ title: "Failed", description: "Could not send silent ping. Try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setResult(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Zap className="h-4 w-4" />
          Silent Wake-up Ping
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Silent Wake-up Ping</DialogTitle>
          <DialogDescription>
            Sends a silent (invisible) push to all devices that haven't opened the app in 3+ days.
            No banner or sound is shown — the app wakes briefly in the background to refresh its
            push token and location so future notifications can reach it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground space-y-1">
            <p>✅ No visible notification is shown to users</p>
            <p>✅ Refreshes stale push tokens automatically</p>
            <p>✅ Updates device location for better targeting</p>
            <p>⚠️ Targets dormant users only (3+ days inactive)</p>
          </div>
          {result && (
            <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900 p-3 text-sm">
              <p className="font-medium text-green-800 dark:text-green-400">
                Ping sent to {result.sent} of {result.dormantDevices} dormant device(s)
              </p>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={handlePing} disabled={loading} className="gap-2">
              {loading ? <RotateCcw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {loading ? "Sending…" : "Send Ping"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AndroidTestButton({ onSent }: { onSent: () => void }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const sendTest = async () => {
    setLoading(true);
    try {
      const result = await authFetch("/admin/push/test/android-latest", { method: "POST" });
      const description =
        result.delivery === "confirmed"
          ? "Expo confirmed delivery to the most recently active Android device. Check the notification shade."
          : result.delivery === "fcm_credentials"
            ? "Expo could not authenticate with Firebase Cloud Messaging. Replace the Android FCM V1 service-account credential in Expo before retesting."
            : result.delivery === "failed"
              ? "Expo accepted the request but the device delivery receipt failed. Review the Android push diagnostics."
              : "Expo accepted a test for the most recently active Android device. Check that phone now.";
      toast({
        title: result.delivery === "confirmed" ? "Android delivery confirmed" : result.sent ? "Android test needs attention" : "Android test failed",
        description: result.sent ? description : "Expo did not accept the test notification.",
        variant: result.delivery === "confirmed" ? "default" : "destructive",
      });
      onSent();
    } catch {
      toast({
        title: "Android test unavailable",
        description: "No Android device is registered, or the delivery request failed.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={sendTest} disabled={loading}>
      {loading ? <RotateCcw className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
      Test Latest Android
    </Button>
  );
}

export default function PushCampaigns() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: deviceStats } = useQuery<DeviceStats>({
    queryKey: ["/api/admin/push/devices"],
    queryFn: () => authFetch("/admin/push/devices"),
    refetchInterval: 60000,
  });

  const { data: campaignData, isLoading } = useQuery<{ campaigns: Campaign[] }>({
    queryKey: ["/api/admin/push/campaigns"],
    queryFn: () => authFetch("/admin/push/campaigns"),
    refetchInterval: 30000,
  });

  const [showDeviceList, setShowDeviceList] = useState(false);
  const [devicePage, setDevicePage] = useState(1);
  const devicePageSize = 100;
  const { data: deviceListData, isLoading: devicesLoading } = useQuery<DeviceListResponse>({
    queryKey: ["/api/admin/push/devices/list", devicePage],
    queryFn: () => authFetch(`/admin/push/devices/list?page=${devicePage}&limit=${devicePageSize}`),
    enabled: showDeviceList,
    refetchInterval: showDeviceList ? 60000 : false,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      authFetch(`/admin/push/campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/push/campaigns"] });
      toast({ title: "Deleted", description: "Campaign removed." });
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/push/devices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/push/campaigns"] });
  };

  const campaigns = campaignData?.campaigns ?? [];
  const ios          = deviceStats?.byPlatform?.ios ?? 0;
  const android      = deviceStats?.byPlatform?.android ?? 0;
  const other        = (deviceStats?.total ?? 0) - ios - android;
  const bgWakeupTotal = deviceStats?.bgWakeupTotal ?? 0;
  const lastBgWakeup  = deviceStats?.lastBgWakeupAt
    ? new Date(deviceStats.lastBgWakeupAt).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })
    : null;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Push Notifications</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Broadcast messages, reminders, and alerts to all registered devices.
            </p>
          </div>
          <div className="flex gap-2">
            <AndroidTestButton onSent={refresh} />
            <SilentPingDialog onSent={refresh} />
            <ComposeDialog onSent={refresh} />
          </div>
        </div>

        <PageGuide
          title="Sending push campaigns"
          steps={[
            { label: "Targeting", detail: "a campaign targets all users, a segment, or a single user ID." },
            { label: "Content", detail: "write the title (shown as notification header) and body (the preview line)." },
            { label: "Test first", detail: "preview on a test device before sending to all — there is no recall." },
            { label: "Delivery time", detail: "large sends are queued; delivery may take a few minutes." },
          ]}
        />

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Devices</p>
                  <p className="text-3xl font-bold mt-1">{deviceStats?.total ?? 0}</p>
                </div>
                <div className="bg-primary/10 text-primary rounded-full p-3">
                  <Smartphone className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">iOS</p>
                  <p className="text-3xl font-bold mt-1">{ios}</p>
                </div>
                <div className="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 rounded-full p-3">
                  <Bell className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Android</p>
                  <p className="text-3xl font-bold mt-1">{android}</p>
                </div>
                <div className="bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 rounded-full p-3">
                  <Bell className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">BG Wakeups</p>
                  <p className="text-3xl font-bold mt-1">{bgWakeupTotal}</p>
                  {lastBgWakeup ? (
                    <p className="text-xs text-muted-foreground mt-1" title="Most recent background task execution">
                      Last: {lastBgWakeup}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">No wakeups yet</p>
                  )}
                </div>
                <div className="bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 rounded-full p-3">
                  <WifiOff className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Background wakeup device list */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <WifiOff className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  Background Wakeup Log
                  {showDeviceList && deviceListData && (
                    <span className="text-xs font-normal text-muted-foreground">
                      — {deviceListData.total} device{deviceListData.total !== 1 ? "s" : ""} total
                    </span>
                  )}
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Per-device record of when each device last confirmed a background task execution
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowDeviceList((v) => !v); setDevicePage(1); }}
              >
                {showDeviceList ? "Hide" : "Show devices"}
              </Button>
            </div>
          </CardHeader>
          {showDeviceList && (
            <CardContent className="p-0">
              {devicesLoading ? (
                <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                  Loading devices…
                </div>
              ) : !deviceListData?.devices.length ? (
                <div className="flex flex-col items-center justify-center h-24 gap-2 text-muted-foreground">
                  <WifiOff className="h-7 w-7 opacity-30" />
                  <p className="text-sm">No registered devices yet.</p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Device ID</TableHead>
                        <TableHead>Platform</TableHead>
                        <TableHead>Last Seen</TableHead>
                        <TableHead>Last BG Wakeup</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deviceListData.devices.map((d) => (
                        <TableRow key={d.deviceId}>
                          <TableCell className="font-mono text-xs text-muted-foreground max-w-[140px] truncate" title={d.deviceId}>
                            {d.deviceId.slice(0, 12)}…
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs font-normal capitalize">
                              {d.platform}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {d.lastSeenAt
                              ? new Date(d.lastSeenAt).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })
                              : "—"}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {d.lastBgWakeupAt ? (
                              <span className="text-green-700 dark:text-green-400 font-medium">
                                {new Date(d.lastBgWakeupAt).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })}
                              </span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400">Never</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {/* Pagination */}
                  {deviceListData.total > devicePageSize && (
                    <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
                      <span>
                        Page {devicePage} of {Math.ceil(deviceListData.total / devicePageSize)} ({deviceListData.total} devices)
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={devicePage <= 1}
                          onClick={() => setDevicePage((p) => p - 1)}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={devicePage >= Math.ceil(deviceListData.total / devicePageSize)}
                          onClick={() => setDevicePage((p) => p + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          )}
        </Card>

        {/* Automatic schedule info */}
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              Automatic Daily Notifications
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-white dark:bg-card border p-3">
                <p className="font-semibold text-foreground">🌅 Morning Reminder</p>
                <p className="text-muted-foreground text-xs mt-1">7:00 AM daily (EAT)</p>
                <p className="text-muted-foreground text-xs">Encourages users to check road conditions</p>
              </div>
              <div className="rounded-lg bg-white dark:bg-card border p-3">
                <p className="font-semibold text-foreground">🌆 Evening Reminder</p>
                <p className="text-muted-foreground text-xs mt-1">5:30 PM daily (EAT)</p>
                <p className="text-muted-foreground text-xs">Rush-hour heads-up with live hazard prompt</p>
              </div>
              <div className="rounded-lg bg-white dark:bg-card border p-3">
                <p className="font-semibold text-foreground">📍 Engagement Nudge</p>
                <p className="text-muted-foreground text-xs mt-1">Wednesdays 12:00 PM (EAT)</p>
                <p className="text-muted-foreground text-xs">Encourages users to submit reports</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Campaigns table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Campaign History</CardTitle>
                <CardDescription className="mt-0.5">All manual and automatic push campaigns</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                Loading campaigns…
              </div>
            ) : campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
                <Bell className="h-8 w-8 opacity-30" />
                <p className="text-sm">No campaigns yet. Send your first notification above.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Notification</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead>Sent At</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="max-w-xs">
                          <p className="font-medium text-sm truncate">{c.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{c.body}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-normal">
                          {TYPE_LABELS[c.type] ?? c.type}
                        </Badge>
                      </TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="text-right font-mono text-sm">{c.sentCount.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        {c.type === "incident_check" && c.targetCount != null
                          ? <span title="Nearby devices targeted">{c.targetCount.toLocaleString()}</span>
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-destructive">
                        {c.failedCount > 0 ? c.failedCount : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {c.sentAt
                          ? new Date(c.sentAt).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })
                          : c.scheduledAt
                          ? `⏰ ${new Date(c.scheduledAt).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground capitalize">{c.createdBy}</TableCell>
                      <TableCell>
                        {c.type === "broadcast" || c.type === "scheduled" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteMutation.mutate(c.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
