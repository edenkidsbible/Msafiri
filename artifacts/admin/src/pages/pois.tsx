import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import {
  useAdminListPois,
  useAdminCreatePoi,
  useAdminUpdatePoi,
  useAdminDeletePoi,
  getAdminListPoisQueryKey,
} from "@workspace/api-client-react";
import type { AdminPoi, AdminPoiInput } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Edit, EyeOff, Trash2, Search, Loader2, ArrowLeft, ArrowRight, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { PoiPickerMap } from "@/components/poi-picker-map";

const TYPE_LABELS: Record<string, string> = {
  fuel:     "⛽ Fuel",
  food:     "🍔 Food",
  shopping: "🛍 Shopping",
  hospital: "🏥 Hospital",
};

const TYPE_COLORS: Record<string, string> = {
  fuel:     "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20",
  food:     "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20",
  shopping: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20",
  hospital: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
};

const poiSchema = z.object({
  name:    z.string().min(1, "Name is required"),
  brand:   z.string().min(1, "Brand is required"),
  type:    z.enum(["fuel", "food", "shopping", "hospital"]),
  lat:     z.coerce.number({ invalid_type_error: "Must be a number" }).min(-90).max(90),
  lng:     z.coerce.number({ invalid_type_error: "Must be a number" }).min(-180).max(180),
  address: z.string().min(1, "Address is required"),
  hours:   z.string().optional().nullable(),
  status:  z.enum(["active", "inactive"]).default("active"),
});

type PoiFormValues = z.infer<typeof poiSchema>;

const DEFAULT_VALUES: PoiFormValues = {
  name: "", brand: "", type: "fuel", lat: 0, lng: 0, address: "", hours: "", status: "active",
};

