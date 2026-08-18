import { useState, useRef, useEffect } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import {
  Download, Upload, Play, Database, CheckCircle2,
  AlertCircle, Loader2, FileJson, Mail, RefreshCw,
  HardDrive, ShieldCheck, Clock, List, RotateCcw,
  AlertTriangle, Archive, X,
} from "lucide-react";
import { PageGuide } from "@/components/page-guide";

// ── Auth helper ───────────────────────────────────────────────────────────────

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
}

function fmtDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 1000).toFixed(1)} s`;
}

// ── Stat row ──────────────────────────────────────────────────────────────────

const TABLE_LABELS: Record<string, string> = {
  communityReports:       "Community Reports",
  speedZones:             "Speed Zones",
  savedPlaces:            "Saved Places",
  plannedTrips:           "Planned Trips",
  deviceBackups:          "Device Backups",
  sharedVehicles:         "Shared Vehicles",
  vehicleMembers:         "Vehicle Members",
  vehicleJoinRequests:    "Fleet Join Requests",
  emergencyContacts:      "Emergency Contacts",
  pushTokens:             "Push Tokens",
  courseChapters:         "Course Chapters",
  courseLessons:          "Course Lessons",
  courseQuizQuestions:    "Quiz Questions",
  userCourseProgress:     "Course Progress Records",
  userCourseBookmarks:    "Course Bookmarks",
  pois:                   "Points of Interest",
  appSettings:            "App Settings",
  adminUsers:             "Admin Users",
  blogPosts:              "Blog Posts",
  appReleases:            "App Releases",
  creatorApplications:    "Creator Applications",
  promoCodes:             "Promo Codes",
  accidentRecords:        "Accident Records",
  accidentPhotos:         "Accident Photo Refs",
  accidentWitnesses:      "Accident Witnesses",
  accidentTimelineEvents: "Accident Timeline Events",
  dashcamClips:           "Dashcam Clip Metadata",
  brakingEvents:          "Braking Events",
  hazardClusters:         "Hazard Clusters",
  pushCampaigns:          "Push Campaigns",
  blockedDevices:         "Blocked Devices",
  customVehicles:         "Custom Vehicles",
};

function StatGrid({ stats }: { stats: Record<string, number> }) {
  const entries = Object.entries(stats).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 mt-3">
      {entries.map(([key, count]) => (
        <div key={key} className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2 text-sm">
          <span className="text-muted-foreground truncate mr-2">
            {TABLE_LABELS[key] ?? key}
          </span>
          <Badge variant="secondary" className="shrink-0 font-mono tabular-nums">
            {count.toLocaleString()}
          </Badge>
        </div>
      ))}
    </div>
  );
}

// ── Backup list entry ─────────────────────────────────────────────────────────

interface BackupEntry {
  key:          string;
  sizeBytes:    number;
  lastModified: string | null;
}

interface RestoreState {
  key:       string;
  phase:     "confirm" | "restoring" | "done" | "error";
  durationMs?: number;
  warnings?:  string | null;
  error?:     string;
}

function BackupRow({
  backup,
  restore,
  onRestore,
  onCancelRestore,
  onConfirmRestore,
  onDownload,
  downloading,
}: {
  backup:            BackupEntry;
  restore:           RestoreState | null;
  onRestore:         () => void;
  onCancelRestore:   () => void;
  onConfirmRestore:  () => void;
  onDownload:        () => void;
  downloading:       boolean;
}) {
  const label = backup.key.replace("db-backups/", "").replace(".dump", "");

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3 bg-card">
        <Archive className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-mono font-medium truncate">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmtDate(backup.lastModified)} · {fmtSize(backup.sizeBytes)}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onDownload}
            disabled={downloading || restore?.phase === "restoring"}
          >
            {downloading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Download className="h-3.5 w-3.5" />}
            <span className="ml-1.5 hidden sm:inline">Download</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRestore}
            disabled={restore !== null}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="ml-1.5 hidden sm:inline">Restore</span>
          </Button>
        </div>
      </div>

      {/* Confirmation panel */}
      {restore?.phase === "confirm" && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-destructive">
                This will overwrite your live production database.
              </p>
              <p className="text-xs text-muted-foreground">
                pg_restore will drop and recreate every table from <strong>{label}</strong>.
                All data added after this backup was taken will be <strong>permanently lost</strong>.
                Binary assets (dashcam clips, photos) in R2 are not affected.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancelRestore}
            >
              <X className="h-3.5 w-3.5 mr-1" />Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={onConfirmRestore}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Yes, restore database from this backup
            </Button>
          </div>
        </div>
      )}

      {/* In-progress */}
      {restore?.phase === "restoring" && (
        <div className="border-t border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Downloading from R2 and running pg_restore… this may take 30–90 s.
        </div>
      )}

      {/* Done */}
      {restore?.phase === "done" && (
        <div className="border-t border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900 px-4 py-3 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Restore complete — {fmtDuration(restore.durationMs ?? 0)}
          </div>
          {restore.warnings && (
            <p className="text-xs text-muted-foreground font-mono whitespace-pre-wrap line-clamp-3">
              {restore.warnings}
            </p>
          )}
          <p className="text-xs text-muted-foreground pt-0.5">
            Database is now restored from <strong>{label}</strong>. Refresh any
            open admin pages to see the updated data.
          </p>
        </div>
      )}

      {/* Error */}
      {restore?.phase === "error" && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">Restore failed</p>
            <p className="text-xs text-muted-foreground font-mono">{restore.error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SystemBackup() {
  const { toast } = useToast();

  // ── R2 backup list ────────────────────────────────────────────────────────
  const [backups,        setBackups]        = useState<BackupEntry[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(true);
  const [backupsError,   setBackupsError]   = useState<string | null>(null);

  // Per-row download loading: key → boolean
  const [rowDownloading, setRowDownloading] = useState<Record<string, boolean>>({});
  // Per-row restore state: key → RestoreState
  const [rowRestore, setRowRestore] = useState<Record<string, RestoreState>>({});

  // ── pg-dump (create new snapshot) ────────────────────────────────────────
  const [pgDumpLoading, setPgDumpLoading] = useState(false);
  const [pgDumpResult,  setPgDumpResult]  = useState<{
    key: string; sizeBytes: number; durationMs: number;
  } | null>(null);
  const [pgDumpError,  setPgDumpError]  = useState<string | null>(null);

  // ── Export / Run ──────────────────────────────────────────────────────────
  const [runLoading,    setRunLoading]    = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<{
    stats: Record<string, number>; exportedAt: string; emailSent: boolean; toEmail: string | null;
  } | null>(null);

  // ── JSON restore (file upload) ────────────────────────────────────────────
  const fileRef            = useRef<HTMLInputElement>(null);
  const [restoreLoading,   setRestoreLoading]   = useState(false);
  const [previewData,      setPreviewData]       = useState<{ stats: Record<string, number>; exportedAt: string } | null>(null);
  const [previewFile,      setPreviewFile]       = useState<File | null>(null);
  const [restoreResult,    setRestoreResult]     = useState<{ counts: Record<string, number>; restoredRows: number } | null>(null);

  // ── Fetch backup list ─────────────────────────────────────────────────────

  const fetchBackups = async () => {
    setBackupsLoading(true);
    setBackupsError(null);
    try {
      const res  = await fetch("/api/admin/system/backup/pg-dump/list", { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBackups(data.backups ?? []);
    } catch (err) {
      setBackupsError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBackupsLoading(false);
    }
  };

  useEffect(() => { fetchBackups(); }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handlePgDump = async () => {
    setPgDumpLoading(true);
    setPgDumpResult(null);
    setPgDumpError(null);
    try {
      const res  = await fetch("/api/admin/system/backup/pg-dump", {
        method: "POST", headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPgDumpResult({ key: data.key, sizeBytes: data.sizeBytes, durationMs: data.durationMs });
      toast({ title: "Snapshot created", description: `Saved to R2: ${data.key}` });
      // Refresh the backup list to show the new dump
      await fetchBackups();
    } catch (err) {
      const msg = String(err).replace(/^Error:\s*/, "");
      setPgDumpError(msg);
      toast({ title: "Snapshot failed", description: msg, variant: "destructive" });
    } finally {
      setPgDumpLoading(false);
    }
  };

  // Download an EXISTING dump from R2 by key
  const handleFetchDump = async (key: string) => {
    setRowDownloading((s) => ({ ...s, [key]: true }));
    try {
      const res = await fetch(
        `/api/admin/system/backup/pg-dump/fetch?key=${encodeURIComponent(key)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error ?? `HTTP ${res.status}`);
      }
      const blob  = await res.blob();
      const fname = `msafiri-db-${key.replace("db-backups/", "")}`;
      const url   = URL.createObjectURL(blob);
      const a     = document.createElement("a");
      a.href = url; a.download = fname; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: fname });
    } catch (err) {
      toast({ title: "Download failed", description: String(err).replace(/^Error:\s*/, ""), variant: "destructive" });
    } finally {
      setRowDownloading((s) => ({ ...s, [key]: false }));
    }
  };

  // Download a FRESH dump
  const handleDownloadFreshDump = async () => {
    setDownloadLoading(true);
    try {
      const res = await fetch("/api/admin/system/backup/pg-dump/download", { headers: authHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `msafiri-db-${new Date().toISOString().slice(0, 10)}.dump`;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Backup downloaded", description: filename });
      await fetchBackups();
    } catch (err) {
      toast({ title: "Download failed", description: String(err).replace(/^Error:\s*/, ""), variant: "destructive" });
    } finally {
      setDownloadLoading(false);
    }
  };

  // Restore from a specific R2 key via pg_restore
  const handleRestoreFromKey = async (key: string) => {
    setRowRestore((s) => ({ ...s, [key]: { key, phase: "restoring" } }));
    try {
      const res  = await fetch("/api/admin/system/backup/pg-dump/restore", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setRowRestore((s) => ({
        ...s,
        [key]: { key, phase: "done", durationMs: data.durationMs, warnings: data.warnings },
      }));
      toast({ title: "Database restored", description: `Completed in ${fmtDuration(data.durationMs)}` });
    } catch (err) {
      const msg = String(err).replace(/^Error:\s*/, "");
      setRowRestore((s) => ({ ...s, [key]: { key, phase: "error", error: msg } }));
      toast({ title: "Restore failed", description: msg, variant: "destructive" });
    }
  };

  // JSON snapshot export
  const handleDownload = async () => {
    setExportLoading(true);
    try {
      const res = await fetch("/api/admin/system/backup/export", { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const date = new Date().toISOString().slice(0, 10);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `msafiri-backup-${date}.json`; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Backup downloaded", description: "Full JSON snapshot saved." });
    } catch (err) {
      toast({ title: "Download failed", description: String(err), variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  const handleRunNow = async () => {
    setRunLoading(true);
    setLastRunResult(null);
    try {
      const res  = await fetch("/api/admin/system/backup/run", {
        method: "POST", headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLastRunResult(data);
      toast({
        title: data.emailSent ? "Backup complete" : "Backup built (no email)",
        description: data.emailSent ? `Email sent to ${data.toEmail}` : "BACKUP_EMAIL_ADDRESS not configured.",
      });
    } catch (err) {
      toast({ title: "Backup failed", description: String(err), variant: "destructive" });
    } finally {
      setRunLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewFile(file);
    setPreviewData(null);
    setRestoreResult(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json?.tables) throw new Error("Not a valid Msafiri backup file (missing 'tables' key).");
      setPreviewData({ stats: json.stats ?? {}, exportedAt: json.exportedAt ?? "unknown" });
    } catch (err) {
      toast({ title: "Invalid file", description: String(err), variant: "destructive" });
      setPreviewFile(null);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleJsonRestore = async () => {
    if (!previewFile) return;
    setRestoreLoading(true);
    setRestoreResult(null);
    try {
      const text = await previewFile.text();
      const json = JSON.parse(text);
      const res  = await fetch("/api/admin/system/backup/restore", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRestoreResult({ counts: data.counts, restoredRows: data.restoredRows });
      toast({
        title: "Restore complete",
        description: `${data.restoredRows.toLocaleString()} rows upserted across ${Object.keys(data.counts).length} tables.`,
      });
    } catch (err) {
      toast({ title: "Restore failed", description: String(err), variant: "destructive" });
    } finally {
      setRestoreLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <AdminLayout>
      <div className="p-6 max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">System Backup &amp; Restore</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Push fresh database snapshots to Cloudflare R2, browse all saved backups,
            download any backup, or restore the live database from any point-in-time
            snapshot — right from this page.
          </p>
        </div>

        <PageGuide
          title="Using system backup"
          steps={[
            { label: "Before publishing", detail: <>click <em>Create snapshot now</em> to run pg_dump and save it to R2. Takes 10–30 s.</> },
            { label: "Browse R2 backups", detail: "The backup list below shows every stored snapshot. Each row has a Download button (stream the .dump to your machine) and a Restore button (run pg_restore directly against production)." },
            { label: "Restore after maintenance", detail: "Click Restore on any backup → confirm the destructive warning → the server downloads the .dump from R2 and runs pg_restore --clean. All tables are replaced with that snapshot's data." },
            { label: "JSON restore (soft)", detail: "Use the JSON section at the bottom to upsert rows from a .json snapshot without dropping any data — safe for selective recovery." },
          ]}
        />

        {/* ── Create snapshot ───────────────────────────────────────────── */}
        <div className="rounded-lg border-2 border-primary/30 bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">Create database snapshot</h2>
            <Badge className="ml-auto text-xs" variant="secondary">Before publishing</Badge>
          </div>

          <p className="text-sm text-muted-foreground">
            Runs <code className="text-xs bg-muted px-1 rounded">pg_dump</code> and uploads
            a binary snapshot to Cloudflare R2. The nightly backup also runs automatically
            every night at 23:00 EAT.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={handlePgDump}
              disabled={pgDumpLoading || downloadLoading}
              size="lg"
              className="flex-1"
            >
              {pgDumpLoading
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating snapshot…</>
                : <><HardDrive className="h-4 w-4 mr-2" />Create snapshot now</>}
            </Button>

            <Button
              onClick={handleDownloadFreshDump}
              disabled={downloadLoading || pgDumpLoading}
              size="lg"
              variant="outline"
              className="flex-1"
            >
              {downloadLoading
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Dumping…</>
                : <><Download className="h-4 w-4 mr-2" />Download fresh backup</>}
            </Button>
          </div>

          {pgDumpResult && (
            <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Snapshot saved to R2
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm mt-1">
                <div>
                  <dt className="text-xs text-muted-foreground">R2 key</dt>
                  <dd className="font-mono text-xs break-all">{pgDumpResult.key}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Size</dt>
                  <dd className="font-mono">{fmtSize(pgDumpResult.sizeBytes)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Duration</dt>
                  <dd className="font-mono">{fmtDuration(pgDumpResult.durationMs)}</dd>
                </div>
              </dl>
            </div>
          )}

          {pgDumpError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{pgDumpError}</p>
            </div>
          )}
        </div>

        {/* ── R2 backup browser ─────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <List className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">Backups in R2</h2>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto gap-1.5"
              onClick={fetchBackups}
              disabled={backupsLoading}
            >
              {backupsLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            All pg_dump snapshots stored in Cloudflare R2. Backups older than 30 days are
            automatically pruned. Click <strong>Download</strong> to fetch an existing
            file, or <strong>Restore</strong> to replace the live database with that snapshot.
          </p>

          {backupsLoading && (
            <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading backups from R2…</span>
            </div>
          )}

          {!backupsLoading && backupsError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{backupsError}</p>
            </div>
          )}

          {!backupsLoading && !backupsError && backups.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Database className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No backups found in R2.</p>
              <p className="text-xs mt-1">Create one above or wait for the nightly job.</p>
            </div>
          )}

          {!backupsLoading && backups.length > 0 && (
            <div className="space-y-2">
              {backups.map((b) => (
                <BackupRow
                  key={b.key}
                  backup={b}
                  restore={rowRestore[b.key] ?? null}
                  downloading={rowDownloading[b.key] ?? false}
                  onDownload={() => handleFetchDump(b.key)}
                  onRestore={() =>
                    setRowRestore((s) => ({ ...s, [b.key]: { key: b.key, phase: "confirm" } }))
                  }
                  onCancelRestore={() =>
                    setRowRestore((s) => {
                      const next = { ...s };
                      delete next[b.key];
                      return next;
                    })
                  }
                  onConfirmRestore={() => handleRestoreFromKey(b.key)}
                />
              ))}
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
            <span>
              <strong>Restore is destructive.</strong> pg_restore --clean drops and recreates
              every restored table. Data added after the backup was taken will be permanently
              lost. Binary assets (dashcam clips, photos, PDFs) stored in R2 are unaffected.
            </span>
          </div>
        </div>

        {/* ── Export & Run ──────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">Export / Backup Now</h2>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={handleDownload} disabled={exportLoading} variant="outline" className="flex-1">
              {exportLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              Download JSON snapshot
            </Button>
            <Button onClick={handleRunNow} disabled={runLoading} className="flex-1">
              {runLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              Run backup now
            </Button>
          </div>

          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Mail className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            "Run backup now" sends the nightly email immediately (requires
            <code className="mx-1 text-[11px] bg-muted px-1 rounded">BACKUP_EMAIL_ADDRESS</code>
            env var). "Download JSON" skips the email.
          </p>

          {lastRunResult && (
            <div className="rounded-md border bg-muted/40 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Backup complete — {new Date(lastRunResult.exportedAt).toLocaleString()}
              </div>
              {lastRunResult.emailSent ? (
                <p className="text-xs text-muted-foreground">Email sent to <strong>{lastRunResult.toEmail}</strong></p>
              ) : (
                <p className="text-xs text-amber-600">No email sent — <code>BACKUP_EMAIL_ADDRESS</code> not configured.</p>
              )}
              <StatGrid stats={lastRunResult.stats} />
            </div>
          )}
        </div>

        {/* ── JSON Restore (soft upsert) ─────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">Restore from JSON backup</h2>
            <Badge variant="outline" className="text-xs ml-auto">Non-destructive</Badge>
          </div>

          <p className="text-sm text-muted-foreground">
            Upload a <code>.json</code> backup file to upsert its data into the current
            database. Existing rows are updated; new rows are inserted. Nothing is deleted.
            Use this to re-import data after a maintenance window without wiping anything.
          </p>

          <div
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <FileJson className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">
              {previewFile ? previewFile.name : "Click to select backup JSON"}
            </p>
            {!previewFile && (
              <p className="text-xs text-muted-foreground mt-1">msafiri-backup-YYYY-MM-DD.json</p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {previewData && !restoreResult && (
            <div className="rounded-md border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Backup preview</p>
                <Badge variant="outline" className="text-xs">
                  Exported {new Date(previewData.exportedAt).toLocaleString()}
                </Badge>
              </div>
              <StatGrid stats={previewData.stats} />
              <div className="flex gap-3 pt-2">
                <Button variant="outline" size="sm" onClick={() => { setPreviewFile(null); setPreviewData(null); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleJsonRestore} disabled={restoreLoading} className="flex-1">
                  {restoreLoading
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Restoring…</>
                    : <><RefreshCw className="h-4 w-4 mr-2" />Restore to database</>}
                </Button>
              </div>
            </div>
          )}

          {restoreResult && (
            <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Restore complete — {restoreResult.restoredRows.toLocaleString()} rows upserted
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(restoreResult.counts).map(([key, count]) => (
                  <div key={key} className="flex items-center justify-between bg-background rounded px-3 py-1.5 text-xs border">
                    <span className="text-muted-foreground truncate mr-1">{TABLE_LABELS[key] ?? key}</span>
                    {count === -1 ? (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    ) : (
                      <Badge variant="secondary" className="font-mono tabular-nums shrink-0">{count.toLocaleString()}</Badge>
                    )}
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => { setPreviewFile(null); setPreviewData(null); setRestoreResult(null); }}>
                Done
              </Button>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-md bg-muted/40 border px-3 py-2.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              JSON restore is a non-destructive <strong>upsert</strong> — rows in the backup are
              inserted or updated; rows only in the live DB are left untouched. Use the
              R2 backup browser above for a full database replacement.
            </span>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
