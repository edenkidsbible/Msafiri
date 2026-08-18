import { useState, useEffect } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { FormDialog, FormDialogFooter } from "@/components/ui/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface SubscriptionWeekMetric {
  id: number;
  weekId: number;
  weekNumber?: number;
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
  notes?: string | null;
}

interface CurrentWeek { id: number; weekNumber: number; }

interface SubscriptionMetricFormProps {
  open: boolean;
  onClose: () => void;
  metric?: SubscriptionWeekMetric;
  prefill?: Partial<{ activePaidEnd: number; trialsStarted: number; }>;
}

function useCurrentWeek() {
  return useQuery<CurrentWeek>({
    queryKey: ["ops-current-week"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/weeks/current");
      if (!r.ok) throw new Error("Failed to fetch current week");
      return r.json();
    },
    staleTime: 60_000,
  });
}

export function SubscriptionMetricForm({ open, onClose, metric, prefill }: SubscriptionMetricFormProps) {
  const qc = useQueryClient();
  const { data: currentWeek } = useCurrentWeek();

  const weekId = metric?.weekId ?? currentWeek?.id ?? 0;
  const weekNumber = metric?.weekNumber ?? currentWeek?.weekNumber ?? 0;

  const blankForm = () => ({
    activePaidEnd: prefill?.activePaidEnd?.toString() ?? metric?.activePaidEnd?.toString() ?? "",
    newDownloads: metric?.newDownloads?.toString() ?? "",
    trialsStarted: prefill?.trialsStarted?.toString() ?? metric?.trialsStarted?.toString() ?? "",
    newPaid: metric?.newPaid?.toString() ?? "",
    renewals: metric?.renewals?.toString() ?? "",
    cancellations: metric?.cancellations?.toString() ?? "",
    grossSalesKes: metric?.grossSalesKes ?? "",
    processorFeesKes: metric?.processorFeesKes ?? "",
    refundsKes: metric?.refundsKes ?? "",
    cashReceivedKes: metric?.cashReceivedKes ?? "",
    notes: metric?.notes ?? "",
  });

  const [form, setForm] = useState(blankForm);

  useEffect(() => {
    if (open) setForm(blankForm());
  }, [open, metric, prefill]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ops-subscription-metrics"] });
    qc.invalidateQueries({ queryKey: ["ops-subscription-summary"] });
    qc.invalidateQueries({ queryKey: ["dashboard-focus"] });
  };

  const n = (v: string) => v ? parseInt(v) : undefined;
  const d = (v: string) => v || undefined;

  const createMetric = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch("/api/ops/subscription-metrics", { method: "POST", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to create subscription metric");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const updateMetric = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch(`/api/ops/subscription-metrics/${metric!.id}`, { method: "PATCH", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to update subscription metric");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.activePaidEnd || !weekId) return;
    const payload = {
      weekId,
      activePaidEnd: parseInt(form.activePaidEnd),
      newDownloads: n(form.newDownloads),
      trialsStarted: n(form.trialsStarted),
      newPaid: n(form.newPaid),
      renewals: n(form.renewals),
      cancellations: n(form.cancellations),
      grossSalesKes: d(form.grossSalesKes),
      processorFeesKes: d(form.processorFeesKes),
      refundsKes: d(form.refundsKes),
      cashReceivedKes: d(form.cashReceivedKes),
      notes: d(form.notes),
    };
    if (metric) {
      await updateMetric.mutateAsync(payload);
    } else {
      await createMetric.mutateAsync(payload);
    }
  };

  const isLoading = createMetric.isPending || updateMetric.isPending;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={metric ? "Edit Weekly Metrics" : "Log Weekly Metrics"}
      description={weekNumber > 0 ? `Week ${weekNumber} subscription data` : undefined}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label>Active Paid Subscribers (end of week) *</Label>
          <Input
            type="number"
            min="0"
            placeholder="0"
            value={form.activePaidEnd}
            onChange={e => setForm(f => ({ ...f, activePaidEnd: e.target.value }))}
            required
          />
        </div>

        <div className="border-t pt-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Acquisition</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>New Downloads</Label>
              <Input type="number" min="0" placeholder="0" value={form.newDownloads} onChange={e => setForm(f => ({ ...f, newDownloads: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Trials Started</Label>
              <Input type="number" min="0" placeholder="0" value={form.trialsStarted} onChange={e => setForm(f => ({ ...f, trialsStarted: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>New Paid</Label>
              <Input type="number" min="0" placeholder="0" value={form.newPaid} onChange={e => setForm(f => ({ ...f, newPaid: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Renewals</Label>
              <Input type="number" min="0" placeholder="0" value={form.renewals} onChange={e => setForm(f => ({ ...f, renewals: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Cancellations</Label>
              <Input type="number" min="0" placeholder="0" value={form.cancellations} onChange={e => setForm(f => ({ ...f, cancellations: e.target.value }))} />
            </div>
          </div>
        </div>

        <div className="border-t pt-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revenue (KES)</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Gross Sales</Label>
              <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.grossSalesKes} onChange={e => setForm(f => ({ ...f, grossSalesKes: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Processor Fees</Label>
              <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.processorFeesKes} onChange={e => setForm(f => ({ ...f, processorFeesKes: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Refunds</Label>
              <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.refundsKes} onChange={e => setForm(f => ({ ...f, refundsKes: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Cash Received</Label>
              <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.cashReceivedKes} onChange={e => setForm(f => ({ ...f, cashReceivedKes: e.target.value }))} />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Input placeholder="Anything notable this week?" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        <FormDialogFooter>
          <div />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isLoading || !weekId}>
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {metric ? "Save Changes" : "Log Metrics"}
            </Button>
          </div>
        </FormDialogFooter>
      </form>
    </FormDialog>
  );
}
