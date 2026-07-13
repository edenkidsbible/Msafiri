import { AdminLayout } from "@/components/layout/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, CheckCircle2, AlertCircle, Timer, BarChart3, PieChart, TrendingUp, Download } from "lucide-react";
import { useAdminGetStats } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { getToken } from "@/lib/auth";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";

function handleExport(type?: string, status?: string) {
  const token = getToken();
  const params = new URLSearchParams();
  if (type)   params.set("type", type);
  if (status) params.set("status", status);
  const url = `/api/admin/reports/export${params.size ? "?" + params.toString() : ""}`;
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", "reports.csv");
  // Add auth header via fetch + blob trick
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.blob())
    .then((blob) => {
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    });
}

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
        <div className="space-y-6">
          <div className="flex flex-col gap-1 border-b pb-6">
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">Network overview and statistics.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <Skeleton className="h-80 w-full rounded-xl" />
            <Skeleton className="h-80 w-full rounded-xl" />
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (isError || !stats) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center min-h-[400px] border border-destructive/20 bg-destructive/5 rounded-xl text-center p-8">
          <div className="h-14 w-14 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Failed to load statistics</h2>
          <p className="text-muted-foreground mt-2 max-w-sm">We couldn't retrieve the dashboard data. This might be due to a network issue or server error.</p>
        </div>
      </AdminLayout>
    );
  }

  const chartData = stats.reportsByDay?.map((d) => ({
    day: format(new Date(d.date), "EEE"),
    count: d.count,
  })) ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-page-title">Dashboard</h1>
            <p className="text-muted-foreground" data-testid="text-page-description">Overview of active network incidents and team performance.</p>
          </div>
          <Button variant="outline" className="gap-2 shadow-none" onClick={() => handleExport()}>
            <Download className="h-4 w-4" />
            Export Reports CSV
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Active</CardTitle>
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Activity className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground" data-testid="stat-active">{stats.activeReports}</div>
            </CardContent>
          </Card>
          
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Reports Today</CardTitle>
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <AlertCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" data-testid="stat-today">{stats.reportsToday}</div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Resolved / Expired</CardTitle>
              <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Timer className="h-4 w-4 text-amber-600 dark:text-amber-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" data-testid="stat-expired">{stats.expiredReports}</div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">All Time Recorded</CardTitle>
              <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground" data-testid="stat-total">{stats.totalReports}</div>
            </CardContent>
          </Card>
        </div>

        {/* 7-day trend chart */}
        <Card className="shadow-sm border-border/60">
          <CardHeader className="border-b bg-muted/30 pb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base font-semibold">Reports — Last 7 Days</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 0, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Reports" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="shadow-sm border-border/60">
            <CardHeader className="border-b bg-muted/30 pb-4">
              <div className="flex items-center gap-2">
                <PieChart className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base font-semibold">Distribution by Type</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-3">
                {stats.byType.map((stat, i) => {
                  const max = Math.max(...stats.byType.map((s) => s.count), 1);
                  return (
                    <div key={i} className="flex items-center gap-3 group" data-testid={`stat-type-${stat.label}`}>
                      <span className="font-medium text-sm capitalize w-24 shrink-0">{stat.label}</span>
                      <div className="flex-1 bg-secondary rounded-full h-2 overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-primary/60 transition-all"
                          style={{ width: `${(stat.count / max) * 100}%` }}
                        />
                      </div>
                      <span className="font-mono text-sm font-medium px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground w-10 text-right shrink-0">{stat.count}</span>
                    </div>
                  );
                })}
                {stats.byType.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No data available</p>}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60">
            <CardHeader className="border-b bg-muted/30 pb-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base font-semibold">Distribution by Status</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-3">
                {stats.byStatus.map((stat, i) => {
                  const max = Math.max(...stats.byStatus.map((s) => s.count), 1);
                  return (
                    <div key={i} className="flex items-center gap-3 group" data-testid={`stat-status-${stat.label}`}>
                      <span className="font-medium text-sm capitalize w-24 shrink-0">{stat.label}</span>
                      <div className="flex-1 bg-secondary rounded-full h-2 overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-primary/60 transition-all"
                          style={{ width: `${(stat.count / max) * 100}%` }}
                        />
                      </div>
                      <span className="font-mono text-sm font-medium px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground w-10 text-right shrink-0">{stat.count}</span>
                    </div>
                  );
                })}
                {stats.byStatus.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No data available</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
