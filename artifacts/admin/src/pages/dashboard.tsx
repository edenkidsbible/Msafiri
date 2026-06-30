import { AdminLayout } from "@/components/layout/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertOctagon, CheckCircle2, ShieldAlert, Timer } from "lucide-react";
// We need to import the stats hook - adjusting to the correct name if it wasn't exposed exactly as useAdminGetStats
// Assuming it is exported as useAdminGetStats or we can implement a dummy if codegen missed it.
// Looking at the openapi spec, the path is GET /admin/stats.
import { useAdminGetStats } from "@workspace/api-client-react";

export default function Dashboard() {
  const { data: stats, isLoading, isError } = useAdminGetStats({
    query: {
      queryKey: ["admin-stats"],
      refetchInterval: 30000,
    },
  });

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="h-full flex items-center justify-center">
          <div className="animate-pulse flex flex-col items-center gap-4">
            <Activity className="h-8 w-8 text-primary" />
            <p className="text-muted-foreground font-mono">Syncing Grid Status...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (isError || !stats) {
    return (
      <AdminLayout>
        <div className="p-8 border border-destructive/20 bg-destructive/5 rounded-lg text-center">
          <AlertOctagon className="h-10 w-10 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold text-destructive">Telemetry Failure</h2>
          <p className="text-muted-foreground mt-2">Unable to retrieve command center statistics.</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight uppercase font-mono border-b border-border pb-4">Grid Overview</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Active</CardTitle>
              <Activity className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-primary">{stats.activeReports}</div>
            </CardContent>
          </Card>
          
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Reports Today</CardTitle>
              <ShieldAlert className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold">{stats.reportsToday}</div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Expired</CardTitle>
              <Timer className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold">{stats.expiredReports}</div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">All Time</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-muted-foreground">{stats.totalReports}</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="uppercase font-mono text-sm tracking-wider text-muted-foreground">Distribution by Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stats.byType.map((stat, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="font-medium capitalize">{stat.label}</span>
                    <span className="font-mono bg-secondary px-2 py-1 rounded text-xs">{stat.count}</span>
                  </div>
                ))}
                {stats.byType.length === 0 && <p className="text-muted-foreground text-sm">No data available</p>}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="uppercase font-mono text-sm tracking-wider text-muted-foreground">Distribution by Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stats.byStatus.map((stat, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="font-medium capitalize">{stat.label}</span>
                    <span className="font-mono bg-secondary px-2 py-1 rounded text-xs">{stat.count}</span>
                  </div>
                ))}
                {stats.byStatus.length === 0 && <p className="text-muted-foreground text-sm">No data available</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
