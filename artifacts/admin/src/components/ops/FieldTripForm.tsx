import { useState, useEffect } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { FormDialog, FormDialogFooter } from "@/components/ui/form-dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Trash2 } from "lucide-react";

type FieldTripInputStatus = "planned" | "in_progress" | "completed" | "cancelled";

interface FieldTrip {
  id: number;
  date: string;
  purpose: string;
  corridor?: string | null;
  status: string;
  plannedKm?: number | null;
  parkingKes?: string | null;
  tollsKes?: string | null;
  requiredOutputs?: string | null;
  notes?: string | null;
}

interface FieldTripFormProps {
  open: boolean;
  onClose: () => void;
  trip?: FieldTrip;
}

export function FieldTripForm({ open, onClose, trip }: FieldTripFormProps) {
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState({
    date: trip?.date?.split("T")[0] ?? today,
    purpose: trip?.purpose ?? "",
    corridor: trip?.corridor ?? "",
    status: (trip?.status ?? "planned") as FieldTripInputStatus,
    plannedKm: trip?.plannedKm?.toString() ?? "",
    parkingKes: trip?.parkingKes?.toString() ?? "",
    tollsKes: trip?.tollsKes?.toString() ?? "",
    contingencyKes: "",
    requiredOutputs: trip?.requiredOutputs ?? "",
    notes: trip?.notes ?? "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        date: trip?.date?.split("T")[0] ?? today,
        purpose: trip?.purpose ?? "",
        corridor: trip?.corridor ?? "",
        status: (trip?.status ?? "planned") as FieldTripInputStatus,
        plannedKm: trip?.plannedKm?.toString() ?? "",
        parkingKes: trip?.parkingKes?.toString() ?? "",
        tollsKes: trip?.tollsKes?.toString() ?? "",
        contingencyKes: "",
        requiredOutputs: trip?.requiredOutputs ?? "",
        notes: trip?.notes ?? "",
      });
    }
  }, [open, trip]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ops-field-trips"] });
    qc.invalidateQueries({ queryKey: ["dashboard-focus"] });
  };

  const createTrip = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch("/api/ops/field-trips", { method: "POST", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to create field trip");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const updateTrip = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch(`/api/ops/field-trips/${trip!.id}`, { method: "PATCH", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to update field trip");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const deleteTrip = useMutation({
    mutationFn: async () => {
      const r = await authFetch(`/api/ops/field-trips/${trip!.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete field trip");
    },
    onSuccess: () => { invalidate(); setDeleteOpen(false); onClose(); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.date || !form.purpose) return;
    const payload = {
      date: form.date,
      purpose: form.purpose,
      corridor: form.corridor || undefined,
      status: form.status || undefined,
      plannedKm: form.plannedKm ? parseFloat(form.plannedKm) : undefined,
      parkingKes: form.parkingKes || undefined,
      tollsKes: form.tollsKes || undefined,
      contingencyKes: form.contingencyKes || undefined,
      requiredOutputs: form.requiredOutputs || undefined,
      notes: form.notes || undefined,
    };
    if (trip) {
      await updateTrip.mutateAsync(payload);
    } else {
      await createTrip.mutateAsync(payload);
    }
  };

  const handleDelete = async () => {
    if (!trip) return;
    await deleteTrip.mutateAsync();
  };

  const isLoading = createTrip.isPending || updateTrip.isPending;

  return (
    <>
      <FormDialog
        open={open}
        onClose={onClose}
        title={trip ? "Edit Field Trip" : "Plan Field Trip"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as FieldTripInputStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planned</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Purpose *</Label>
            <Input
              placeholder="What is this trip for?"
              value={form.purpose}
              onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Corridor</Label>
            <Input
              placeholder="e.g. Nairobi → Nakuru"
              value={form.corridor}
              onChange={e => setForm(f => ({ ...f, corridor: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Planned km</Label>
              <Input
                type="number"
                min="0"
                step="0.1"
                placeholder="0"
                value={form.plannedKm}
                onChange={e => setForm(f => ({ ...f, plannedKm: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Parking (KES)</Label>
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={form.parkingKes}
                onChange={e => setForm(f => ({ ...f, parkingKes: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tolls (KES)</Label>
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={form.tollsKes}
                onChange={e => setForm(f => ({ ...f, tollsKes: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Required Outputs</Label>
            <Input
              placeholder="What must come back from this trip?"
              value={form.requiredOutputs}
              onChange={e => setForm(f => ({ ...f, requiredOutputs: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input
              placeholder="Optional notes"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <FormDialogFooter>
            <div>
              {trip && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {trip ? "Save Changes" : "Plan Trip"}
              </Button>
            </div>
          </FormDialogFooter>
        </form>
      </FormDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Field Trip?</AlertDialogTitle>
            <AlertDialogDescription>This field trip will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
