import { AdminLayout } from "@/components/layout/admin-layout";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, CheckCircle2, XCircle, Clock, FileSpreadsheet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ImportBatch {
  id: number;
  filename: string;
  status: string;
  rowsCreated?: number | null;
  rowsUpdated?: number | null;
  errorMessage?: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  committed: "default",
  failed: "destructive",
  rolled_back: "destructive",
  pending: "secondary",
};

export default function ImportData() {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  const { data: batches, isLoading: loadingBatches, refetch } = useQuery<ImportBatch[]>({
    queryKey: ["ops-import-batches"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/import/batches");
      if (!r.ok) throw new Error("Failed to fetch import batches");
      return r.json();
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    toast({ title: "Uploading Workbook…", description: "Processing sheets and validating data." });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const token = getToken();
      const response = await fetch('/api/ops/import/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }

      toast({ title: "Upload successful", description: "Batch is ready for review." });
      refetch();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      // reset file input
      e.target.value = "";
    }
  };

  const handleCommit = async (batchId: number) => {
    try {
      const r = await authFetch(`/api/ops/import/batches/${batchId}/commit`, { method: "POST" });
      if (!r.ok) throw new Error("Failed to commit batch");
      toast({ title: "Batch committed" });
      refetch();
    } catch (err: any) {
      toast({ title: "Commit failed", description: err.message, variant: "destructive" });
    }
  };

  const handleDiscard = async (batchId: number) => {
    try {
      const r = await authFetch(`/api/ops/import/batches/${batchId}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to discard batch");
      toast({ title: "Batch discarded" });
      refetch();
    } catch (err: any) {
      toast({ title: "Discard failed", description: err.message, variant: "destructive" });
    }
  };

  const handleRollback = async (batchId: number) => {
    try {
      const r = await authFetch(`/api/ops/import/batches/${batchId}/rollback`, { method: "POST" });
      if (!r.ok) throw new Error("Failed to rollback batch");
      toast({ title: "Batch rolled back" });
      refetch();
    } catch (err: any) {
      toast({ title: "Rollback failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <AdminLayout>
    <div className="space-y-8 animate-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Import Data</h1>
          <p className="text-muted-foreground mt-1">Batch ingest from Excel workbooks.</p>
        </div>
      </div>

      <Card className="border-dashed border-2 bg-muted/10">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <FileSpreadsheet className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl font-bold mb-2">Upload Excel Workbook</h3>
          <p className="text-muted-foreground max-w-sm mb-6">
            Upload the legacy Msafiri tracker workbook to batch-import transactions, metrics, and tasks.
          </p>
          <div className="relative">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              onChange={handleUpload}
              disabled={uploading}
            />
            <Button size="lg" className="pointer-events-none gap-2" disabled={uploading}>
              <UploadCloud className="w-5 h-5" />
              {uploading ? "Uploading…" : "Select File"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight border-b pb-2">Recent Batches</h2>
        {loadingBatches ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-4">
            {batches?.map(batch => (
              <Card key={batch.id}>
                <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h4 className="font-semibold">{batch.filename}</h4>
                      <Badge variant={STATUS_VARIANT[batch.status] ?? "outline"} className="capitalize">
                        {batch.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(batch.createdAt).toLocaleString()}
                      </span>
                      <span>{(batch.rowsCreated ?? 0) + (batch.rowsUpdated ?? 0)} records</span>
                    </div>
                    {batch.errorMessage && (
                      <p className="text-xs text-destructive mt-1">{batch.errorMessage}</p>
                    )}
                  </div>

                  <div className="flex gap-2 w-full sm:w-auto">
                    {batch.status === 'pending' && (
                      <>
                        <Button
                          variant="outline"
                          className="flex-1 sm:flex-none text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDiscard(batch.id)}
                        >
                          Discard
                        </Button>
                        <Button className="flex-1 sm:flex-none" onClick={() => handleCommit(batch.id)}>
                          Commit Data
                        </Button>
                      </>
                    )}
                    {batch.status === 'committed' && (
                      <Button
                        variant="outline"
                        className="flex-1 sm:flex-none gap-2"
                        onClick={() => handleRollback(batch.id)}
                      >
                        <XCircle className="w-4 h-4" /> Rollback
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {(!batches || batches.length === 0) && (
              <p className="text-sm text-muted-foreground py-8 text-center bg-card border rounded-lg">
                No imports recorded yet.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
    </AdminLayout>
  );
}
