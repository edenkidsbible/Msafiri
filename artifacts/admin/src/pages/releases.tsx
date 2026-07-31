import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Rocket, Plus, MoreVertical, CheckCircle2, Clock, AlertTriangle,
  XCircle, Smartphone, Zap, Globe, Apple, Bell, CalendarClock,
} from "lucide-react";

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

interface Release {
  id: string;
  version: string;
  buildNumber: number;
  platform: string;
  releaseType: string;
  releaseNotes: string | null;
  status: string;
  isForceUpdate: boolean;
  storeUrlIos: string | null;
  storeUrlAndroid: string | null;
  scheduledAt: string | null;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
}

/** Returns the missing store URLs for a force-update release given its platform */
function missingStoreUrls(release: Pick<Release, "platform" | "storeUrlIos" | "storeUrlAndroid" | "isForceUpdate">): string[] {
  if (!release.isForceUpdate) return [];
  const missing: string[] = [];
  if (release.platform !== "android" && !release.storeUrlIos)     missing.push("App Store (iOS)");
  if (release.platform !== "ios"     && !release.storeUrlAndroid)  missing.push("Play Store (Android)");
  return missing;
}

const STATUS_MAP: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  draft:      { label: "Draft",      icon: <Clock className="h-3 w-3" />,             className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  scheduled:  { label: "Scheduled",  icon: <CalendarClock className="h-3 w-3" />,     className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  live:       { label: "Live",       icon: <CheckCircle2 className="h-3 w-3" />,      className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  deprecated: { label: "Deprecated", icon: <XCircle className="h-3 w-3" />,           className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

const TYPE_COLORS: Record<string, string> = {
  major:   "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  minor:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  patch:   "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  hotfix:  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const PLATFORM_ICON: Record<string, React.ReactNode> = {
  all:     <Globe className="h-3.5 w-3.5" />,
  ios:     <Apple className="h-3.5 w-3.5" />,
  android: <Smartphone className="h-3.5 w-3.5" />,
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.draft!;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
      {s.icon}{s.label}
    </span>
  );
}

// Convert a local datetime-local value ("2026-08-01T10:00") to ISO string, or null
function localDatetimeToIso(val: string): string | null {
  if (!val) return null;
  return new Date(val).toISOString();
}

// Convert an ISO string to a datetime-local input value
function isoToLocalDatetime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // format: "YYYY-MM-DDTHH:mm"
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_FORM = {
  version: "", buildNumber: "1", platform: "all", releaseType: "patch",
  releaseNotes: "", isForceUpdate: false, storeUrlIos: "", storeUrlAndroid: "",
  scheduledAt: "",
};

function ReleaseDialog({
  open, onClose, existing, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  existing?: Release;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(existing ? {
    version:         existing.version,
    buildNumber:     String(existing.buildNumber),
    platform:        existing.platform,
    releaseType:     existing.releaseType,
    releaseNotes:    existing.releaseNotes ?? "",
    isForceUpdate:   existing.isForceUpdate,
    storeUrlIos:     existing.storeUrlIos ?? "",
    storeUrlAndroid: existing.storeUrlAndroid ?? "",
    scheduledAt:     isoToLocalDatetime(existing.scheduledAt),
  } : EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const isEdit = !!existing;

  // Live warning for missing store URLs
  const missingUrls = missingStoreUrls({
    platform:        form.platform,
    storeUrlIos:     form.storeUrlIos || null,
    storeUrlAndroid: form.storeUrlAndroid || null,
    isForceUpdate:   form.isForceUpdate,
  });

  const handleSave = async () => {
    if (!form.version.trim()) {
      toast({ title: "Version required", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const body = {
        version:         form.version.trim(),
        buildNumber:     parseInt(form.buildNumber, 10) || 1,
        platform:        form.platform,
        releaseType:     form.releaseType,
        releaseNotes:    form.releaseNotes.trim() || null,
        isForceUpdate:   form.isForceUpdate,
        storeUrlIos:     form.storeUrlIos.trim() || null,
        storeUrlAndroid: form.storeUrlAndroid.trim() || null,
        scheduledAt:     localDatetimeToIso(form.scheduledAt),
      };
      if (isEdit) {
        await authFetch(`/admin/releases/${existing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: "Release updated" });
      } else {
        await authFetch("/admin/releases", { method: "POST", body: JSON.stringify(body) });
        toast({ title: "Release created", description: `v${form.version} saved as draft` });
      }
      onSaved();
      onClose();
    } catch {
      toast({ title: "Error", description: "Could not save release.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const set = (k: keyof typeof EMPTY_FORM, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Release v${existing.version}` : "Create New Release"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the details for this draft release." : "Fill in the details. The release will be saved as a draft — publish it when ready."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Version *</Label>
              <Input placeholder="e.g. 1.2.0" value={form.version} onChange={(e) => set("version", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Build Number</Label>
              <Input type="number" min="1" placeholder="1" value={form.buildNumber} onChange={(e) => set("buildNumber", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select value={form.platform} onValueChange={(v) => set("platform", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  <SelectItem value="ios">iOS only</SelectItem>
                  <SelectItem value="android">Android only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Release Type</Label>
              <Select value={form.releaseType} onValueChange={(v) => set("releaseType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="major">Major</SelectItem>
                  <SelectItem value="minor">Minor</SelectItem>
                  <SelectItem value="patch">Patch</SelectItem>
                  <SelectItem value="hotfix">Hotfix</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Release Notes</Label>
            <Textarea
              placeholder={"• Improved GPS accuracy\n• Fixed map rendering on iOS 17\n• Speed zone data updated"}
              value={form.releaseNotes}
              onChange={(e) => set("releaseNotes", e.target.value)}
              rows={4}
            />
          </div>

          {/* Store URLs — shown with warning context when force-update is on */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              App Store URL (iOS)
              {form.isForceUpdate && form.platform !== "android" && !form.storeUrlIos && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> Required for force update
                </span>
              )}
            </Label>
            <Input
              placeholder="https://apps.apple.com/app/id..."
              value={form.storeUrlIos}
              onChange={(e) => set("storeUrlIos", e.target.value)}
              className={form.isForceUpdate && form.platform !== "android" && !form.storeUrlIos ? "border-amber-400 dark:border-amber-600 focus-visible:ring-amber-400" : ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              Play Store URL (Android)
              {form.isForceUpdate && form.platform !== "ios" && !form.storeUrlAndroid && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" /> Required for force update
                </span>
              )}
            </Label>
            <Input
              placeholder="https://play.google.com/store/apps/details?id=..."
              value={form.storeUrlAndroid}
              onChange={(e) => set("storeUrlAndroid", e.target.value)}
              className={form.isForceUpdate && form.platform !== "ios" && !form.storeUrlAndroid ? "border-amber-400 dark:border-amber-600 focus-visible:ring-amber-400" : ""}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3 bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
            <div>
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-red-500" />
                Force Update
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Clients below this version CANNOT use the app without updating first.
              </p>
            </div>
            <Switch
              checked={form.isForceUpdate}
              onCheckedChange={(v) => set("isForceUpdate", v)}
            />
          </div>

          {/* Scheduled publish */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
              Schedule Publish (optional)
            </Label>
            <Input
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(e) => set("scheduledAt", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              If set, the release will go live automatically at this time. Leave blank to publish immediately when you click Publish.
            </p>
          </div>

          {/* Inline summary warning for force update + missing URLs */}
          {missingUrls.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-800 dark:text-amber-300">
                <p className="font-semibold mb-0.5">Store URL{missingUrls.length > 1 ? "s" : ""} missing</p>
                <p>
                  Force update is on but you haven't added the {missingUrls.join(" or ")} URL.
                  Users sent to the store will see the old version until the new binary is approved —
                  consider adding the URL or using a scheduled publish to delay this release.
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving…" : isEdit ? "Save Changes" : "Create Draft"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Mirrors the notification copy logic in api-server/src/routes/admin/releases.ts
function buildNotifCopy(release: Release, force: boolean) {
  const title = force
    ? `Msafiri just got better 🚀`
    : `What's new in Msafiri v${release.version} ✨`;
  const body = force
    ? `v${release.version} is ready for you — a quick update and you're back on the road.`
    : (release.releaseNotes
        ? release.releaseNotes.slice(0, 120) + (release.releaseNotes.length > 120 ? "…" : "")
        : `Msafiri v${release.version} is here. Tap to see what's new.`);
  return { title, body };
}

function NotifPreviewCard({ label, title, body, highlight }: {
  label: string;
  title: string;
  body: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 space-y-1.5 ${highlight ? "border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-950/20" : "border-border bg-muted/30"}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${highlight ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
        {label}
      </p>
      <div className="rounded-md border border-border bg-background px-3 py-2.5 space-y-0.5">
        <p className="text-sm font-semibold leading-snug">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function PublishConfirmDialog({
  release,
  onConfirm,
  onClose,
}: {
  release: Release | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!release) return null;
  const forceNotif = buildNotifCopy(release, true);
  const softNotif  = buildNotifCopy(release, false);

  const missingUrls = missingStoreUrls(release);
  const isScheduled = !!release.scheduledAt && new Date(release.scheduledAt) > new Date();
  const scheduledLabel = release.scheduledAt
    ? new Date(release.scheduledAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })
    : "";

  return (
    <Dialog open={!!release} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            {isScheduled ? `Schedule v${release.version}?` : `Publish v${release.version}?`}
          </DialogTitle>
          <DialogDescription>
            {isScheduled
              ? `This release will go live on ${scheduledLabel}. A push notification will be sent to all devices at that time.`
              : "A push notification will be sent to all registered devices immediately. Review the copy below before confirming."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">

          {/* ── Store URL warning (force update + missing URLs) ────────────────── */}
          {missingUrls.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-800 dark:text-amber-300 space-y-1">
                <p className="font-semibold">
                  Missing store URL{missingUrls.length > 1 ? "s" : ""} — users may get locked out
                </p>
                <p>
                  Force update is on, but the {missingUrls.join(" and ")} URL
                  {missingUrls.length > 1 ? "s are" : " is"} not set.
                  Users on older versions will see a blocking screen with a store link that still
                  shows the <em>old</em> version until the new binary is approved.
                </p>
                <p className="font-medium">
                  Tip: edit the release to add the store URL(s) first, or set a scheduled publish
                  date to give the stores time to approve the binary.
                </p>
              </div>
            </div>
          )}

          {/* ── Notification previews ─────────────────────────────────────────── */}
          {!isScheduled && (
            <>
              <NotifPreviewCard
                label={release.isForceUpdate ? "Force update — what will send" : "Soft update — what will send"}
                title={release.isForceUpdate ? forceNotif.title : softNotif.title}
                body={release.isForceUpdate ? forceNotif.body : softNotif.body}
                highlight={release.isForceUpdate}
              />

              {/* Show the other variant so the admin can verify they picked the right flag */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 px-0.5">
                  {release.isForceUpdate
                    ? "If Force Update were off, it would say:"
                    : "If Force Update were on, it would say:"}
                </p>
                <NotifPreviewCard
                  label={release.isForceUpdate ? "Soft update (not active)" : "Force update (not active)"}
                  title={release.isForceUpdate ? softNotif.title : forceNotif.title}
                  body={release.isForceUpdate ? softNotif.body : forceNotif.body}
                />
              </div>
            </>
          )}

          {isScheduled && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 px-3 py-2">
              <CalendarClock className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Push notifications will be sent automatically when the release goes live on <strong>{scheduledLabel}</strong>.
              </p>
            </div>
          )}

          {release.isForceUpdate && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 px-3 py-2">
              <Zap className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
              <p className="text-xs text-red-700 dark:text-red-400">
                Force update is <strong>on</strong> — devices below v{release.version} will be blocked until they update.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={onConfirm}
            className={
              release.isForceUpdate && missingUrls.length > 0
                ? "bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-700 dark:hover:bg-amber-600"
                : release.isForceUpdate
                  ? "bg-red-600 hover:bg-red-700 text-white dark:bg-red-700 dark:hover:bg-red-600"
                  : ""
            }
          >
            {isScheduled
              ? "Confirm Schedule"
              : release.isForceUpdate
                ? missingUrls.length > 0 ? "Publish Anyway" : "Publish & Force Update"
                : "Publish Release"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Releases() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRelease, setEditRelease] = useState<Release | undefined>();
  const [publishTarget, setPublishTarget] = useState<Release | null>(null);

  const { data, isLoading } = useQuery<{ releases: Release[] }>({
    queryKey: ["/api/admin/releases"],
    queryFn: () => authFetch("/admin/releases"),
    refetchInterval: 30000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/admin/releases"] });

  const action = (path: string, method = "POST") =>
    authFetch(path, { method })
      .then(() => { invalidate(); })
      .catch(() => toast({ title: "Action failed", variant: "destructive" }));

  const releases = data?.releases ?? [];
  const liveReleases = releases.filter((r) => r.status === "live");
  const scheduledReleases = releases.filter((r) => r.status === "scheduled");
  const forceRelease = liveReleases.filter((r) => r.isForceUpdate).sort((a, b) =>
    b.version.localeCompare(a.version, undefined, { numeric: true })
  )[0];

  // Draft force-update releases missing store URLs — surface in the page header
  const draftForceWarnings = releases.filter(
    (r) => r.status === "draft" && r.isForceUpdate && missingStoreUrls(r).length > 0
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">App Releases</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage version history and force-update enforcement for the mobile app.
            </p>
          </div>
          <Button size="sm" className="gap-2" onClick={() => { setEditRelease(undefined); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" />
            New Release
          </Button>
        </div>

        {/* ── Draft force-update releases with missing store URLs ─────────────── */}
        {draftForceWarnings.map((r) => {
          const urls = missingStoreUrls(r);
          return (
            <div
              key={r.id}
              className="flex items-start gap-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3"
            >
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  v{r.version} — Force update draft is missing {urls.join(" and ")} URL{urls.length > 1 ? "s" : ""}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  Publishing without a store URL will block users on older versions while the store link still shows the old binary.
                  Add the URL(s) or set a scheduled publish date to give stores time to approve first.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-amber-400 text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-950"
                onClick={() => { setEditRelease(r); setDialogOpen(true); }}
              >
                Edit Release
              </Button>
            </div>
          );
        })}

        {/* Status cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Live Releases</p>
              <p className="text-3xl font-bold mt-1">{liveReleases.length}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Latest: {liveReleases[0]?.version ?? "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Force Update Floor</p>
              <p className="text-3xl font-bold mt-1 text-red-600 dark:text-red-400">
                {forceRelease ? `v${forceRelease.version}` : "None"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {forceRelease ? "Clients below this must update" : "No forced updates active"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Releases</p>
              <p className="text-3xl font-bold mt-1">{releases.length}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {releases.filter((r) => r.status === "draft").length} drafts
                {scheduledReleases.length > 0 ? `, ${scheduledReleases.length} scheduled` : ""}
                {", "}{releases.filter((r) => r.status === "deprecated").length} deprecated
              </p>
            </CardContent>
          </Card>
        </div>

        {/* How it works */}
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Rocket className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              How force updates work
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs text-muted-foreground">
              <div className="flex gap-2">
                <span className="text-blue-600 font-bold">1.</span>
                <span>Create a release and fill in the version, build number, and release notes.</span>
              </div>
              <div className="flex gap-2">
                <span className="text-blue-600 font-bold">2.</span>
                <span>Enable <strong>Force Update</strong> if clients below this version must upgrade before using the app. Add the store URL(s) so users can download the new binary.</span>
              </div>
              <div className="flex gap-2">
                <span className="text-blue-600 font-bold">3.</span>
                <span>Set a <strong>scheduled publish date</strong> so the release goes live only after the store approves the binary — preventing a blocking update screen with a stale store link.</span>
              </div>
              <div className="flex gap-2">
                <span className="text-blue-600 font-bold">4.</span>
                <span>Publish the release. The mobile app checks on every launch and shows a full-screen update prompt if needed.</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Releases table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Release History</CardTitle>
            <CardDescription>All versions across all platforms</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading…</div>
            ) : releases.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-36 gap-2 text-muted-foreground">
                <Rocket className="h-8 w-8 opacity-25" />
                <p className="text-sm">No releases yet. Create your first release above.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Force</TableHead>
                    <TableHead>Published / Scheduled</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {releases.map((r) => {
                    const urlWarnings = missingStoreUrls(r);
                    const isDraftForceWarn = r.status === "draft" && urlWarnings.length > 0;
                    return (
                      <TableRow key={r.id} className={
                        r.status === "live" ? "bg-green-50/30 dark:bg-green-950/10" :
                        r.status === "scheduled" ? "bg-amber-50/20 dark:bg-amber-950/10" :
                        ""
                      }>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-semibold text-sm">v{r.version}</span>
                            <span className="font-mono text-xs text-muted-foreground">({r.buildNumber})</span>
                            {isDraftForceWarn && (
                              <span aria-label={`Missing store URL: ${urlWarnings.join(", ")}`}>
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                              </span>
                            )}
                          </div>
                          {r.releaseNotes && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px] mt-0.5">{r.releaseNotes}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[r.releaseType] ?? TYPE_COLORS.patch}`}>
                            {r.releaseType}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground capitalize">
                            {PLATFORM_ICON[r.platform]}
                            {r.platform}
                          </span>
                        </TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell>
                          {r.isForceUpdate ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                              <Zap className="h-3 w-3" />Force
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {r.status === "scheduled" && r.scheduledAt
                            ? (
                              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                <CalendarClock className="h-3 w-3" />
                                {new Date(r.scheduledAt).toLocaleDateString("en-KE", { dateStyle: "medium" })}
                              </span>
                            )
                            : r.publishedAt
                              ? new Date(r.publishedAt).toLocaleDateString("en-KE", { dateStyle: "medium" })
                              : "Not published"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground capitalize">{r.createdBy}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              {r.status === "draft" && (
                                <>
                                  <DropdownMenuItem onClick={() => { setEditRelease(r); setDialogOpen(true); }}>
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-green-600 dark:text-green-400"
                                    onClick={() => setPublishTarget(r)}
                                  >
                                    Publish
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => authFetch(`/admin/releases/${r.id}`, { method: "DELETE" }).then(() => { invalidate(); toast({ title: "Deleted" }); })}
                                  >
                                    Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                              {r.status === "scheduled" && (
                                <>
                                  <DropdownMenuItem onClick={() => { setEditRelease(r); setDialogOpen(true); }}>
                                    Edit Schedule
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-muted-foreground"
                                    onClick={() => action(`/admin/releases/${r.id}/unschedule`).then(() =>
                                      toast({ title: `v${r.version} moved back to draft` })
                                    )}
                                  >
                                    Cancel Schedule
                                  </DropdownMenuItem>
                                </>
                              )}
                              {r.status === "live" && (
                                <DropdownMenuItem
                                  className="text-muted-foreground"
                                  onClick={() => action(`/admin/releases/${r.id}/deprecate`).then(() =>
                                    toast({ title: `v${r.version} deprecated` })
                                  )}
                                >
                                  Deprecate
                                </DropdownMenuItem>
                              )}
                              {r.status === "deprecated" && (
                                <DropdownMenuItem
                                  onClick={() => setPublishTarget(r)}
                                >
                                  Re-publish
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <ReleaseDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditRelease(undefined); }}
        existing={editRelease}
        onSaved={invalidate}
      />

      <PublishConfirmDialog
        release={publishTarget}
        onClose={() => setPublishTarget(null)}
        onConfirm={() => {
          if (!publishTarget) return;
          const r = publishTarget;
          setPublishTarget(null);
          const isScheduled = !!r.scheduledAt && new Date(r.scheduledAt) > new Date();
          action(`/admin/releases/${r.id}/publish`).then(() =>
            toast({
              title: isScheduled
                ? `v${r.version} scheduled!`
                : `v${r.version} published!`,
              description: isScheduled
                ? `Will go live on ${new Date(r.scheduledAt!).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}.`
                : r.isForceUpdate ? "Force update is now active." : undefined,
            })
          );
        }}
      />
    </AdminLayout>
  );
}
