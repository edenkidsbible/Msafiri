import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  PlusCircle, Wallet, Pencil, Landmark, Smartphone, TrendingUp, TrendingDown, ChevronDown, ChevronRight,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TransactionForm } from "@/components/ops/TransactionForm";

const formatKes = (v: string | number | null | undefined) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 }).format(n);
};

interface AccountBalance { account: string; balanceKes: string; }
interface CategoryTotal { category: string; totalKes: string; }
interface CashPosition {
  byAccount: AccountBalance[];
  byIncomeSource: CategoryTotal[];
  byExpenseCategory: CategoryTotal[];
}

interface TransactionSummary {
  operatingCashKes: string;
  reserveCashKes: string;
  runwayWeeks: number;
  weeklyRows: Array<{
    weekId: number;
    weekNumber: number;
    periodStartDate: string;
    periodEndDate: string;
    totalIncomeKes: string;
    totalExpensesKes: string;
    netKes: string;
    plannedInKes: string | null;
    plannedOutKes: string | null;
  }>;
}

interface WeekTx {
  id: number; date: string; type: string;
  description: string; categoryName: string | null;
  amountKes: string; cleared: boolean;
}

interface Transaction {
  id: number;
  date: string;
  type: string;
  amountKes: string;
  description: string;
  categoryId?: number | null;
  cleared: boolean;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
}

function accountIcon(name: string) {
  const key = name.toLowerCase();
  if (key === "bank") return <Landmark className="w-4 h-4" />;
  if (key === "mpesa" || key === "mpesa till") return <Smartphone className="w-4 h-4" />;
  return <Wallet className="w-4 h-4" />;
}

function accountLabel(name: string) {
  const m: Record<string, string> = { bank: "Bank", mpesa: "M-PESA", "mpesa till": "M-PESA Till", cash: "Cash" };
  return m[name.toLowerCase()] ?? name;
}

