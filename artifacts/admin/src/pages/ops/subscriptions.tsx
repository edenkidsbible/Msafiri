import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle, Pencil, RefreshCw, Users, TrendingUp, UserMinus, Zap, WifiOff } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { SubscriptionMetricForm } from "@/components/ops/SubscriptionMetricForm";

const formatKes = (v: string | number | null | undefined) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 }).format(n);
};

const formatNumber = (v: number | null | undefined) => {
  if (v == null) return "—";
  return new Intl.NumberFormat('en-KE').format(v);
};

interface SubscriptionWeekMetric {
  id: number;
  weekId: number;
  weekNumber?: number;
  periodStartDate: string;
  activePaidEnd?: number | null;
  newDownloads?: number | null;
  trialsStarted?: number | null;
  newPaid?: number | null;
  renewals?: number | null;
  cancellations?: number | null;
  grossSalesKes?: string | null;
  processorFeesKes?: string | null;
  refundsKes?: string | null;
  cashReceivedKes?: string | null;
  netAccruedRevenueKes?: string | null;
  mrrKes?: string | null;
  notes?: string | null;
}

interface SubscriptionSummary {
  currentActivePaid: number;
  weekOnWeekChange: number;
  mrrKes: string;
  trend: Array<{
    weekNumber: number;
    activePaidEnd: number;
    mrrKes: string;
  }>;
}

interface RcOverview {
  activeTrials: number;
  activeSubscriptions: number;
  mrrUsd: number;
  revenue28dUsd: number;
  mrrKes: number;
  revenue28dKes: number;
  exchangeRate: number;
  newCustomers28d: number;
  activeUsers28d: number;
  updatedAt: string;
}

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      Live
    </span>
  );
}

