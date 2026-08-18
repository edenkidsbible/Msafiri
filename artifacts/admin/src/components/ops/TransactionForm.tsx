import { useState, useEffect } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Trash2 } from "lucide-react";

type TransactionInputType = "income" | "expense" | "refund_in" | "refund_out" | "reserve_transfer";

interface Category { id: number; name: string; type: string; }
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

interface TransactionFormProps {
  open: boolean;
  onClose: () => void;
  transaction?: Transaction;
  defaultAmount?: string;
  defaultType?: TransactionInputType;
  defaultDescription?: string;
}

function useListCategories() {
  return useQuery<Category[]>({
    queryKey: ["ops-categories"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/categories");
      if (!r.ok) throw new Error("Failed to fetch categories");
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
}

export function TransactionForm({
  open, onClose, transaction, defaultAmount, defaultType, defaultDescription,
}: TransactionFormProps) {
  const qc = useQueryClient();
  const { data: categories } = useListCategories();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState({
    date: transaction?.date?.split("T")[0] ?? today,
    type: (transaction?.type ?? defaultType ?? "expense") as TransactionInputType,
    amountKes: transaction?.amountKes ?? defaultAmount ?? "",
    description: transaction?.description ?? defaultDescription ?? "",
    categoryId: transaction?.categoryId?.toString() ?? "",
    cleared: transaction?.cleared ?? false,
    paymentMethod: transaction?.paymentMethod ?? "",
    reference: transaction?.reference ?? "",
    notes: transaction?.notes ?? "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        date: transaction?.date?.split("T")[0] ?? today,
        type: (transaction?.type ?? defaultType ?? "expense") as TransactionInputType,
        amountKes: transaction?.amountKes ?? defaultAmount ?? "",
        description: transaction?.description ?? defaultDescription ?? "",
        categoryId: transaction?.categoryId?.toString() ?? "",
        cleared: transaction?.cleared ?? false,
        paymentMethod: transaction?.paymentMethod ?? "",
        reference: transaction?.reference ?? "",
        notes: transaction?.notes ?? "",
      });
    }
  }, [open, transaction]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ops-transactions"] });
    qc.invalidateQueries({ queryKey: ["ops-transaction-summary"] });
    qc.invalidateQueries({ queryKey: ["cash-position"] });
    qc.invalidateQueries({ queryKey: ["dashboard-focus"] });
    qc.invalidateQueries({ queryKey: ["ops-weeks"] });
    qc.invalidateQueries({ queryKey: ["transactions", "week"] });
  };

  const createTx = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch("/api/ops/transactions", { method: "POST", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to create transaction");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const updateTx = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch(`/api/ops/transactions/${transaction!.id}`, { method: "PATCH", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to update transaction");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const deleteTx = useMutation({
    mutationFn: async () => {
      const r = await authFetch(`/api/ops/transactions/${transaction!.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete transaction");
    },
    onSuccess: () => { invalidate(); setDeleteOpen(false); onClose(); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amountKes || !form.description) return;
    const payload = {
      date: form.date,
      type: form.type,
      amountKes: form.amountKes,
      description: form.description,
      categoryId: form.categoryId ? parseInt(form.categoryId) : undefined,
      cleared: form.cleared,
      paymentMethod: form.paymentMethod || undefined,
      reference: form.reference || undefined,
      notes: form.notes || undefined,
    };
    if (transaction) {
      await updateTx.mutateAsync(payload);
    } else {
      await createTx.mutateAsync(payload);
    }
  };

  const handleDelete = async () => {
    await deleteTx.mutateAsync();
  };

  const isLoading = createTx.isPending || updateTx.isPending;

  const filteredCategories = categories?.filter(c =>
    form.type === "income" || form.type === "refund_in" ? c.type === "income" : c.type === "expense"
  ) ?? [];

  return (
    <>
      <FormDialog open={open} onClose={onClose} title={transaction ? "Edit Transaction" : "Log Transaction"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as TransactionInputType, categoryId: "" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="refund_in">Refund In</SelectItem>
                  <SelectItem value="refund_out">Refund Out</SelectItem>
                  <SelectItem value="reserve_transfer">Reserve Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Amount (KES)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.amountKes}
              onChange={e => setForm(f => ({ ...f, amountKes: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input
              placeholder="What was this for?"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              required
            />
          </div>

          {filteredCategories.length > 0 && (
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.categoryId || "none"} onValueChange={v => setForm(f => ({ ...f, categoryId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Uncategorised</SelectItem>
                  {filteredCategories.map(c => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={form.paymentMethod || "none"} onValueChange={v => setForm(f => ({ ...f, paymentMethod: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Method" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="mpesa">M-PESA</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reference</Label>
              <Input
                placeholder="e.g. QFM7XXXXXX"
                value={form.reference}
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input
              placeholder="Optional notes"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="cleared"
              checked={form.cleared}
              onCheckedChange={v => setForm(f => ({ ...f, cleared: !!v }))}
            />
            <Label htmlFor="cleared">Cleared (funds have moved)</Label>
          </div>

          <FormDialogFooter>
            <div>
              {transaction && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {transaction ? "Save Changes" : "Log Transaction"}
              </Button>
            </div>
          </FormDialogFooter>
        </form>
      </FormDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the transaction. Cash balances will be recalculated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
