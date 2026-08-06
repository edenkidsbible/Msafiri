import { AdminLayout } from "@/components/layout/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, CheckCircle2, AlertCircle, Timer, BarChart3, PieChart, TrendingUp, Download, Cpu, Zap, MapPin } from "lucide-react";
import { useAdminGetStats } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { getToken } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
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

interface HazardStats {
  totalEvents7d: number;
  activeClusters: number;
  autoCreatedReports: number;
  topHotspots: Array<{ reportId: string; lat: number; lng: number; dominantType: string; deviceCount: number; eventCount: number; roadName: string | null }>;
  crashDetection: {
    triggers30d:       number;
    realAlerts30d:     number;
    falsePositiveRate: number | null; // 0.0–1.0, null = no data yet
  };
}

export default function Dashboard() {
  const { data: stats, isLoading, isError } = useAdminGetStats({
    query: {
      queryKey: ["admin-stats"],
      refetchInterval: 30000,
    },
  });

  const { data: hazardStats } = useQuery<HazardStats>({
    queryKey: ["admin-hazard-stats"],
    queryFn: async () => {
      const token = getToken();
      const r = await fetch("/api/admin/hazard-stats", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 120000,
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

        {/* Hazard detection stats */}
        <Card className="shadow-sm border-border/60">
          <CardHeader className="border-b bg-muted/30 pb-4">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base font-semibold">Auto Hazard Detection</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">{hazardStats?.totalEvents7d ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">Events (7d)</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">{hazardStats?.activeClusters ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">Active Clusters</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">{hazardStats?.autoCreatedReports ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">Auto Reports</div>
              </div>
            </div>
            {hazardStats && hazardStats.topHotspots.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Top Hotspots</p>
                {hazardStats.topHotspots.map((h, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span className="flex-1 truncate text-muted-foreground">{h.roadName ?? `${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}`}</span>
                    <span className="text-xs font-medium">{h.deviceCount} drivers</span>
                    <a href={`https://www.google.com/maps?q=${h.lat},${h.lng}`} target="_blank" rel="noreferrer">
                      <MapPin className="h-3.5 w-3.5 text-primary hover:opacity-70" />
                    </a>
                  </div>
                ))}
              </div>
            )}
            {hazardStats && hazardStats.totalEvents7d === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">No events captured yet. Events are recorded silently during active drives.</p>
            )}

            {/* Crash detection false-positive metrics */}
            {hazardStats?.crashDetection && (
              <div className="border-t pt-3 mt-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Crash Detection (30d)</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <div className="text-lg font-bold text-foreground">{hazardStats.crashDetection.triggers30d}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Modal triggers</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-foreground">{hazardStats.crashDetection.realAlerts30d}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Real alerts sent</div>
                  </div>
                  <div className="text-center">
                    {hazardStats.crashDetection.falsePositiveRate != null ? (
                      <>
                        <div className={`text-lg font-bold ${hazardStats.crashDetection.falsePositiveRate > 0.5 ? "text-destructive" : hazardStats.crashDetection.falsePositiveRate > 0.2 ? "text-amber-500" : "text-emerald-500"}`}>
                          {Math.round(hazardStats.crashDetection.falsePositiveRate * 100)}%
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">False-positive rate</div>
                      </>
                    ) : (
                      <>
                        <div className="text-lg font-bold text-muted-foreground">—</div>
                        <div className="text-xs text-muted-foreground mt-0.5">No data yet</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
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
