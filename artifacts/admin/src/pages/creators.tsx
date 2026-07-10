import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import { Users, CheckCircle, XCircle, Clock, Star, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

async function fetchCreators(): Promise<CreatorsData> {
  const res = await fetch(`${BASE}/api/admin/creators`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch creator applications");
  return res.json();
}

async function updateStatus(id: string, status: string): Promise<void> {
  const res = await fetch(`${BASE}/api/admin/creators/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update application status");
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending:  { label: "Pending",  variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
};

export default function Creators() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/admin/creators"],
    queryFn: fetchCreators,
    staleTime: 30000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/creators"] });
      toast({ title: "Application updated" });
    },
    onError: () => {
      toast({ title: "Failed to update", variant: "destructive" });
    },
  });

  const filtered = (data?.applications ?? []).filter(
    (a) => filter === "all" || a.status === filter,
  );

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex flex-col gap-1 border-b pb-6">
            <h1 className="text-3xl font-bold tracking-tight">Msafiri Creators</h1>
            <p className="text-muted-foreground">Creator program applications</p>
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
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col gap-1 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Msafiri Creators</h1>
          <p className="text-muted-foreground">
            Manage creator program applications. Approved creators receive a 1-month promo code.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="shadow-sm cursor-pointer" onClick={() => setFilter("all")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{counts.total}</div>
            </CardContent>
          </Card>

          <Card className="shadow-sm cursor-pointer" onClick={() => setFilter("pending")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
              <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{counts.pending}</div>
            </CardContent>
          </Card>

          <Card className="shadow-sm cursor-pointer" onClick={() => setFilter("approved")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Approved</CardTitle>
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-500">{counts.approved}</div>
            </CardContent>
          </Card>

          <Card className="shadow-sm cursor-pointer" onClick={() => setFilter("rejected")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Rejected</CardTitle>
              <div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="h-4 w-4 text-destructive" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-destructive">{counts.rejected}</div>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2 flex-wrap">
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
                  Send a push campaign to invite users to the Creator program.
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
                    const isPending = mutation.isPending && (mutation.variables as any)?.id === a.id;
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
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
                                onClick={() => mutation.mutate({ id: a.id, status: "approved" })}
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
                                onClick={() => mutation.mutate({ id: a.id, status: "rejected" })}
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

        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-200 space-y-1">
          <p className="font-semibold">How to send promo codes to approved creators</p>
          <ol className="list-decimal ml-4 space-y-1 text-amber-700 dark:text-amber-300">
            <li>Download One-Time Use Codes from <strong>App Store Connect → your app → Monetization → Subscription Offers</strong></li>
            <li>For Android: generate promo codes in <strong>Google Play Console → Monetize → Subscriptions → Promotions</strong></li>
            <li>Use <strong>Push Campaigns</strong> to message approved creators with their redemption instructions</li>
          </ol>
        </div>
      </div>
    </AdminLayout>
  );
}