export default function Pois() {
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState("");
  const [typeFilter, setType]   = useState("all");
  const [statusFilter, setStatus] = useState("all");

  const [isAddOpen, setIsAddOpen]       = useState(false);
  const [editPoi, setEditPoi]           = useState<AdminPoi | null>(null);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [deleteId, setDeleteId]         = useState<string | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const LIMIT = 50;

  const params = {
    page, limit: LIMIT,
    ...(search                        ? { search }            : {}),
    ...(typeFilter   !== "all"        ? { type: typeFilter }  : {}),
    ...(statusFilter !== "all"        ? { status: statusFilter } : {}),
  };

  const { data, isLoading } = useAdminListPois(params);
  const { mutate: createPoi, isPending: isCreating } = useAdminCreatePoi();
  const { mutate: updatePoi, isPending: isUpdating } = useAdminUpdatePoi();
  const { mutate: deletePoi, isPending: isDeleting } = useAdminDeletePoi();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getAdminListPoisQueryKey() });

  const addForm  = useForm<PoiFormValues>({ resolver: zodResolver(poiSchema), defaultValues: DEFAULT_VALUES });
  const editForm = useForm<PoiFormValues>({ resolver: zodResolver(poiSchema), defaultValues: DEFAULT_VALUES });

  const openEdit = (p: AdminPoi) => {
    setEditPoi(p);
    editForm.reset({
      name: p.name, brand: p.brand, type: p.type as PoiFormValues["type"],
      lat: p.lat, lng: p.lng, address: p.address,
      hours: p.hours ?? "", status: p.status as PoiFormValues["status"],
    });
  };

  const handleCreate = (values: PoiFormValues) => {
    const input: AdminPoiInput = {
      ...values,
      hours: values.hours || null,
    };
    createPoi({ data: input }, {
      onSuccess: () => {
        toast({ title: "POI created" });
        setIsAddOpen(false);
        addForm.reset(DEFAULT_VALUES);
        invalidate();
      },
      onError: () => toast({ title: "Failed to create POI", variant: "destructive" }),
    });
  };

  const handleUpdate = (values: PoiFormValues) => {
    if (!editPoi) return;
    updatePoi({ id: editPoi.id, data: { ...values, hours: values.hours || null } }, {
      onSuccess: () => {
        toast({ title: "POI updated" });
        setEditPoi(null);
        invalidate();
      },
      onError: () => toast({ title: "Failed to update POI", variant: "destructive" }),
    });
  };

  const handleDeactivate = () => {
    if (!deactivateId) return;
    updatePoi({ id: deactivateId, data: { status: "inactive" } }, {
      onSuccess: () => {
        toast({ title: "POI deactivated — drivers will no longer see it" });
        setDeactivateId(null);
        invalidate();
      },
      onError: () => toast({ title: "Failed to deactivate POI", variant: "destructive" }),
    });
  };

  const handleHardDelete = () => {
    if (!deleteId) return;
    deletePoi({ id: deleteId, hard: true }, {
      onSuccess: () => {
        toast({ title: "POI permanently deleted" });
        setDeleteId(null);
        invalidate();
      },
      onError: () => toast({ title: "Failed to delete POI", variant: "destructive" }),
    });
  };

  const total     = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary p-2 rounded-lg">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Points of Interest</h1>
              <p className="text-sm text-muted-foreground">
                Manage fuel stations, restaurants, and other POIs shown to drivers.
              </p>
            </div>
          </div>
          <Button onClick={() => { addForm.reset(DEFAULT_VALUES); setIsAddOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Add POI
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, brand, address…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 w-64"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => { setType(v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="fuel">Fuel</SelectItem>
              <SelectItem value="food">Food</SelectItem>
              <SelectItem value="shopping">Shopping</SelectItem>
              <SelectItem value="hospital">Hospital</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-32"><SelectValue placeholder="All status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <span className="self-center text-sm text-muted-foreground ml-auto">{total} POI{total !== 1 ? "s" : ""}</span>
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name / Brand</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Coordinates</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : !data?.pois?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No POIs found.
                  </TableCell>
                </TableRow>
              ) : (
                data.pois.map((p) => (
                  <TableRow key={p.id} className={p.status === "inactive" ? "opacity-50" : ""}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.brand}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={TYPE_COLORS[p.type] ?? ""}>
                        {TYPE_LABELS[p.type] ?? p.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-sm">{p.address}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.hours ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "active" ? "default" : "secondary"}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)} title="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                        {p.status === "active" && (
                          <Button variant="ghost" size="icon" onClick={() => setDeactivateId(p.id)} title="Deactivate">
                            <EyeOff className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(p.id)} title="Delete permanently">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Add POI dialog ──────────────────────────────────────────────────── */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Point of Interest</DialogTitle>
            <DialogDescription>Add a new POI that will appear on the driver map.</DialogDescription>
          </DialogHeader>
          <PoiForm form={addForm} onSubmit={handleCreate} isPending={isCreating} submitLabel="Create POI" />
        </DialogContent>
      </Dialog>

      {/* ── Edit POI dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!editPoi} onOpenChange={(open) => { if (!open) setEditPoi(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit POI</DialogTitle>
            <DialogDescription>Update the name, coordinates, hours, or status.</DialogDescription>
          </DialogHeader>
          <PoiForm form={editForm} onSubmit={handleUpdate} isPending={isUpdating} submitLabel="Save Changes" showStatus />
        </DialogContent>
      </Dialog>

      {/* ── Deactivate confirm ──────────────────────────────────────────────── */}
      <AlertDialog open={!!deactivateId} onOpenChange={(open) => { if (!open) setDeactivateId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this POI?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be hidden from drivers immediately. You can re-activate it by editing the status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate} disabled={isUpdating}>
              {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Hard delete confirm ─────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this POI?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Use "Deactivate" instead if you just want to hide it from drivers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleHardDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}

// ── Shared form component ─────────────────────────────────────────────────────

function PoiForm({
  form,
  onSubmit,
  isPending,
  submitLabel,
  showStatus = false,
}: {
  form: ReturnType<typeof useForm<PoiFormValues>>;
  onSubmit: (v: PoiFormValues) => void;
  isPending: boolean;
  submitLabel: string;
  showStatus?: boolean;
}) {
  const lat = form.watch("lat");
  const lng = form.watch("lng");

  const handleMapPick = (pickedLat: number, pickedLng: number) => {
    form.setValue("lat", parseFloat(pickedLat.toFixed(6)), { shouldValidate: true });
    form.setValue("lng", parseFloat(pickedLng.toFixed(6)), { shouldValidate: true });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl><Input placeholder="Shell Westlands" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="brand" render={({ field }) => (
            <FormItem>
              <FormLabel>Brand</FormLabel>
              <FormControl><Input placeholder="Shell" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="type" render={({ field }) => (
            <FormItem>
              <FormLabel>Type</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fuel">⛽ Fuel</SelectItem>
                  <SelectItem value="food">🍔 Food</SelectItem>
                  <SelectItem value="shopping">🛍 Shopping</SelectItem>
                  <SelectItem value="hospital">🏥 Hospital</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          {showStatus && (
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          )}
        </div>

        {/* ── Map picker ─────────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium leading-none">
            Location
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              Click the map to place a pin, or type coordinates below
            </span>
          </p>
          <PoiPickerMap lat={lat} lng={lng} onPick={handleMapPick} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="lat" render={({ field }) => (
            <FormItem>
              <FormLabel>Latitude</FormLabel>
              <FormControl><Input type="number" step="any" placeholder="-1.2673" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="lng" render={({ field }) => (
            <FormItem>
              <FormLabel>Longitude</FormLabel>
              <FormControl><Input type="number" step="any" placeholder="36.81" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="address" render={({ field }) => (
          <FormItem>
            <FormLabel>Address</FormLabel>
            <FormControl><Input placeholder="Westlands, Nairobi" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="hours" render={({ field }) => (
          <FormItem>
            <FormLabel>Hours <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
            <FormControl><Input placeholder="24hrs · 7am–10pm" {...field} value={field.value ?? ""} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
