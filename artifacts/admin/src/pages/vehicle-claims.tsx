import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Flag, Car, CheckCircle2, Eye, Filter, ArrowRightLeft, Trash2, NotebookPen } from "lucide-react";
import { format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

interface Claim {
  id: string;
  status: "pending" | "reviewed" | "resolved";
  claimNote: string | null;
  adminNote: string | null;
  claimantDeviceId: string;
  createdAt: string;
  vehicleId: string;
  vehiclePlate: string | null;
  vehicleName: string;
  vehicleType: string;
  ownerDeviceId: string;
}

function StatusBadge({ status }: { status: Claim["status"] }) {
  if (status === "pending")
    return <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 shadow-none">Pending</Badge>;
  if (status === "reviewed")
    return <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 shadow-none">Reviewed</Badge>;
  return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 shadow-none">Resolved</Badge>;
}

// ── Inline notes editor for a single claim row ────────────────────────────────
function NotesCell({ claim, onSaved }: { claim: Claim; onSaved: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(claim.adminNote ?? "");
  const [saving,  setSaving]  = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await authFetch(`/api/admin/vehicle-claims/${claim.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminNote: draft }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Notes saved" });
      setEditing(false);
      onSaved();
    } catch {
      toast({ title: "Failed to save notes", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="group flex items-start gap-2 min-h-[40px]">
        <p className="text-sm text-foreground/70 leading-relaxed flex-1 whitespace-pre-wrap">
          {claim.adminNote
            ? claim.adminNote
            : <span className="italic text-muted-foreground/40">No notes yet</span>}
        </p>
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
          onClick={() => { setDraft(claim.adminNote ?? ""); setEditing(true); }}
          title="Edit notes"
        >
          <NotebookPen className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Record investigation notes here — logbook details, contact history, decision rationale…"
        className="text-sm min-h-[90px] resize-none"
        autoFocus
      />
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Transfer-ownership confirm dialog ─────────────────────────────────────────
function TransferDialog({
  claim,
  open,
  onClose,
  onDone,
}: {
  claim: Claim | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!claim) return;
    setBusy(true);
    try {
      const r = await authFetch(`/api/admin/vehicle-claims/${claim.id}/transfer-owner`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Ownership transferred", description: `${claim.vehicleName} is now owned by the claimant.` });
      onDone();
      onClose();
    } catch {
      toast({ title: "Transfer failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-blue-500" />
            Transfer Ownership
          </DialogTitle>
          <DialogDescription className="pt-2 space-y-3 text-sm">
            <p>
              This will reassign <strong>{claim?.vehicleName}</strong>{claim?.vehiclePlate ? ` (${claim.vehiclePlate})` : ""} from the current registered account to the claimant's device.
            </p>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 font-mono text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Current owner</span>
                <span className="truncate">{claim?.ownerDeviceId.slice(0, 24)}…</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">New owner (claimant)</span>
                <span className="truncate">{claim?.claimantDeviceId.slice(0, 24)}…</span>
              </div>
            </div>
            <p className="text-amber-600 dark:text-amber-400 font-medium">
              ⚠ Only do this after verifying the logbook. The previous owner will be demoted to co-driver and can be removed from the garage after the transfer.
            </p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={confirm}
            disabled={busy}
          >
            {busy ? "Transferring…" : "Yes, Transfer Ownership"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete-vehicle confirm dialog ─────────────────────────────────────────────
function DeleteDialog({
  claim,
  open,
  onClose,
  onDone,
}: {
  claim: Claim | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");

  async function doDelete() {
    if (!claim) return;
    setBusy(true);
    try {
      const r = await authFetch(`/api/admin/vehicle-claims/${claim.id}/vehicle`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Vehicle deleted", description: `${claim.vehicleName} has been removed. The real owner can now re-register.` });
      onDone();
      onClose();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setBusy(false);
      setConfirm("");
    }
  }

  const plate = claim?.vehiclePlate ?? "DELETE";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setConfirm(""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete Vehicle Registration
          </DialogTitle>
          <DialogDescription className="pt-2 space-y-3 text-sm">
            <p>
              This permanently deletes <strong>{claim?.vehicleName}</strong>{claim?.vehiclePlate ? ` (${claim.vehiclePlate})` : ""} and removes all its members. The real owner can re-register from scratch after this.
            </p>
            <p className="text-destructive font-medium">
              This cannot be undone. Use Transfer Ownership instead unless the account is clearly fraudulent.
            </p>
            <div className="space-y-1.5">
              <p className="text-muted-foreground">
                Type <strong className="font-mono text-foreground">{plate}</strong> to confirm:
              </p>
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={plate}
                autoFocus
              />
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { onClose(); setConfirm(""); }} disabled={busy}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={doDelete}
            disabled={busy || confirm !== plate}
          >
            {busy ? "Deleting…" : "Delete Vehicle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function VehicleClaims() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("pending");

  const [transferTarget, setTransferTarget] = useState<Claim | null>(null);
  const [deleteTarget,   setDeleteTarget]   = useState<Claim | null>(null);

  const { data, isLoading, isError } = useQuery<{ claims: Claim[] }>({
    queryKey: ["/api/admin/vehicle-claims", filter],
    queryFn: () =>
      authFetch(`/api/admin/vehicle-claims${filter !== "all" ? `?status=${filter}` : ""}`)
        .then((r) => r.json()),
    staleTime: 30_000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      authFetch(`/api/admin/vehicle-claims/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/vehicle-claims"] });
      toast({ title: "Claim updated" });
    },
    onError: () => toast({ title: "Failed to update claim", variant: "destructive" }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/admin/vehicle-claims"] });

  const counts = {
    pending:  data?.claims.filter((c) => c.status === "pending").length  ?? 0,
    reviewed: data?.claims.filter((c) => c.status === "reviewed").length ?? 0,
    resolved: data?.claims.filter((c) => c.status === "resolved").length ?? 0,
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex flex-col gap-1 border-b pb-6">
            <h1 className="text-3xl font-bold tracking-tight">Vehicle Ownership Claims</h1>
            <p className="text-muted-foreground">Users claiming a plate is wrongly registered under another account.</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </AdminLayout>
    );
  }

  if (isError) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex flex-col gap-1 border-b pb-6">
            <h1 className="text-3xl font-bold tracking-tight">Vehicle Ownership Claims</h1>
          </div>
          <div className="flex flex-col items-center justify-center min-h-[300px] border border-destructive/20 bg-destructive/5 rounded-xl text-center p-8">
            <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
            <h2 className="text-lg font-semibold">Could not load claims</h2>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        {/* Header */}
        <div className="flex flex-col gap-1 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Vehicle Ownership Claims</h1>
          <p className="text-muted-foreground">
            Submitted when a user reports that a plate is wrongly registered under another account.
          </p>
        </div>

        {/* How to investigate — guidance card */}
        <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-blue-700 dark:text-blue-400">How to investigate a claim</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-blue-700/80 dark:text-blue-300/80 space-y-1.5">
            <p><strong>1. Request a logbook photo</strong> — ask the claimant to send a photo of their Kenya motor vehicle log book (blue book). Compare the name, plate, and chassis number against what's registered.</p>
            <p><strong>2. Check the registered account's history</strong> — a legitimate owner has trips, sessions, and possibly a linked phone number. An account with none is a red flag.</p>
            <p><strong>3. Record your findings</strong> — use the Notes field on the claim row to log what you found. This is visible to all admins.</p>
            <p><strong>4. Act</strong> — if the claimant is the real owner, use <em>Transfer Ownership</em>. If the registered account is clearly fraudulent and the real owner prefers a clean start, use <em>Delete Vehicle</em> so they can re-register.</p>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="shadow-sm cursor-pointer hover:border-amber-300 transition-colors" onClick={() => setFilter("pending")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending Review</CardTitle>
              <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Flag className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">{counts.pending}</div>
              <p className="text-xs text-muted-foreground mt-1">Needs action</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm cursor-pointer hover:border-blue-300 transition-colors" onClick={() => setFilter("reviewed")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Under Review</CardTitle>
              <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">{counts.reviewed}</div>
              <p className="text-xs text-muted-foreground mt-1">In progress</p>
            </CardContent>
          </Card>
          <Card className="shadow-sm cursor-pointer hover:border-emerald-300 transition-colors" onClick={() => setFilter("resolved")}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Resolved</CardTitle>
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">{counts.resolved}</div>
              <p className="text-xs text-muted-foreground mt-1">Closed</p>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
            <p className="text-sm font-medium text-foreground">
              {data?.claims.length ?? 0} claim{(data?.claims.length ?? 0) !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-[140px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-[180px]">Vehicle</TableHead>
                <TableHead className="w-[160px]">Devices</TableHead>
                <TableHead>Claimant's note</TableHead>
                <TableHead>Admin notes</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="w-[130px]">Submitted</TableHead>
                <TableHead className="w-[220px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.claims.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-48 text-center">
                    <Car className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-20" />
                    <p className="text-muted-foreground font-medium">No claims match this filter</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                      Claims appear when a user reports that a plate is wrongly registered.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                data?.claims.map((claim) => (
                  <TableRow key={claim.id} className="hover:bg-muted/20 transition-colors align-top">
                    {/* Vehicle */}
                    <TableCell className="pt-4">
                      <div className="font-semibold text-sm text-foreground">{claim.vehicleName}</div>
                      {claim.vehiclePlate && (
                        <div className="text-xs font-mono text-muted-foreground mt-0.5">{claim.vehiclePlate}</div>
                      )}
                      <div className="text-xs text-muted-foreground/60 mt-0.5 capitalize">{claim.vehicleType}</div>
                    </TableCell>

                    {/* Devices */}
                    <TableCell className="pt-4">
                      <div className="space-y-1">
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 block">Registered</span>
                          <span className="font-mono text-xs text-muted-foreground">{claim.ownerDeviceId.slice(0, 16)}…</span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 block">Claimant</span>
                          <span className="font-mono text-xs text-amber-600 dark:text-amber-400">{claim.claimantDeviceId.slice(0, 16)}…</span>
                        </div>
                      </div>
                    </TableCell>

                    {/* Claimant note */}
                    <TableCell className="pt-4 max-w-[200px]">
                      <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap">
                        {claim.claimNote ?? <span className="italic text-muted-foreground/40">No note</span>}
                      </p>
                    </TableCell>

                    {/* Admin notes (inline edit) */}
                    <TableCell className="pt-4 max-w-[220px]">
                      <NotesCell claim={claim} onSaved={invalidate} />
                    </TableCell>

                    {/* Status */}
                    <TableCell className="pt-4"><StatusBadge status={claim.status} /></TableCell>

                    {/* Date */}
                    <TableCell className="pt-4 text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(claim.createdAt), "dd MMM yyyy")}
                      <div className="text-xs text-muted-foreground/50">{format(new Date(claim.createdAt), "HH:mm")}</div>
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="pt-4">
                      <div className="flex flex-col gap-1.5 items-end">
                        {claim.status === "pending" && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs w-full justify-center"
                            disabled={statusMutation.isPending}
                            onClick={() => statusMutation.mutate({ id: claim.id, status: "reviewed" })}
                          >
                            Mark Reviewed
                          </Button>
                        )}
                        {claim.status !== "resolved" && (
                          <Button
                            size="sm"
                            className="h-7 text-xs w-full justify-center bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => setTransferTarget(claim)}
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                            Transfer Owner
                          </Button>
                        )}
                        {claim.status !== "resolved" && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs w-full justify-center text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
                            onClick={() => setDeleteTarget(claim)}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                            Delete Vehicle
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Dialogs */}
      <TransferDialog
        claim={transferTarget}
        open={!!transferTarget}
        onClose={() => setTransferTarget(null)}
        onDone={invalidate}
      />
      <DeleteDialog
        claim={deleteTarget}
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDone={invalidate}
      />
    </AdminLayout>
  );
}
