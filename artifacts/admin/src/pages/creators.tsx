import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import { Users, CheckCircle, XCircle, Clock, Star, AlertTriangle, Smartphone, Apple } from "lucide-react";
import { format } from "date-fns";

type Application = {
  id: string;
  name: string;
  email: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

type CreatorsData = {
  applications: Application[];
  counts: { pending: number; approved: number; rejected: number; total: number };
};

type CodeStats = {
  ios:     { total: number; used: number; remaining: number };
  android: { total: number; used: number; remaining: number };
};

async function fetchCreators(): Promise<CreatorsData> {
  const res = await fetch(`/api/admin/creators`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch creator applications");
  return res.json();
}

async function fetchCodeStats(): Promise<CodeStats> {
  const res = await fetch(`/api/admin/creators/codes/stats`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch code stats");
  return res.json();
}

async function uploadCodes(platform: string, codes: string[]): Promise<{ inserted: number; attempted: number }> {
  const res = await fetch(`/api/admin/creators/codes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ platform, codes }),
  });
  if (!res.ok) throw new Error("Failed to upload codes");
  return res.json();
}

async function updateStatus(id: string, status: string): Promise<{ codeAssigned: boolean; emailSent: boolean; noCodesLeft: boolean }> {
  const res = await fetch(`/api/admin/creators/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update application status");
  return res.json();
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending:  { label: "Pending",  variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
};

function CodePoolCard({
  platform,
  stats,
  onUpload,
  isPending,
}: {
  platform: "ios" | "android";
  stats: { total: number; used: number; remaining: number };
  onUpload: (platform: string, codes: string[]) => void;
  isPending: boolean;
}) {
  const [text, setText] = useState("");
  const isIos = platform === "ios";
  const Icon = isIos ? Apple : Smartphone;
  const label = isIos ? "iOS (App Store)" : "Android (Google Play)";

  function handleAdd() {
    const codes = text
      .split(/[\n,]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (codes.length === 0) return;
    onUpload(platform, codes);
    setText("");
  }

  const lowStock = stats.remaining < 5;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-lg bg-muted/40 py-2">
            <div className="text-lg font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="rounded-lg bg-muted/40 py-2">
            <div className="text-lg font-bold text-muted-foreground">{stats.used}</div>
            <div className="text-xs text-muted-foreground">Sent</div>
          </div>
          <div className={`rounded-lg py-2 ${lowStock ? "bg-destructive/10" : "bg-emerald-500/10"}`}>
            <div className={`text-lg font-bold ${lowStock ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
              {stats.remaining}
            </div>
            <div className="text-xs text-muted-foreground">Remaining</div>
          </div>
        </div>

        {lowStock && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              {stats.remaining === 0
                ? "No codes left — approvals won't send a code until you add more."
                : `Only ${stats.remaining} code${stats.remaining === 1 ? "" : "s"} left. Add more soon.`}
            </span>
          </div>
        )}

        <Textarea
          placeholder={`Paste ${label} promo codes here, one per line or comma-separated…`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="font-mono text-xs resize-none"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={isPending || !text.trim()}
          onClick={handleAdd}
          className="w-full"
        >
          Add Codes
        </Button>
      </CardContent>
    </Card>
  );
}

export default function Creators() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/admin/creators"],
    queryFn: fetchCreators,
    staleTime: 30000,
  });

  const { data: codeStats } = useQuery({
    queryKey: ["/api/admin/creators/codes/stats"],
    queryFn: fetchCodeStats,
    staleTime: 10000,
    refetchInterval: 30000,
  });

  const uploadMutation = useMutation({
    mutationFn: ({ platform, codes }: { platform: string; codes: string[] }) =>
      uploadCodes(platform, codes),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/creators/codes/stats"] });
      toast({ title: `Added ${result.inserted} new code${result.inserted === 1 ? "" : "s"} (${result.attempted} submitted, ${result.attempted - result.inserted} duplicates skipped)` });
    },
    onError: () => {
      toast({ title: "Failed to upload codes", variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateStatus(id, status),
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/creators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/creators/codes/stats"] });

      if (vars.status === "approved") {
        if (result.noCodesLeft) {
          toast({
            title: "Approved — but no promo codes left",
            description: "Add codes to the pool so the next approval can send one automatically.",
            variant: "destructive",
          });
        } else if (result.emailSent) {
          toast({ title: "Approved and promo code emailed to creator" });
        } else if (result.codeAssigned) {
          toast({
            title: "Approved — code assigned but email not sent",
            description: "Check that SMTP is configured on the server.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Application updated" });
        }
      } else {
        toast({ title: "Application updated" });
      }
    },
    onError: () => {
      toast({ title: "Failed to update", variant: "destructive" });
    },
  });

  const filtered = (data?.applications ?? []).filter(
    (a) => filter === "all" || a.status === filter,
  );

  const defaultStats = { total: 0, used: 0, remaining: 0 };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex flex-col gap-1 border-b pb-6">
            <h1 className="text-3xl font-bold tracking-tight">Msafiri Creators</h1>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </AdminLayout>
    );
  }

  if (isError) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex flex-col gap-1 border-b pb-6">
            <h1 className="text-3xl font-bold tracking-tight">Msafiri Creators</h1>
          </div>
          <div className="flex flex-col items-center justify-center min-h-[300px] border border-destructive/20 bg-destructive/5 rounded-xl text-center p-8">
            <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
            <h2 className="text-lg font-semibold">Could not load creator applications</h2>
          </div>
        </div>
      </AdminLayout>
    );
  }

  const counts = data?.counts ?? { pending: 0, approved: 0, rejected: 0, total: 0 };

  return (
    <AdminLayout>
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col gap-1 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Msafiri Creators</h1>
          <p className="text-muted-foreground">
            Manage creator program applications. Approving sends a promo code automatically from the pool below.
          </p>
        </div>

        {/* Application stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="shadow-sm cursor-pointer" onClick={() => setFilter("all")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent><div className="text-3xl font-bold">{counts.total}</div></CardContent>
          </Card>

          <Card className="shadow-sm cursor-pointer" onClick={() => setFilter("pending")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
              <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
            </CardHeader>
            <CardContent><div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{counts.pending}</div></CardContent>
          </Card>

          <Card className="shadow-sm cursor-pointer" onClick={() => setFilter("approved")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Approved</CardTitle>
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
              </div>
            </CardHeader>
            <CardContent><div className="text-3xl font-bold text-emerald-600 dark:text-emerald-500">{counts.approved}</div></CardContent>
          </Card>

          <Card className="shadow-sm cursor-pointer" onClick={() => setFilter("rejected")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Rejected</CardTitle>
              <div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="h-4 w-4 text-destructive" />
              </div>
            </CardHeader>
            <CardContent><div className="text-3xl font-bold text-destructive">{counts.rejected}</div></CardContent>
          </Card>
        </div>

        {/* Promo Code Pools */}
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            Promo Code Pool
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Paste codes from App Store Connect and Google Play Console below. When you approve a creator, the system automatically picks one unused code and emails it to them.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CodePoolCard
              platform="ios"
              stats={codeStats?.ios ?? defaultStats}
              onUpload={(p, c) => uploadMutation.mutate({ platform: p, codes: c })}
              isPending={uploadMutation.isPending}
            />
            <CodePoolCard
              platform="android"
              stats={codeStats?.android ?? defaultStats}
              onUpload={(p, c) => uploadMutation.mutate({ platform: p, codes: c })}
              isPending={uploadMutation.isPending}
            />
          </div>
        </div>

        {/* Applications table */}
        <div>
          <div className="flex gap-2 flex-wrap mb-3">
            {(["all", "pending", "approved", "rejected"] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f)}
                className="capitalize"
              >
                {f}
              </Button>
            ))}
          </div>

          <Card className="shadow-sm">
            <CardContent className="p-0">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Star className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="text-muted-foreground font-medium">No applications yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Users can apply via Settings → Msafiri Creator Program in the app.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Applicant</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Why they want to join</TableHead>
                      <TableHead>Applied</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((a) => {
                      const badge = STATUS_BADGE[a.status] ?? STATUS_BADGE["pending"];
                      const isPending = statusMutation.isPending && (statusMutation.variables as any)?.id === a.id;
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{a.name || <span className="italic text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="text-muted-foreground">{a.email}</TableCell>
                          <TableCell className="max-w-xs text-sm text-muted-foreground">
                            {a.reason ?? <span className="italic opacity-50">No reason provided</span>}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {format(new Date(a.createdAt), "dd MMM yyyy")}
                          </TableCell>
                          <TableCell>
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-2 justify-end">
                              {a.status !== "approved" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                  disabled={isPending}
                                  onClick={() => statusMutation.mutate({ id: a.id, status: "approved" })}
                                >
                                  Approve
                                </Button>
                              )}
                              {a.status !== "rejected" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-destructive border-destructive/20 hover:bg-destructive/5"
                                  disabled={isPending}
                                  onClick={() => statusMutation.mutate({ id: a.id, status: "rejected" })}
                                >
                                  Reject
                                </Button>
                              )}
                            </div>
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
      </div>
    </AdminLayout>
  );
}
