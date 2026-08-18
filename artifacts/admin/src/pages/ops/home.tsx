import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, CheckCircle2, MapPin, PlayCircle,
  Lightbulb, Wallet, CalendarDays, Clock, TrendingUp, ChevronRight, Zap,
  Landmark, Smartphone, ArrowRight,
} from "lucide-react";
import { AssigneeBadge } from "@/components/ops/assignee-badge";
import { TaskStatusSelect, ContentStatusSelect, TripStatusSelect } from "@/components/ops/status-select";
import type { TaskStatus, ContentStatus, TripStatus } from "@/components/ops/status-select";
import { TransactionForm } from "@/components/ops/TransactionForm";
import { TaskForm } from "@/components/ops/TaskForm";

const formatKes = (v: string | number | null | undefined) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 }).format(n);
};

// ── Cash position ─────────────────────────────────────────────────────────────

interface AccountBalance { account: string; balanceKes: string; }
interface CategoryTotal { category: string; totalKes: string; }
interface CashPosition {
  byAccount: AccountBalance[];
  byIncomeSource: CategoryTotal[];
  byExpenseCategory: CategoryTotal[];
}

function useCashPosition() {
  return useQuery<CashPosition>({
    queryKey: ["cash-position"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/transactions/cash-position");
      if (!r.ok) throw new Error("Cash position fetch failed");
      return r.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

const ACCOUNT_LABELS: Record<string, string> = {
  bank: "Bank", mpesa: "M-PESA", "mpesa till": "M-PESA Till", cash: "Cash",
};
function accountLabel(n: string) { return ACCOUNT_LABELS[n.toLowerCase()] ?? n; }
function accountIcon(n: string) {
  const key = n.toLowerCase();
  if (key === "bank") return <Landmark className="w-3.5 h-3.5" />;
  if (key === "mpesa" || key === "mpesa till") return <Smartphone className="w-3.5 h-3.5" />;
  return <Wallet className="w-3.5 h-3.5" />;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FocusTask {
  id: number; title: string; priority: string; status: string;
  dueDate?: string | null; module?: string | null; assignedTo?: string | null;
}
interface FocusTrip {
  id: number; purpose: string; corridor?: string | null;
  date: string; status: string; totalTripCostKes?: string | null;
}
interface FocusContent {
  id: number; title: string; pillar?: string | null;
  scheduledDate?: string | null; status: string;
  angle?: string | null; hook?: string | null; isCore?: boolean | null;
}
interface FocusData {
  today: string; weekNumber: number;
  weekObjective?: string | null; weekOutcomes?: string[];
  cashKes: string; cashFloor: string; cashLow: boolean;
  overdueTasks: FocusTask[]; todayTasks: FocusTask[];
  upcomingTasks: FocusTask[]; weekTasks: FocusTask[];
  upcomingTrips: FocusTrip[]; contentDueSoon: FocusContent[];
  contentSuggestions: FocusContent[];
  nextPayment?: { name: string; amountKes: string; dueDate: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRI_COLOR: Record<string, string> = {
  critical: "bg-destructive", high: "bg-orange-500", medium: "bg-yellow-400", low: "bg-muted-foreground",
};
const PRI_LABEL: Record<string, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
};

function dayLabel(dateStr: string, today: string): string {
  const t = new Date(today + "T00:00:00");
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return `in ${diff}d`;
}

// ── Task row ──────────────────────────────────────────────────────────────────

function TaskRow({ task, today, onStatusChange }: {
  task: FocusTask;
  today: string;
  onStatusChange: (id: number, status: TaskStatus) => void;
}) {
  const done = task.status === "done" || task.status === "cancelled";
  return (
    <div className={`flex items-start gap-3 py-2.5 px-1 rounded-md transition-colors ${done ? "opacity-40" : "hover:bg-accent/40"}`}>
      <div className="shrink-0 mt-0.5" onClick={e => e.stopPropagation()}>
        <TaskStatusSelect
          value={task.status as TaskStatus}
          onChange={v => onStatusChange(task.id, v)}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-snug ${done ? "line-through text-muted-foreground" : ""}`}>{task.title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {task.dueDate && (
            <span className="text-xs text-muted-foreground">{dayLabel(task.dueDate, today)}</span>
          )}
          {task.module && (
            <span className="text-xs text-muted-foreground capitalize">{task.module}</span>
          )}
          {task.assignedTo && (
            <AssigneeBadge name={task.assignedTo} showName size="sm" />
          )}
        </div>
      </div>
      <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${PRI_COLOR[task.priority] ?? "bg-muted"}`} aria-label={PRI_LABEL[task.priority]} />
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({ icon, label, count, urgent }: { icon: React.ReactNode; label: string; count?: number; urgent?: boolean }) {
  return (
    <div className={`flex items-center gap-2 mb-2 pb-1.5 border-b ${urgent ? "border-destructive/30" : "border-border"}`}>
      <span className={urgent ? "text-destructive" : "text-muted-foreground"}>{icon}</span>
      <span className={`text-xs font-semibold uppercase tracking-wider ${urgent ? "text-destructive" : "text-muted-foreground"}`}>{label}</span>
      {count !== undefined && count > 0 && (
        <Badge variant={urgent ? "destructive" : "secondary"} className="ml-auto text-[10px] h-4 px-1.5">{count}</Badge>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const qc = useQueryClient();
  const [txFormOpen, setTxFormOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);

  const invalidateFocus = () => qc.invalidateQueries({ queryKey: ["dashboard-focus"] });

  const { data: focus, isLoading } = useQuery<FocusData>({
    queryKey: ["dashboard-focus"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/dashboard/focus");
      if (!r.ok) throw new Error("Failed to load focus board");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await authFetch(`/api/ops/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      if (!r.ok) throw new Error("Failed to update task");
      return r.json();
    },
    onSuccess: invalidateFocus,
  });

  const updateContent = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await authFetch(`/api/ops/content/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      if (!r.ok) throw new Error("Failed to update content");
      return r.json();
    },
    onSuccess: invalidateFocus,
  });

  const updateTrip = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await authFetch(`/api/ops/field-trips/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      if (!r.ok) throw new Error("Failed to update trip");
      return r.json();
    },
    onSuccess: invalidateFocus,
  });

  const handleTaskStatus = (id: number, status: TaskStatus) => {
    updateTask.mutate({ id, status });
  };

  const handleContentStatus = (id: number, status: ContentStatus) => {
    updateContent.mutate({ id, status });
  };

  const handleTripStatus = (id: number, status: TripStatus) => {
    updateTrip.mutate({ id, status });
  };

  const { data: cashPos } = useCashPosition();

  if (isLoading || !focus) {
    return (
      <div className="space-y-6 animate-in">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="lg:col-span-2 h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const {
    today, weekNumber, weekObjective, cashKes, cashFloor, cashLow,
    overdueTasks, todayTasks, upcomingTasks, weekTasks,
    upcomingTrips, contentDueSoon, contentSuggestions, nextPayment,
  } = focus;

  const totalActionable = overdueTasks.length + todayTasks.length;
  const dateLabel = new Date(today + "T00:00:00").toLocaleDateString("en-KE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="space-y-6 animate-in">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 border-b pb-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">Week {weekNumber}</h1>
            {totalActionable > 0 && (
              <Badge variant="destructive" className="text-xs">{totalActionable} need action</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{dateLabel}</p>
          {weekObjective && (
            <p className="text-xs text-muted-foreground mt-1 italic">
              🎯 {weekObjective}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button size="sm" className="gap-2" onClick={() => setTxFormOpen(true)}>
            <Wallet className="w-4 h-4" />
            Fund KES 10k
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setTaskFormOpen(true)}>
            <Zap className="w-4 h-4" />
            Add Task
          </Button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className={cashLow ? "border-destructive/40 bg-destructive/5" : ""}>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cash Balance</CardTitle>
          </CardHeader>
          <CardContent className="pb-3 px-4">
            <div className={`text-xl font-bold font-mono ${cashLow ? "text-destructive" : ""}`}>{formatKes(cashKes)}</div>
            {cashLow && <p className="text-xs text-destructive mt-0.5">Below floor ({formatKes(cashFloor)})</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Overdue</CardTitle>
          </CardHeader>
          <CardContent className="pb-3 px-4">
            <div className={`text-xl font-bold font-mono ${overdueTasks.length > 0 ? "text-destructive" : "text-muted-foreground"}`}>
              {overdueTasks.length}
            </div>
            <p className="text-xs text-muted-foreground">{overdueTasks.length === 0 ? "All caught up" : "tasks past due"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Due Today</CardTitle>
          </CardHeader>
          <CardContent className="pb-3 px-4">
            <div className="text-xl font-bold font-mono">{todayTasks.length}</div>
            <p className="text-xs text-muted-foreground">{todayTasks.length === 0 ? "Clear day" : "on your plate"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Next Bill</CardTitle>
          </CardHeader>
          <CardContent className="pb-3 px-4">
            {nextPayment ? (
              <>
                <div className="text-sm font-semibold truncate">{nextPayment.name}</div>
                <p className="text-xs text-muted-foreground">
                  {formatKes(nextPayment.amountKes)} · {dayLabel(nextPayment.dueDate, today)}
                </p>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">None upcoming</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left — tasks */}
        <div className="lg:col-span-2 space-y-4">

          {/* Overdue */}
          {overdueTasks.length > 0 && (
            <Card className="border-destructive/30">
              <CardContent className="pt-4 pb-3 px-4">
                <SectionHead icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Overdue" count={overdueTasks.length} urgent />
                <div className="divide-y divide-border/40">
                  {overdueTasks.map(t => (
                    <TaskRow key={t.id} task={t} today={today} onStatusChange={handleTaskStatus} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Today */}
          {todayTasks.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <SectionHead icon={<CalendarDays className="w-3.5 h-3.5" />} label="Today" count={todayTasks.length} />
                <div className="divide-y divide-border/40">
                  {todayTasks.map(t => (
                    <TaskRow key={t.id} task={t} today={today} onStatusChange={handleTaskStatus} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Upcoming tasks */}
          {upcomingTasks.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <SectionHead icon={<Clock className="w-3.5 h-3.5" />} label="Upcoming" count={upcomingTasks.length} />
                <div className="divide-y divide-border/40">
                  {upcomingTasks.slice(0, 5).map(t => (
                    <TaskRow key={t.id} task={t} today={today} onStatusChange={handleTaskStatus} />
                  ))}
                </div>
                {upcomingTasks.length > 5 && (
                  <Button variant="ghost" size="sm" className="mt-2 gap-1 text-xs text-muted-foreground w-full justify-end" asChild>
                    <Link href="/ops/tasks">+{upcomingTasks.length - 5} more <ChevronRight className="w-3 h-3" /></Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Field trips */}
          {upcomingTrips.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <SectionHead icon={<MapPin className="w-3.5 h-3.5" />} label="Field Trips" count={upcomingTrips.length} />
                <div className="space-y-2">
                  {upcomingTrips.map(trip => (
                    <div key={trip.id} className="flex items-start gap-3 py-2">
                      <div onClick={e => e.stopPropagation()}>
                        <TripStatusSelect
                          value={trip.status as TripStatus}
                          onChange={v => handleTripStatus(trip.id, v)}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{trip.purpose}</p>
                        <p className="text-xs text-muted-foreground">
                          {trip.corridor && `${trip.corridor} · `}
                          {dayLabel(trip.date, today)}
                          {trip.totalTripCostKes && ` · ${formatKes(trip.totalTripCostKes)}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-2 gap-1 text-xs text-muted-foreground w-full justify-end" asChild>
                  <Link href="/ops/field">Field & Road <ChevronRight className="w-3 h-3" /></Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Content due soon */}
          {contentDueSoon.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <SectionHead icon={<PlayCircle className="w-3.5 h-3.5" />} label="Content Due" count={contentDueSoon.length} />
                <div className="space-y-2">
                  {contentDueSoon.map(c => (
                    <div key={c.id} className="flex items-start gap-3 py-2">
                      <div onClick={e => e.stopPropagation()}>
                        <ContentStatusSelect
                          value={c.status as ContentStatus}
                          onChange={v => handleContentStatus(c.id, v)}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.title}</p>
                        {(c.hook || c.angle) && (
                          <p className="text-xs text-muted-foreground truncate">{c.hook || c.angle}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">

          {/* Content ideas */}
          {contentSuggestions.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <SectionHead icon={<Lightbulb className="w-3.5 h-3.5" />} label="Idea Bank" />
                <div className="space-y-2">
                  {contentSuggestions.slice(0, 4).map(c => (
                    <div key={c.id} className="py-1.5">
                      <p className="text-xs font-medium leading-snug">{c.title}</p>
                      {c.pillar && <p className="text-[10px] text-muted-foreground capitalize">{c.pillar}</p>}
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-2 gap-1 text-xs text-muted-foreground w-full justify-end" asChild>
                  <Link href="/ops/content">Idea Bank <ChevronRight className="w-3 h-3" /></Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Cash snapshot */}
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <SectionHead icon={<Wallet className="w-3.5 h-3.5" />} label="Cash" />
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Operating</span>
                  <span className={`font-mono font-semibold ${cashLow ? "text-destructive" : ""}`}>{formatKes(cashKes)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Safety floor</span>
                  <span className="font-mono text-muted-foreground">{formatKes(cashFloor)}</span>
                </div>
                {nextPayment && (
                  <div className="flex justify-between items-center border-t border-border/50 pt-2 mt-2">
                    <span className="text-muted-foreground truncate pr-2">{nextPayment.name}</span>
                    <span className="font-mono text-xs shrink-0">−{formatKes(nextPayment.amountKes)}</span>
                  </div>
                )}
                {cashPos && cashPos.byAccount.length > 0 && (
                  <div className="border-t border-border/40 pt-2 space-y-1">
                    {cashPos.byAccount.map(a => (
                      <div key={a.account} className="flex items-center justify-between gap-1">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          {accountIcon(a.account)}
                          {accountLabel(a.account)}
                        </span>
                        <span className="font-mono text-xs">{formatKes(a.balanceKes)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full mt-2 gap-1 text-xs"
                  onClick={() => setTxFormOpen(true)}
                >
                  <Wallet className="w-3.5 h-3.5" />
                  Log transaction
                </Button>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Forms */}
      <TransactionForm open={txFormOpen} onClose={() => setTxFormOpen(false)} defaultAmount="10000" defaultType="income" defaultDescription="Friday Funding" />
      <TaskForm open={taskFormOpen} onClose={() => setTaskFormOpen(false)} />
    </div>
  );
}
