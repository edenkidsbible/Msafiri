import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Flag, Car, CheckCircle2, Eye, Filter } from "lucide-react";
import { format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

interface Claim {
  id: string;
  status: "pending" | "reviewed" | "resolved";
  claimNote: string | null;
  claimantDeviceId: string;
  createdAt: string;
  vehicleId: string;
  vehiclePlate: string | null;
  vehicleName: string;
  vehicleType: string;
  ownerDeviceId: string;
}

function statusBadge(status: Claim["status"]) {
  if (status === "pending")
    return <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 shadow-none">Pending</Badge>;
  if (status === "reviewed")
    return <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 shadow-none">Reviewed</Badge>;
  return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 shadow-none">Resolved</Badge>;
}

export default function VehicleClaims() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("pending");

  const { data, isLoading, isError } = useQuery<{ claims: Claim[] }>({
    queryKey: ["/api/admin/vehicle-claims", filter],
    queryFn: () =>
      authFetch(`/api/admin/vehicle-claims${filter !== "all" ? `?status=${filter}` : ""}`)
        .then((r) => r.json()),
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      authFetch(`/api/admin/vehicle-claims/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/vehicle-claims"] });
      toast({ title: "Claim updated" });
    },
    onError: () => toast({ title: "Failed to update claim", variant: "destructive" }),
  });

  const pending = data?.claims.filter((c) => c.status === "pending").length ?? 0;
  const reviewed = data?.claims.filter((c) => c.status === "reviewed").length ?? 0;
  const resolved = data?.claims.filter((c) => c.status === "resolved").length ?? 0;

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex flex-col gap-1 border-b pb-6">
            <h1 className="text-3xl font-bold tracking-tight">Vehicle Ownership Claims</h1>
            <p className="text-muted-foreground">Users claiming a plate is wrongly registered under another account.</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
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
            <h1 className="text-3xl font-bold tracking-tight">Vehicle Ownership Claims</h1>
          </div>
          <div className="flex flex-col items-center justify-center min-h-[300px] border border-destructive/20 bg-destructive/5 rounded-xl text-center p-8">
            <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
            <h2 className="text-lg font-semibold">Could not load claims</h2>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        {/* Header */}
        <div className="flex flex-col gap-1 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Vehicle Ownership Claims</h1>
          <p className="text-muted-foreground">
            Submitted when a user believes a plate is wrongly registered under another account.
            Review each claim and contact the claimant to verify ownership before taking action.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending Review</CardTitle>
              <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Flag className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">{pending}</div>
              <p className="text-xs text-muted-foreground mt-1">Needs action</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Under Review</CardTitle>
              <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">{reviewed}</div>
              <p className="text-xs text-muted-foreground mt-1">In progress</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Resolved</CardTitle>
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">{resolved}</div>
              <p className="text-xs text-muted-foreground mt-1">Closed</p>
            </CardContent>
          </Card>
        </div>

        {/* Filter + Table */}
        <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
            <p className="text-sm font-medium text-foreground">
              {data?.claims.length ?? 0} claim{(data?.claims.length ?? 0) !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-[140px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>Vehicle</TableHead>
                <TableHead>Claimant Device</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[140px]">Submitted</TableHead>
                <TableHead className="w-[200px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.claims.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center">
                    <Car className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-20" />
                    <p className="text-muted-foreground font-medium">No claims match this filter</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                      Claims appear here when a user reports that a plate is wrongly registered.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                data?.claims.map((claim) => (
                  <TableRow key={claim.id} className="hover:bg-muted/30 transition-colors align-top">
                    <TableCell>
                      <div className="font-semibold text-sm text-foreground">{claim.vehicleName}</div>
                      {claim.vehiclePlate && (
                        <div className="text-xs font-mono text-muted-foreground mt-0.5">{claim.vehiclePlate}</div>
                      )}
                      <div className="text-xs text-muted-foreground/60 mt-0.5 capitalize">{claim.vehicleType}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs text-muted-foreground break-all max-w-[140px]">
                        {claim.claimantDeviceId.slice(0, 20)}…
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-foreground/80 max-w-xs leading-relaxed">
                        {claim.claimNote ?? <span className="text-muted-foreground/50 italic">No note provided</span>}
                      </p>
                    </TableCell>
                    <TableCell>{statusBadge(claim.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(claim.createdAt), "dd MMM yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        {claim.status === "pending" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={updateMutation.isPending}
                            onClick={() => updateMutation.mutate({ id: claim.id, status: "reviewed" })}
                          >
                            Mark Reviewed
                          </Button>
                        )}
                        {claim.status !== "resolved" && (
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            disabled={updateMutation.isPending}
                            onClick={() => updateMutation.mutate({ id: claim.id, status: "resolved" })}
                          >
                            Resolve
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AdminLayout>
  );
}
