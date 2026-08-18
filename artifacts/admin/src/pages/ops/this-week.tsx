import { AdminLayout } from "@/components/layout/admin-layout";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { formatKes } from "@/lib/utils";
import {
  Target, Flag, CircleDollarSign, Edit3, BookOpen, Loader2,
  Plus, Trash2, Check, Pencil, ArrowRight, Zap, Package2, Users2, MapPin, FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { TransactionForm } from "@/components/ops/TransactionForm";

interface Week {
  id: number;
  weekNumber: number;
  startDate: string;
  endDate: string;
  plannedCashInKes: string | null;
  plannedCashOutKes: string | null;
  plannedEndingCashKes: string | null;
  actualCashInKes: string | null;
  actualCashOutKes: string | null;
  varianceKes: string | null;
}

interface WeeklyPlan {
  id?: number;
  weekId: number;
  mainObjective: string | null;
  requiredOutcomes: string[] | null;
  completedOutcomes: string[] | null;
  cashDecision: string | null;
  productPriority: string | null;
  userPriority: string | null;
  fieldSprint: string | null;
  contentPlan: string | null;
}

interface WeeklyReview {
  id?: number;
  weekId: number;
  whatWorked: string | null;
  whatDidntWork: string | null;
  keyLearning: string | null;
  nextWeekFocus: string | null;
}

function useWeeks() {
  return useQuery<{ weeks: Week[]; currentWeekNumber: number }>({
    queryKey: ["ops", "weeks"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/weeks");
      if (!r.ok) throw new Error("Failed to load weeks");
      return r.json();
    },
  });
}

function useWeekPlan(weekId: number | null) {
  return useQuery<WeeklyPlan | null>({
    queryKey: ["ops", "weekly-plan", weekId],
    queryFn: async () => {
      const r = await authFetch(`/api/ops/weeks/${weekId}/plan`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: weekId !== null,
  });
}

function useWeekReview(weekId: number | null) {
  return useQuery<WeeklyReview | null>({
    queryKey: ["ops", "weekly-review", weekId],
    queryFn: async () => {
      const r = await authFetch(`/api/ops/weeks/${weekId}/review`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: weekId !== null,
  });
}

// ── Plan edit dialog ──────────────────────────────────────────────────────────

function PlanDialog({
  open, onClose, weekId, weekNumber, initial,
}: {
  open: boolean;
  onClose: () => void;
  weekId: number;
  weekNumber: number;
  initial?: WeeklyPlan | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    mainObjective: "",
    cashDecision: "",
    productPriority: "",
    userPriority: "",
    fieldSprint: "",
    contentPlan: "",
    requiredOutcomes: [""] as string[],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        mainObjective: initial?.mainObjective ?? "",
        cashDecision: initial?.cashDecision ?? "",
        productPriority: initial?.productPriority ?? "",
        userPriority: initial?.userPriority ?? "",
        fieldSprint: initial?.fieldSprint ?? "",
        contentPlan: initial?.contentPlan ?? "",
        requiredOutcomes: initial?.requiredOutcomes?.length ? [...initial.requiredOutcomes, ""] : [""],
      });
    }
  }, [open, initial]);

  const setOutcome = (i: number, v: string) =>
    setForm((f) => { const n = [...f.requiredOutcomes]; n[i] = v; return { ...f, requiredOutcomes: n }; });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const outcomes = form.requiredOutcomes.map(o => o.trim()).filter(Boolean);
    await authFetch(`/api/ops/weeks/${weekId}/plan`, {
      method: "PUT",
      body: JSON.stringify({
        mainObjective: form.mainObjective.trim() || null,
        cashDecision: form.cashDecision.trim() || null,
        productPriority: form.productPriority.trim() || null,
        userPriority: form.userPriority.trim() || null,
        fieldSprint: form.fieldSprint.trim() || null,
        contentPlan: form.contentPlan.trim() || null,
        requiredOutcomes: outcomes,
      }),
    });
    qc.invalidateQueries({ queryKey: ["ops", "weekly-plan", weekId] });
    qc.invalidateQueries({ queryKey: ["ops", "weeks"] });
    setSaving(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Week {weekNumber} Plan</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Main Objective</Label>
            <Textarea rows={2} placeholder="The single most important goal this week…"
              value={form.mainObjective} onChange={(e) => setForm(f => ({ ...f, mainObjective: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Required Outcomes ({form.requiredOutcomes.filter(Boolean).length}/7)</Label>
            {form.requiredOutcomes.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input value={o} onChange={(e) => setOutcome(i, e.target.value)} placeholder={`Outcome ${i + 1}`} />
                {form.requiredOutcomes.length > 1 && (
                  <Button type="button" variant="ghost" size="icon"
                    onClick={() => setForm(f => ({ ...f, requiredOutcomes: f.requiredOutcomes.filter((_, j) => j !== i) }))}>
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
            {form.requiredOutcomes.length < 7 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setForm(f => ({ ...f, requiredOutcomes: [...f.requiredOutcomes, ""] }))}>
                <Plus className="w-4 h-4 mr-1" /> Add Outcome
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Cash Decision</Label>
              <Input value={form.cashDecision} onChange={e => setForm(f => ({ ...f, cashDecision: e.target.value }))} placeholder="Spend / Save / Invest…" />
            </div>
            <div className="space-y-1.5">
              <Label>Field Sprint</Label>
              <Input value={form.fieldSprint} onChange={e => setForm(f => ({ ...f, fieldSprint: e.target.value }))} placeholder="Corridor / goal…" />
            </div>
            <div className="space-y-1.5">
              <Label>Product Priority</Label>
              <Input value={form.productPriority} onChange={e => setForm(f => ({ ...f, productPriority: e.target.value }))} placeholder="Top product focus…" />
            </div>
            <div className="space-y-1.5">
              <Label>User Priority</Label>
              <Input value={form.userPriority} onChange={e => setForm(f => ({ ...f, userPriority: e.target.value }))} placeholder="Top user focus…" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Content Plan</Label>
            <Textarea rows={2} value={form.contentPlan} onChange={e => setForm(f => ({ ...f, contentPlan: e.target.value }))} placeholder="What content goes out this week?" />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="" disabled={saving} onClick={handleSubmit as any}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Saving…</> : "Save Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Review edit dialog ────────────────────────────────────────────────────────

function ReviewDialog({
  open, onClose, weekId, weekNumber, initial,
}: {
  open: boolean; onClose: () => void; weekId: number; weekNumber: number; initial?: WeeklyReview | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ whatWorked: "", whatDidntWork: "", keyLearning: "", nextWeekFocus: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        whatWorked: initial?.whatWorked ?? "",
        whatDidntWork: initial?.whatDidntWork ?? "",
        keyLearning: initial?.keyLearning ?? "",
        nextWeekFocus: initial?.nextWeekFocus ?? "",
      });
    }
  }, [open, initial]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await authFetch(`/api/ops/weeks/${weekId}/review`, {
      method: "PUT",
      body: JSON.stringify({
        whatWorked: form.whatWorked.trim() || null,
        whatDidntWork: form.whatDidntWork.trim() || null,
        keyLearning: form.keyLearning.trim() || null,
        nextWeekFocus: form.nextWeekFocus.trim() || null,
      }),
    });
    qc.invalidateQueries({ queryKey: ["ops", "weekly-review", weekId] });
    setSaving(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Week {weekNumber} Review</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { key: "whatWorked", label: "What Worked?" },
            { key: "whatDidntWork", label: "What Didn't Work?" },
            { key: "keyLearning", label: "Key Learning" },
            { key: "nextWeekFocus", label: "Next Week Focus" },
          ].map(({ key, label }) => (
            <div key={key} className="space-y-1.5">
              <Label>{label}</Label>
              <Textarea rows={2} value={(form as any)[key]}
                onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))}
              />
            </div>
          ))}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving} onClick={handleSubmit as any}>
            {saving ? "Saving…" : "Save Review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ThisWeekPage() {
  const qc = useQueryClient();
  const { data: weeksData, isLoading: weeksLoading } = useWeeks();
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [txFormOpen, setTxFormOpen] = useState(false);

  const weeks = weeksData?.weeks ?? [];
  const currentWeekNum = weeksData?.currentWeekNumber ?? 1;

  // Default to current week
  useEffect(() => {
    if (!selectedWeekId && weeks.length > 0) {
      const cur = weeks.find(w => w.weekNumber === currentWeekNum) ?? weeks[weeks.length - 1];
      if (cur) setSelectedWeekId(cur.id);
    }
  }, [weeks, currentWeekNum]);

  const selectedWeek = weeks.find(w => w.id === selectedWeekId) ?? null;
  const { data: plan } = useWeekPlan(selectedWeekId);
  const { data: review } = useWeekReview(selectedWeekId);

  function fmt(v: string | null | undefined): string {
    if (!v) return "—";
    return formatKes(v);
  }

  const hasPlan = plan && (plan.mainObjective || (plan.requiredOutcomes?.length ?? 0) > 0);
  const hasReview = review && (review.whatWorked || review.whatDidntWork);

  return (
    <AdminLayout>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">This Week</h1>
          <p className="text-muted-foreground text-sm">Weekly plan, review and cash snapshot</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedWeekId?.toString() ?? ""}
            onValueChange={(v) => setSelectedWeekId(parseInt(v))}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Select week" />
            </SelectTrigger>
            <SelectContent>
              {weeks.map(w => (
                <SelectItem key={w.id} value={w.id.toString()}>
                  Week {w.weekNumber}{w.weekNumber === currentWeekNum ? " ← now" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {weeksLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </div>
      ) : !selectedWeek ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Select a week to view details.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {/* Week info bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant={selectedWeek.weekNumber === currentWeekNum ? "default" : "secondary"} className="text-sm px-3 py-1">
              Week {selectedWeek.weekNumber}
              {selectedWeek.weekNumber === currentWeekNum && <span className="ml-1.5 opacity-70">← current</span>}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {new Date(selectedWeek.startDate + "T00:00:00").toLocaleDateString("en-KE", { day: "numeric", month: "short" })}
              {" – "}
              {new Date(selectedWeek.endDate + "T00:00:00").toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>

          {/* Cash snapshot */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <CircleDollarSign className="w-4 h-4" /> Cash Snapshot
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => setTxFormOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add Transaction
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Planned In", value: fmt(selectedWeek.plannedCashInKes), color: "text-emerald-600" },
                  { label: "Planned Out", value: fmt(selectedWeek.plannedCashOutKes), color: "text-rose-600" },
                  { label: "Actual In", value: fmt(selectedWeek.actualCashInKes), color: "text-emerald-700 font-bold" },
                  { label: "Actual Out", value: fmt(selectedWeek.actualCashOutKes), color: "text-rose-700 font-bold" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="space-y-0.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
                    <p className={`text-lg font-mono font-bold ${color}`}>{value}</p>
                  </div>
                ))}
              </div>
              {selectedWeek.varianceKes && (
                <div className="mt-3 pt-3 border-t text-sm">
                  <span className="text-muted-foreground">Variance: </span>
                  <span className={parseFloat(selectedWeek.varianceKes) >= 0 ? "text-emerald-600 font-medium" : "text-rose-600 font-medium"}>
                    {parseFloat(selectedWeek.varianceKes) >= 0 ? "+" : ""}{fmt(selectedWeek.varianceKes)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Plan */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <Target className="w-4 h-4" /> Weekly Plan
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setPlanOpen(true)}>
                <Edit3 className="w-4 h-4 mr-1" /> {hasPlan ? "Edit" : "Add Plan"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {!hasPlan ? (
                <p className="text-muted-foreground text-sm">No plan set for this week yet.</p>
              ) : (
                <>
                  {plan?.mainObjective && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Main Objective</p>
                      <p className="text-sm font-medium">{plan.mainObjective}</p>
                    </div>
                  )}
                  {(plan?.requiredOutcomes?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">Required Outcomes</p>
                      <ul className="space-y-1.5">
                        {plan!.requiredOutcomes!.map((o, i) => {
                          const done = plan?.completedOutcomes?.includes(o);
                          return (
                            <li key={i} className={`flex items-start gap-2 text-sm ${done ? "opacity-50 line-through" : ""}`}>
                              <span className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${done ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground"}`}>
                                {done && <Check className="w-2.5 h-2.5 text-white" />}
                              </span>
                              {o}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      { label: "Cash Decision", value: plan?.cashDecision, icon: CircleDollarSign },
                      { label: "Product Priority", value: plan?.productPriority, icon: Package2 },
                      { label: "User Priority", value: plan?.userPriority, icon: Users2 },
                      { label: "Field Sprint", value: plan?.fieldSprint, icon: MapPin },
                      { label: "Content Plan", value: plan?.contentPlan, icon: FileText },
                    ].filter(p => p.value).map(({ label, value, icon: Icon }) => (
                      <div key={label} className={label === "Content Plan" ? "col-span-2" : ""}>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
                        <p className="text-sm">{value}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Review */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <BookOpen className="w-4 h-4" /> Weekly Review
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setReviewOpen(true)}>
                <Edit3 className="w-4 h-4 mr-1" /> {hasReview ? "Edit" : "Add Review"}
              </Button>
            </CardHeader>
            <CardContent>
              {!hasReview ? (
                <p className="text-muted-foreground text-sm">No review written for this week yet.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {[
                    { label: "What Worked", value: review?.whatWorked },
                    { label: "What Didn't Work", value: review?.whatDidntWork },
                    { label: "Key Learning", value: review?.keyLearning },
                    { label: "Next Week Focus", value: review?.nextWeekFocus },
                  ].filter(r => r.value).map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-1">{label}</p>
                      <p>{value}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Dialogs */}
      {selectedWeek && (
        <>
          <PlanDialog
            open={planOpen}
            onClose={() => setPlanOpen(false)}
            weekId={selectedWeek.id}
            weekNumber={selectedWeek.weekNumber}
            initial={plan}
          />
          <ReviewDialog
            open={reviewOpen}
            onClose={() => setReviewOpen(false)}
            weekId={selectedWeek.id}
            weekNumber={selectedWeek.weekNumber}
            initial={review}
          />
          <TransactionForm
            open={txFormOpen}
            onClose={() => {
              setTxFormOpen(false);
              qc.invalidateQueries({ queryKey: ["ops", "weeks"] });
            }}
          />
        </>
      )}
    </div>
    </AdminLayout>
  );
}
