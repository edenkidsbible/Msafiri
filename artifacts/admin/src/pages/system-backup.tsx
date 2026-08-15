import { useState, useRef } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import {
  Download, Upload, Play, Database, CheckCircle2,
  AlertCircle, Loader2, FileJson, Mail, RefreshCw, HardDrive, ShieldCheck,
} from "lucide-react";
import { PageGuide } from "@/components/page-guide";

// ── Auth helper ───────────────────────────────────────────────────────────────

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SystemBackup() {
  const { toast } = useToast();

  // Export / run state
  const [runLoading,    setRunLoading]    = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<{
    stats: Record<string, number>;
    exportedAt: string;
    emailSent: boolean;
    toEmail: string | null;
  } | null>(null);

  // pg-dump state
  const [pgDumpLoading, setPgDumpLoading] = useState(false);
  const [pgDumpResult,  setPgDumpResult]  = useState<{
    key: string;
    sizeBytes: number;
    durationMs: number;
  } | null>(null);
  const [pgDumpError, setPgDumpError] = useState<string | null>(null);

  // Restore state
  const fileRef              = useRef<HTMLInputElement>(null);
  const [restoreLoading,  setRestoreLoading]  = useState(false);
  const [previewData,     setPreviewData]      = useState<{ stats: Record<string, number>; exportedAt: string } | null>(null);
  const [previewFile,     setPreviewFile]      = useState<File | null>(null);
  const [restoreResult,   setRestoreResult]    = useState<{
    counts: Record<string, number>;
    restoredRows: number;
  } | null>(null);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handlePgDump = async () => {
    setPgDumpLoading(true);
    setPgDumpResult(null);
    setPgDumpError(null);
    try {
      const res  = await fetch("/api/admin/system/backup/pg-dump", {
        method:  "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPgDumpResult({ key: data.key, sizeBytes: data.sizeBytes, durationMs: data.durationMs });
      toast({ title: "Database snapshot created", description: `Saved to R2: ${data.key}` });
    } catch (err) {
      const msg = String(err).replace(/^Error:\s*/, "");
      setPgDumpError(msg);
      toast({ title: "Snapshot failed", description: msg, variant: "destructive" });
    } finally {
      setPgDumpLoading(false);
    }
  };

  const handleDownload = async () => {
    setExportLoading(true);
    try {
      const res = await fetch("/api/admin/system/backup/export", {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const date = new Date().toISOString().slice(0, 10);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `msafiri-backup-${date}.json`;
      a.click();
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
        method:  "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLastRunResult(data);
      toast({
        title: data.emailSent ? "Backup complete" : "Backup built (no email)",
        description: data.emailSent
          ? `Email sent to ${data.toEmail}`
          : "BACKUP_EMAIL_ADDRESS not configured — no email sent.",
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
    // Reset input so re-selecting same file triggers onChange again
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleRestore = async () => {
    if (!previewFile) return;
    setRestoreLoading(true);
    setRestoreResult(null);
    try {
      const text = await previewFile.text();
      const json = JSON.parse(text);
      const res  = await fetch("/api/admin/system/backup/restore", {
        method:  "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body:    JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRestoreResult({ counts: data.counts, restoredRows: data.restoredRows });
      toast({
        title:       "Restore complete",
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
          <h1 className="text-2xl font-bold">System Backup</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Export a full snapshot of all Postgres tables, trigger the nightly email backup
            on demand, or restore a previous snapshot. Binary assets (dashcam clips, accident
            photos, PDFs, audio) live in Cloudflare R2 and are always safe — restarts never
            lose them.
          </p>
        </div>

        <PageGuide
          title="Using system backup"
          steps={[
            { label: "Before publishing", detail: <>click <em>Create database snapshot</em> to run pg_dump and save a binary backup to R2. Takes 10–30 s — do this every time before deploying a new release.</> },
            { label: "What's backed up", detail: "a full JSON snapshot of all 32 Postgres tables — reports, zones, vehicles, admin users, blog posts, and more. Binary assets (dashcam clips, photos, audio) live in R2 and are not included." },
            { label: "Export or run now", detail: <>use <em>Download JSON snapshot</em> to save a dated file locally; use <em>Run Now</em> to trigger the nightly email backup immediately.</> },
            { label: "Restore", detail: "upload a previously downloaded snapshot to upsert its rows back into the database — useful after data loss or a migration." },
          ]}
        />

        {/* ── What's in the backup ─────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">What's backed up</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            32 Postgres tables — community reports, speed zones, saved places, trip plans,
            vehicle fleet, accident records, course content &amp; progress, push tokens,
            admin users, POIs, dashcam metadata, and more.
            The backup JSON is self-contained and can seed a fresh production database
            after a maintenance window.
          </p>
          <div className="flex flex-wrap gap-2 mt-1 text-xs">
            {["Community Reports", "Speed Zones", "Saved Places", "Planned Trips",
              "Vehicle Fleet", "Emergency Contacts", "Course Content", "Accident Records",
              "Push Tokens", "Admin Users", "POIs", "Dashcam Metadata", "+more"].map((t) => (
              <Badge key={t} variant="outline">{t}</Badge>
            ))}
          </div>
        </div>

        {/* ── Database snapshot (pg-dump → R2) ─────────────────────────────── */}
        <div className="rounded-lg border-2 border-primary/30 bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">Create database snapshot</h2>
            <Badge className="ml-auto text-xs" variant="secondary">Before publishing</Badge>
          </div>

          <p className="text-sm text-muted-foreground">
            Runs <code className="text-xs bg-muted px-1 rounded">pg_dump</code> and uploads
            a binary snapshot of the full Postgres database to Cloudflare R2.
            Do this <strong>before every publish</strong> so you have a point-in-time restore
            point if a deploy goes wrong. Takes 10–30 s.
          </p>

          <Button
            onClick={handlePgDump}
            disabled={pgDumpLoading}
            size="lg"
            className="w-full sm:w-auto"
          >
            {pgDumpLoading
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating snapshot…</>
              : <><HardDrive className="h-4 w-4 mr-2" />Create database snapshot</>}
          </Button>

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
                  <dd className="font-mono">{(pgDumpResult.sizeBytes / 1024).toFixed(1)} KB</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Duration</dt>
                  <dd className="font-mono">{(pgDumpResult.durationMs / 1000).toFixed(1)} s</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground pt-1">
                To restore: download the <code>.dump</code> file from R2 and run{" "}
                <code className="bg-muted px-1 rounded text-[11px]">
                  pg_restore --clean --if-exists -d $DATABASE_URL &lt;file&gt;.dump
                </code>
              </p>
            </div>
          )}

          {pgDumpError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{pgDumpError}</p>
            </div>
          )}
        </div>

        {/* ── Export & Run ─────────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">Export / Backup Now</h2>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={handleDownload}
              disabled={exportLoading}
              variant="outline"
              className="flex-1"
            >
              {exportLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              Download JSON snapshot
            </Button>

            <Button
              onClick={handleRunNow}
              disabled={runLoading}
              className="flex-1"
            >
              {runLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              Run backup now
            </Button>
          </div>

          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Mail className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            "Run backup now" sends the nightly email immediately (requires
            <code className="mx-1 text-[11px] bg-muted px-1 rounded">BACKUP_EMAIL_ADDRESS</code>
            env var) and also downloads the JSON. "Download JSON" skips the email.
            The automatic nightly backup also runs every night at 23:00 EAT.
          </p>

          {lastRunResult && (
            <div className="rounded-md border bg-muted/40 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Backup complete — {new Date(lastRunResult.exportedAt).toLocaleString()}
              </div>
              {lastRunResult.emailSent ? (
                <p className="text-xs text-muted-foreground">
                  Email sent to <strong>{lastRunResult.toEmail}</strong>
                </p>
              ) : (
                <p className="text-xs text-amber-600">
                  No email sent — <code>BACKUP_EMAIL_ADDRESS</code> not configured.
                </p>
              )}
              <StatGrid stats={lastRunResult.stats} />
            </div>
          )}
        </div>

        {/* ── Restore ──────────────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">Restore from backup</h2>
          </div>

          <p className="text-sm text-muted-foreground">
            Upload a <code>.json</code> backup file to upsert its data into the current
            database. Existing rows are updated; new rows are inserted. Nothing is deleted —
            this is a non-destructive merge. Use after a maintenance window to seed
            production with the latest data.
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
              <p className="text-xs text-muted-foreground mt-1">
                msafiri-backup-YYYY-MM-DD.json
              </p>
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setPreviewFile(null); setPreviewData(null); }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleRestore}
                  disabled={restoreLoading}
                  className="flex-1"
                >
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
                    <span className="text-muted-foreground truncate mr-1">
                      {TABLE_LABELS[key] ?? key}
                    </span>
                    {count === -1 ? (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    ) : (
                      <Badge variant="secondary" className="font-mono tabular-nums shrink-0">
                        {count.toLocaleString()}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setPreviewFile(null); setPreviewData(null); setRestoreResult(null); }}
              >
                Done
              </Button>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 px-3 py-2.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
            <span>
              Restore is a non-destructive <strong>upsert</strong> — rows present in the
              backup are inserted or updated; rows only in the live DB are left untouched.
              To fully replace the database, truncate the relevant tables first via psql,
              then restore. Binary assets (R2) are unaffected by any restore.
            </span>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
