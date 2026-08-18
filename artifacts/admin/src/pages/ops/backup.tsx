import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getToken } from "@/lib/auth";
import { Download, Upload, Database, CheckCircle2, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface BackupStatus {
  tables: { name: string; count: number }[];
}

interface ImportResult {
  success: boolean;
  imported: Record<string, number>;
  error?: string;
}

function useBackupStatus() {
  return useQuery<BackupStatus>({
    queryKey: ["ops", "backup", "status"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/backup/status");
      if (!r.ok) throw new Error("Failed to load status");
      return r.json();
    },
    refetchInterval: 30_000,
  });
}

export default function BackupPage() {
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useBackupStatus();
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function handleExport() {
    setDownloading(true);
    try {
      const token = getToken();
      const resp = await fetch("/api/ops/backup/export", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Export failed");

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `msafiri-ops-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Export failed: " + String(e));
    } finally {
      setDownloading(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);
    setImportError(null);

    try {
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        setImportError("Invalid JSON file — please upload a valid Msafiri ops backup.");
        return;
      }

      const resp = await authFetch("/api/ops/backup/import", {
        method: "POST",
        body: JSON.stringify(parsed),
      });

      const result = await resp.json();
      if (!resp.ok) {
        setImportError(result.error ?? "Import failed");
      } else {
        setImportResult(result);
        refetchStatus();
      }
    } catch (err) {
      setImportError("Import failed: " + String(err));
    } finally {
      setImporting(false);
      // Reset file input
      e.target.value = "";
    }
  }

  const totalRows = status?.tables.reduce((sum, t) => sum + t.count, 0) ?? 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Backup & Restore</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Export all ops data as a JSON snapshot or restore from a previous backup.
          Exports include weeks, plans, transactions, content, tasks, field trips, and settings.
        </p>
      </div>

      {/* Status */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="w-4 h-4 text-muted-foreground" /> Current Data
            </CardTitle>
            <CardDescription className="mt-0.5">
              {statusLoading ? "Checking…" : `${totalRows.toLocaleString()} total records across ${status?.tables.length ?? 0} sections`}
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetchStatus()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-8 rounded" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {status?.tables.map(t => (
                <div key={t.name} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border">
                  <span className="text-xs text-muted-foreground">{t.name}</span>
                  <Badge variant={t.count > 0 ? "default" : "secondary"} className="text-xs">
                    {t.count.toLocaleString()}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Export */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="w-4 h-4 text-muted-foreground" /> Export Backup
          </CardTitle>
          <CardDescription>
            Downloads a complete snapshot of all ops data as a JSON file. Keep copies in a safe place.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button onClick={handleExport} disabled={downloading}>
            {downloading ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Preparing…</>
            ) : (
              <><Download className="w-4 h-4 mr-2" /> Download Backup</>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            Backup includes {totalRows.toLocaleString()} records as of now.
          </p>
        </CardContent>
      </Card>

      {/* Import */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4 text-muted-foreground" /> Import / Restore
          </CardTitle>
          <CardDescription>
            Upload a previously exported backup JSON file. Existing records are preserved — import only adds new data,
            it does not delete or overwrite existing entries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImport}
                disabled={importing}
              />
              <Button asChild disabled={importing} variant="outline">
                <span>
                  {importing ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Importing…</>
                  ) : (
                    <><Upload className="w-4 h-4 mr-2" /> Choose Backup File</>
                  )}
                </span>
              </Button>
            </label>
            <p className="text-xs text-muted-foreground">Accepts .json files exported from this panel</p>
          </div>

          {/* Import result */}
          {importResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 font-medium text-sm">
                <CheckCircle2 className="w-4 h-4" /> Import successful
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(importResult.imported).map(([key, count]) => (
                  <div key={key} className="flex justify-between text-xs bg-white rounded px-2.5 py-1.5 border border-emerald-100">
                    <span className="text-muted-foreground capitalize">{key}</span>
                    <span className="font-medium text-emerald-700">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {importError && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Import failed</p>
                <p className="text-xs mt-0.5 opacity-80">{importError}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes */}
      <div className="rounded-lg bg-muted/40 border p-4 text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Notes</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Exports include all non-deleted records: weeks, plans, reviews, transactions, content, tasks, field trips, subscriptions, settings, departments, and recurring expenses.</li>
          <li>Import is additive — it never deletes existing data. Use it to restore after a fresh install or to merge data from another environment.</li>
          <li>Operating weeks are matched by week number to avoid duplicates.</li>
          <li>Chat messages and team member records are not included in exports (they contain personal data).</li>
          <li>Schedule regular exports (e.g. every Friday after logging the week's transactions) to protect against data loss.</li>
        </ul>
      </div>
    </div>
  );
}