function WeekBreakdown({ weekId }: { weekId: number }) {
  const { data, isLoading } = useQuery<{ items: WeekTx[]; total: number }>({
    queryKey: ["transactions", "week", weekId],
    queryFn: async () => {
      const r = await authFetch(`/api/ops/transactions?weekId=${weekId}&limit=100`);
      if (!r.ok) throw new Error("Failed to fetch week transactions");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <tr>
        <td colSpan={7} className="px-6 py-3 bg-muted/20 border-b">
          <p className="text-xs text-muted-foreground animate-pulse">Loading transactions…</p>
        </td>
      </tr>
    );
  }

  const items = data?.items ?? [];
  const income = items.filter(t => t.type === "income" || t.type === "refund_in");
  const expenses = items.filter(t => t.type === "expense" || t.type === "refund_out");
  const reserves = items.filter(t => t.type === "reserve_transfer");

  if (!items.length) {
    return (
      <tr>
        <td colSpan={7} className="px-6 py-3 bg-muted/20 border-b text-xs text-muted-foreground">
          No transactions logged for this week yet.
        </td>
      </tr>
    );
  }

  const TxList = ({ rows, color }: { rows: WeekTx[]; color: "emerald" | "rose" | "blue" }) => {
    const amtClass = color === "emerald" ? "text-emerald-700 dark:text-emerald-400"
      : color === "rose" ? "text-rose-600" : "text-blue-600";
    return (
      <div className="space-y-1.5">
        {rows.map(tx => (
          <div key={tx.id} className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${tx.cleared
                  ? color === "emerald" ? "bg-emerald-500" : color === "rose" ? "bg-rose-500" : "bg-blue-500"
                  : "bg-muted-foreground/30"}`}
                title={tx.cleared ? "Cleared" : "Pending"}
              />
              <span className="truncate text-foreground/80">{tx.description}</span>
              {tx.categoryName && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0 font-normal">
                  {tx.categoryName}
                </Badge>
              )}
            </div>
            <span className={`font-mono font-medium shrink-0 ${amtClass}`}>{formatKes(tx.amountKes)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <tr>
      <td colSpan={7} className="bg-muted/20 border-b">
        <div className="px-6 py-3 grid grid-cols-1 md:grid-cols-3 gap-5">
          {income.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 mb-2">
                Income ({income.filter(t => t.cleared).length} cleared · {income.filter(t => !t.cleared).length} pending)
              </p>
              <TxList rows={income} color="emerald" />
            </div>
          )}
          {expenses.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-500 mb-2">
                Expenses ({expenses.filter(t => t.cleared).length} cleared · {expenses.filter(t => !t.cleared).length} pending)
              </p>
              <TxList rows={expenses} color="rose" />
            </div>
          )}
          {reserves.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-500 mb-2">
                Reserve Transfers
              </p>
              <TxList rows={reserves} color="blue" />
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function Money() {
  const [formOpen, setFormOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | undefined>(undefined);
  const [formDefaults, setFormDefaults] = useState<{ defaultType?: string; defaultAmount?: string; defaultDescription?: string }>({});
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());

  const { data: summary, isLoading: loadingSum } = useQuery<TransactionSummary>({
    queryKey: ["ops-transaction-summary"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/transactions/summary");
      if (!r.ok) throw new Error("Failed to fetch transaction summary");
      return r.json();
    },
  });

  const { data: cashPos } = useQuery<CashPosition>({
    queryKey: ["cash-position"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/transactions/cash-position");
      if (!r.ok) throw new Error("Cash position fetch failed");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const openCreate = (defaults?: typeof formDefaults) => {
    setEditingTx(undefined);
    setFormDefaults(defaults ?? {});
    setFormOpen(true);
  };

  const handleClose = () => {
    setFormOpen(false);
    setEditingTx(undefined);
    setFormDefaults({});
  };

  const toggleWeek = (weekId: number) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(weekId)) { next.delete(weekId); } else { next.add(weekId); }
      return next;
    });
  };

  if (loadingSum) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-48" /><Skeleton className="h-96 w-full" /></div>;
  }

  const chartData = [...(summary?.weeklyRows ?? [])].reverse().slice(-12).map(w => ({
    name: `W${w.weekNumber}`,
    Income: parseFloat(w.totalIncomeKes || "0"),
    Expenses: parseFloat(w.totalExpensesKes || "0"),
  }));

  return (
    <div className="space-y-8 animate-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Money</h1>
          <p className="text-muted-foreground mt-1">Cash position, transactions, and budgets.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openCreate({ defaultType: "expense" })}>
            <TrendingDown className="w-4 h-4 mr-2" /> Log Expense
          </Button>
          <Button onClick={() => openCreate({ defaultType: "income", defaultAmount: "10000", defaultDescription: "Friday Funding" })}>
            <PlusCircle className="w-4 h-4 mr-2" /> Log Income
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Operating Cash</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-primary">{formatKes(summary?.operatingCashKes)}</div>
            <p className="text-xs text-muted-foreground mt-1">Available for use</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Reserve Cash</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">{formatKes(summary?.reserveCashKes)}</div>
            <p className="text-xs text-muted-foreground mt-1">Do not touch</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Runway</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{summary?.runwayWeeks ?? '--'} weeks</div>
            <p className="text-xs text-muted-foreground mt-1">Based on recent burn</p>
          </CardContent>
        </Card>
      </div>

      {/* Cash position */}
      {cashPos && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Landmark className="w-4 h-4 text-muted-foreground" />
                Where Your Money Is
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {cashPos.byAccount.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cleared transactions with payment method set.</p>
              ) : (
                <div className="space-y-2">
                  {cashPos.byAccount.map(a => {
                    const bal = parseFloat(a.balanceKes);
                    return (
                      <div key={a.account} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          {accountIcon(a.account)}
                          <span className="text-sm">{accountLabel(a.account)}</span>
                        </div>
                        <span className={`font-mono font-semibold text-sm ${bal < 0 ? "text-destructive" : bal === 0 ? "text-muted-foreground" : ""}`}>
                          {formatKes(a.balanceKes)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                Revenue by Source
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {cashPos.byIncomeSource.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cleared income recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {cashPos.byIncomeSource.map(s => (
                    <div key={s.category} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground truncate">{s.category}</span>
                      <span className="font-mono font-semibold text-sm text-emerald-700 dark:text-emerald-400 shrink-0">{formatKes(s.totalKes)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-rose-500" />
                Expenses by Category
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {cashPos.byExpenseCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cleared expenses recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {cashPos.byExpenseCategory.map(e => (
                    <div key={e.category} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground truncate">{e.category}</span>
                      <span className="font-mono font-semibold text-sm text-rose-600 shrink-0">{formatKes(e.totalKes)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cash Flow Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} tickFormatter={val => `${(val / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(val: number) => formatKes(val)} />
                  <Legend />
                  <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weekly cash context table */}
      <div>
        <h2 className="text-xl font-bold tracking-tight border-b pb-2 mb-4">Weekly Cash Context</h2>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left font-medium p-3 text-muted-foreground w-10"></th>
                <th className="text-left font-medium p-3 text-muted-foreground">Week</th>
                <th className="text-right font-medium p-3 text-muted-foreground">Income</th>
                <th className="text-right font-medium p-3 text-muted-foreground hidden md:table-cell">Expenses</th>
                <th className="text-right font-medium p-3 text-muted-foreground">Net</th>
                <th className="text-right font-medium p-3 text-muted-foreground hidden lg:table-cell">Planned In</th>
                <th className="w-10 p-3"></th>
              </tr>
            </thead>
            <tbody>
              {(summary?.weeklyRows ?? []).map(w => (
                <>
                  <tr
                    key={w.weekId}
                    className="border-b last:border-0 hover:bg-muted/20 cursor-pointer"
                    onClick={() => toggleWeek(w.weekId)}
                  >
                    <td className="p-3">
                      {expandedWeeks.has(w.weekId)
                        ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    </td>
                    <td className="p-3 font-medium">
                      W{w.weekNumber}
                      <span className="text-xs text-muted-foreground font-normal ml-2">
                        {new Date(w.periodStartDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono text-emerald-600">{formatKes(w.totalIncomeKes)}</td>
                    <td className="p-3 text-right font-mono text-rose-500 hidden md:table-cell">{formatKes(w.totalExpensesKes)}</td>
                    <td className={`p-3 text-right font-mono font-semibold ${parseFloat(w.netKes) < 0 ? "text-destructive" : "text-foreground"}`}>
                      {formatKes(w.netKes)}
                    </td>
                    <td className="p-3 text-right font-mono text-muted-foreground hidden lg:table-cell">
                      {w.plannedInKes ? formatKes(w.plannedInKes) : "—"}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={e => { e.stopPropagation(); openCreate(); }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted"
                        title="Log transaction"
                      >
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </td>
                  </tr>
                  {expandedWeeks.has(w.weekId) && <WeekBreakdown weekId={w.weekId} />}
                </>
              ))}
              {!(summary?.weeklyRows?.length) && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    No transactions yet. <button className="text-primary underline" onClick={() => openCreate()}>Log one now</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <TransactionForm
        open={formOpen}
        onClose={handleClose}
        transaction={editingTx}
        defaultType={formDefaults.defaultType as any}
        defaultAmount={formDefaults.defaultAmount}
        defaultDescription={formDefaults.defaultDescription}
      />
    </div>
  );
}
