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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  XCircle, Smartphone, Zap, Globe, Apple, ChevronDown,
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
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
}

const STATUS_MAP: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  draft:      { label: "Draft",      icon: <Clock className="h-3 w-3" />,        className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  live:       { label: "Live",       icon: <CheckCircle2 className="h-3 w-3" />, className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  deprecated: { label: "Deprecated", icon: <XCircle className="h-3 w-3" />,      className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
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

const EMPTY_FORM = {
  version: "", buildNumber: "1", platform: "all", releaseType: "patch",
  releaseNotes: "", isForceUpdate: false, storeUrlIos: "", storeUrlAndroid: "",
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
    version:        existing.version,
    buildNumber:    String(existing.buildNumber),
    platform:       existing.platform,
    releaseType:    existing.releaseType,
    releaseNotes:   existing.releaseNotes ?? "",
    isForceUpdate:  existing.isForceUpdate,
    storeUrlIos:    existing.storeUrlIos ?? "",
    storeUrlAndroid: existing.storeUrlAndroid ?? "",
  } : EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const isEdit = !!existing;

  const handleSave = async () => {
    if (!form.version.trim()) {
      toast({ title: "Version required", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const body = {
        version:        form.version.trim(),
        buildNumber:    parseInt(form.buildNumber, 10) || 1,
        platform:       form.platform,
        releaseType:    form.releaseType,
        releaseNotes:   form.releaseNotes.trim() || null,
        isForceUpdate:  form.isForceUpdate,
        storeUrlIos:    form.storeUrlIos.trim() || null,
        storeUrlAndroid: form.storeUrlAndroid.trim() || null,
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
          <div className="space-y-1.5">
            <Label>App Store URL (iOS)</Label>
            <Input placeholder="https://apps.apple.com/app/id..." value={form.storeUrlIos} onChange={(e) => set("storeUrlIos", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Play Store URL (Android)</Label>
            <Input placeholder="https://play.google.com/store/apps/details?id=..." value={form.storeUrlAndroid} onChange={(e) => set("storeUrlAndroid", e.target.value)} />
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

export default function Releases() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRelease, setEditRelease] = useState<Release | undefined>();

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
  const forceRelease = liveReleases.filter((r) => r.isForceUpdate).sort((a, b) =>
    b.version.localeCompare(a.version, undefined, { numeric: true })
  )[0];

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
                {releases.filter((r) => r.status === "draft").length} drafts,{" "}
                {releases.filter((r) => r.status === "deprecated").length} deprecated
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-muted-foreground">
              <div className="flex gap-2">
                <span className="text-blue-600 font-bold">1.</span>
                <span>Create a release and fill in the version, build number, and release notes.</span>
              </div>
              <div className="flex gap-2">
                <span className="text-blue-600 font-bold">2.</span>
                <span>Enable <strong>Force Update</strong> if clients below this version must upgrade before using the app.</span>
              </div>
              <div className="flex gap-2">
                <span className="text-blue-600 font-bold">3.</span>
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
                    <TableHead>Published</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {releases.map((r) => (
                    <TableRow key={r.id} className={r.status === "live" ? "bg-green-50/30 dark:bg-green-950/10" : ""}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold text-sm">v{r.version}</span>
                          <span className="font-mono text-xs text-muted-foreground">({r.buildNumber})</span>
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
                        {r.publishedAt
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
                                  onClick={() => action(`/admin/releases/${r.id}/publish`).then(() =>
                                    toast({ title: `v${r.version} published!`, description: r.isForceUpdate ? "Force update is now active." : undefined })
                                  )}
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
                                onClick={() => action(`/admin/releases/${r.id}/publish`).then(() =>
                                  toast({ title: `v${r.version} re-published` })
                                )}
                              >
                                Re-publish
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
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
    </AdminLayout>
  );
}