export default function Subscriptions() {
  const [formOpen, setFormOpen] = useState(false);
  const [editingMetric, setEditingMetric] = useState<SubscriptionWeekMetric | undefined>(undefined);
  const [prefill, setPrefill] = useState<Partial<{ activePaidEnd: number; trialsStarted: number }>>({});

  const { data: summary, isLoading: loadingSum } = useQuery<SubscriptionSummary>({
    queryKey: ["ops-subscription-summary"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/subscription-metrics/summary");
      if (!r.ok) throw new Error("Failed to fetch subscription summary");
      return r.json();
    },
  });

  const { data: metricsData, isLoading: loadingMetrics } = useQuery<SubscriptionWeekMetric[] | { items: SubscriptionWeekMetric[] }>({
    queryKey: ["ops-subscription-metrics"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/subscription-metrics");
      if (!r.ok) throw new Error("Failed to fetch subscription metrics");
      return r.json();
    },
  });

  const { data: rcLive, isFetching: rcFetching, refetch: rcRefetch } = useQuery<RcOverview>({
    queryKey: ["rc-overview"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/revenuecat/overview");
      if (!r.ok) throw new Error("RevenueCat overview fetch failed");
      return r.json();
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  const metrics: SubscriptionWeekMetric[] = Array.isArray(metricsData)
    ? metricsData
    : (metricsData as any)?.items ?? [];

  const openCreate = () => { setEditingMetric(undefined); setPrefill({}); setFormOpen(true); };
  const openEdit = (m: SubscriptionWeekMetric) => { setEditingMetric(m); setPrefill({}); setFormOpen(true); };
  const handleRcSync = (rc: RcOverview) => {
    setEditingMetric(undefined);
    setPrefill({ activePaidEnd: rc.activeSubscriptions, trialsStarted: rc.activeTrials });
    setFormOpen(true);
  };
  const handleClose = () => { setFormOpen(false); setEditingMetric(undefined); setPrefill({}); };

  if (loadingSum || loadingMetrics) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 w-full" /></div>;
  }

  const chartData = [...(summary?.trend || [])].reverse().map(w => ({
    name: `W${w.weekNumber}`,
    activePaid: w.activePaidEnd,
    mrr: parseFloat(w.mrrKes || "0"),
  }));

  return (
    <div className="space-y-8 animate-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users & Revenue</h1>
          <p className="text-muted-foreground mt-1">Growth and retention metrics.</p>
        </div>
        <Button onClick={openCreate}><PlusCircle className="w-4 h-4 mr-2" /> Log Weekly Metrics</Button>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Users className="w-3.5 h-3.5" /> Active Paid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(summary.currentActivePaid)}</div>
              <div className={`text-xs mt-1 ${summary.weekOnWeekChange >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                {summary.weekOnWeekChange >= 0 ? "+" : ""}{summary.weekOnWeekChange} week on week
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5" /> MRR
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{formatKes(summary.mrrKes)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <UserMinus className="w-3.5 h-3.5" /> Weeks Logged
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.length}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* RevenueCat live panel */}
      {rcLive && (
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-4 h-4 text-emerald-600" />
              <CardTitle className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">RevenueCat — Live</CardTitle>
              <LiveBadge />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => rcRefetch()}
                disabled={rcFetching}
                className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-600 disabled:opacity-40"
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rcFetching ? "animate-spin" : ""}`} />
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">Active Paid</p>
                <p className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{rcLive.activeSubscriptions}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">Active Trials</p>
                <p className="text-xl font-bold tabular-nums">{rcLive.activeTrials}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">New Customers (28d)</p>
                <p className="text-xl font-bold tabular-nums">{rcLive.newCustomers28d}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">Active Users (28d)</p>
                <p className="text-xl font-bold tabular-nums">{rcLive.activeUsers28d}</p>
              </div>
            </div>
            <div className="border-t border-emerald-100 dark:border-emerald-900/30 pt-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">Net Revenue (28d)</p>
                <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{formatKes(String(rcLive.revenue28dKes))}</p>
                <p className="text-xs text-muted-foreground">${rcLive.revenue28dUsd.toFixed(2)} · after store cut</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-400"
                onClick={() => handleRcSync(rcLive)}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Pre-fill weekly log
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Subscribers Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="activePaid" stroke="#10b981" name="Active Paid" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* History table */}
      <div>
        <h2 className="text-xl font-bold tracking-tight border-b pb-2 mb-4">Weekly History</h2>
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left font-medium p-3 text-muted-foreground whitespace-nowrap">Week</th>
                <th className="text-right font-medium p-3 text-muted-foreground whitespace-nowrap">Downloads</th>
                <th className="text-right font-medium p-3 text-muted-foreground whitespace-nowrap">Trials</th>
                <th className="text-right font-medium p-3 text-muted-foreground whitespace-nowrap">New Paid</th>
                <th className="text-right font-medium p-3 text-muted-foreground whitespace-nowrap">Cancellations</th>
                <th className="text-right font-medium p-3 text-muted-foreground whitespace-nowrap bg-muted">Active End</th>
                <th className="text-right font-medium p-3 text-muted-foreground whitespace-nowrap">Net Revenue</th>
                <th className="w-10 p-3"></th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => (
                <tr key={m.id} className="border-b last:border-0 hover:bg-muted/20 group">
                  <td className="p-3 font-medium">W{m.weekNumber} <span className="text-xs text-muted-foreground font-normal ml-2">{m.periodStartDate ? new Date(m.periodStartDate).toLocaleDateString() : ""}</span></td>
                  <td className="p-3 text-right font-mono">{formatNumber(m.newDownloads)}</td>
                  <td className="p-3 text-right font-mono">{formatNumber(m.trialsStarted)}</td>
                  <td className="p-3 text-right font-mono text-emerald-600">+{formatNumber(m.newPaid)}</td>
                  <td className="p-3 text-right font-mono text-destructive">{m.cancellations ? `-${m.cancellations}` : '0'}</td>
                  <td className="p-3 text-right font-mono font-bold bg-muted/30">{formatNumber(m.activePaidEnd)}</td>
                  <td className="p-3 text-right font-mono text-muted-foreground">{formatKes(m.netAccruedRevenueKes)}</td>
                  <td className="p-3">
                    <button
                      onClick={() => openEdit(m)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </td>
                </tr>
              ))}
              {!metrics.length && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    No weekly metrics recorded yet.{" "}
                    <button className="text-primary underline hover:no-underline" onClick={openCreate}>Log this week</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SubscriptionMetricForm open={formOpen} onClose={handleClose} metric={editingMetric} prefill={prefill} />
    </div>
  );
}
