import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useAdminListSubscribers } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Crown, Clock, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

export default function Subscribers() {
  const rawSearch = useSearch();
  const highlightId = new URLSearchParams(rawSearch).get("highlight");
  const highlightHandled = useRef(false);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const { data, isLoading, isError } = useAdminListSubscribers({
    query: { queryKey: ["/api/admin/subscribers"], staleTime: 60000 },
  });

  // Deep-link support from global search: ?highlight=<appUserId> flashes and
  // scrolls to that subscriber's row once the list has loaded.
  useEffect(() => {
    if (!highlightId || highlightHandled.current) return;
    const match = data?.subscribers.find((s) => s.appUserId === highlightId);
    if (match) {
      highlightHandled.current = true;
      setHighlightedRowId(match.appUserId);
      setTimeout(() => {
        rowRefs.current[match.appUserId]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      setTimeout(() => setHighlightedRowId(null), 2500);
    }
  }, [highlightId, data]);

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex flex-col gap-1 border-b pb-6">
            <h1 className="text-3xl font-bold tracking-tight">Subscribers</h1>
            <p className="text-muted-foreground">RevenueCat subscriber & billing overview.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
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
            <h1 className="text-3xl font-bold tracking-tight">Subscribers</h1>
          </div>
          <div className="flex flex-col items-center justify-center min-h-[300px] border border-destructive/20 bg-destructive/5 rounded-xl text-center p-8">
            <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
            <h2 className="text-lg font-semibold">Could not load subscriber data</h2>
            <p className="text-muted-foreground mt-2 max-w-sm text-sm">
              Failed to reach RevenueCat. Check that the RevenueCat integration is active and the project has the correct API key.
            </p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col gap-1 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Subscribers</h1>
          <p className="text-muted-foreground">
            Production subscribers only — sandbox &amp; test purchases are excluded.
            {data?.projectName ? <span className="ml-1.5 text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-md">{data.projectName}</span> : null}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Customers</CardTitle>
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">{data?.total ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Production accounts (no sandbox)</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Subscribers</CardTitle>
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <Crown className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{data?.activeSubscribers ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Paid subscribers (post-trial)</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">On Trial</CardTitle>
              <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{data?.trialSubscribers ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Active 3-day trials</p>
            </CardContent>
          </Card>
        </div>

        <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>App User ID</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[100px]">Country</TableHead>
                <TableHead className="w-[160px]">Last Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.subscribers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-48 text-center">
                    <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-20" />
                    <p className="text-muted-foreground font-medium">No production subscribers yet</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">Customers will appear here once they make a verified purchase or start a trial.</p>
                  </TableCell>
                </TableRow>
              ) : (
                data?.subscribers.map((s) => (
                  <TableRow
                    key={s.id}
                    ref={(el) => { rowRefs.current[s.appUserId] = el; }}
                    className={`hover:bg-muted/30 transition-colors ${highlightedRowId === s.appUserId ? "bg-primary/10" : ""}`}
                  >
                    <TableCell className="font-mono text-sm text-foreground">{s.appUserId}</TableCell>
                    <TableCell>
                      {s.isOnTrial ? (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 shadow-none">
                          Trial
                        </Badge>
                      ) : s.hasActiveEntitlement ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 shadow-none">
                          Subscribed
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-secondary text-muted-foreground border-secondary shadow-none">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground uppercase tracking-wider text-xs">
                      {s.country ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.lastSeenAt ? format(new Date(s.lastSeenAt), "MMM d, yyyy") : "—"}
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
