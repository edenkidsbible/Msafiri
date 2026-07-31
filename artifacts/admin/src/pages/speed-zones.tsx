import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import {
  useAdminListSpeedZones,
  useAdminDeleteSpeedZone,
  useAdminCreateSpeedZone,
  useAdminUpdateSpeedZone,
  useAdminVerifySpeedZone,
  useAdminRemoveSpeedZone,
  getAdminListSpeedZonesQueryKey,
} from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Edit, AlertCircle, MapPin, Search, Plus, Map, List, Gauge, Loader2, ArrowLeft, ArrowRight, MoreHorizontal, Navigation2, ShieldCheck, EyeOff } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import type { AdminSpeedZone } from "@workspace/api-client-react";
import { SpeedZonesMap, type PendingZoneCoords } from "@/components/speed-zones-map";

async function snapToRoad(lat: number, lng: number): Promise<{ lat: number; lng: number }> {
  try {
    const res = await fetch(`/api/routing/snap?lat=${lat}&lng=${lng}`);
    if (!res.ok) return { lat, lng };
    return (await res.json()) as { lat: number; lng: number };
  } catch {
    // network error — return original coords
    return { lat, lng };
  }
}

const TYPE_COLORS: Record<string, string> = {
  camera: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20",
  police: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20",
  zone:   "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  active:   "bg-primary/10 text-primary border-primary/20",
  inactive: "bg-muted text-muted-foreground border-muted-foreground/20",
};

const zoneSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
  mode: z.enum(["point", "stretch"]),
  status: z.string().min(1),
  road: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  speedLimit: z.coerce.number().optional().nullable(),
  bearing: z.coerce.number().int().min(0).max(359).optional().nullable(),
  lat: z.coerce.number().optional().nullable(),
  lng: z.coerce.number().optional().nullable(),
  startLat: z.coerce.number().optional().nullable(),
  startLng: z.coerce.number().optional().nullable(),
  endLat: z.coerce.number().optional().nullable(),
  endLng: z.coerce.number().optional().nullable(),
});

/** Compass label for a bearing in degrees (0 = N, 90 = E, 180 = S, 270 = W). */
function bearingLabel(deg: number | null | undefined): string {
  if (deg == null || isNaN(deg)) return "";
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(deg / 45) % 8] ?? "";
}

type ZoneFormValues = z.infer<typeof zoneSchema>;

export default function SpeedZones() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "map">("table");
  const [creationMode, setCreationMode] = useState<"point" | "stretch">("point");

  const [zoneToDelete, setZoneToDelete] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<AdminSpeedZone | null>(null);
  const [pendingCoords, setPendingCoords] = useState<PendingZoneCoords | null>(null);
  const [isSnapping, setIsSnapping] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useAdminListSpeedZones({
    page,
    limit: viewMode === "map" ? 500 : 20,
    search: search || undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getAdminListSpeedZonesQueryKey() });

  const deleteMutation = useAdminDeleteSpeedZone({
    mutation: {
      onSuccess: () => {
        toast({ title: "Zone deleted", description: "The speed zone has been removed." });
        invalidate();
        setZoneToDelete(null);
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to remove the zone.", variant: "destructive" });
        setZoneToDelete(null);
      }
    }
  });

  const createMutation = useAdminCreateSpeedZone({
    mutation: {
      onSuccess: () => {
        toast({ title: "Zone created", description: "New speed zone has been created." });
        invalidate();
        setIsAddOpen(false);
        setPendingCoords(null);
        createForm.reset();
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to create speed zone.", variant: "destructive" });
      }
    }
  });

  const updateMutation = useAdminUpdateSpeedZone({
    mutation: {
      onSuccess: () => {
        toast({ title: "Zone updated", description: "Speed zone details saved." });
        invalidate();
        setEditingZone(null);
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to update speed zone.", variant: "destructive" });
      }
    }
  });

  const verifyMutation = useAdminVerifySpeedZone({
    mutation: {
      onSuccess: () => {
        toast({ title: "Zone verified", description: "Marked as admin-verified." });
        invalidate();
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to verify zone.", variant: "destructive" });
      }
    }
  });

  const removeMutation = useAdminRemoveSpeedZone({
    mutation: {
      onSuccess: () => {
        toast({ title: "Zone deactivated", description: "Zone removed from the live map." });
        invalidate();
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to deactivate zone.", variant: "destructive" });
      }
    }
  });

  const defaultValues: ZoneFormValues = {
    name: "",
    type: "camera",
    mode: "point",
    status: "active",
    road: "",
    description: "",
    speedLimit: 0,
    bearing: null,
    lat: 0,
    lng: 0,
    startLat: 0,
    startLng: 0,
    endLat: 0,
    endLng: 0,
  };

  const createForm = useForm<ZoneFormValues>({
    resolver: zodResolver(zoneSchema),
    defaultValues,
  });

  const editForm = useForm<ZoneFormValues>({
    resolver: zodResolver(zoneSchema),
  });

  const handleDelete = () => {
    if (zoneToDelete) {
      deleteMutation.mutate({ id: zoneToDelete });
    }
  };

  const toPayload = (values: ZoneFormValues) => ({
    name: values.name,
    type: values.type,
    mode: values.mode,
    status: values.status,
    road: values.road || null,
    description: values.description || null,
    speedLimit: values.speedLimit || null,
    bearing: values.bearing ?? null,
    lat: values.mode === "point" ? values.lat ?? null : null,
    lng: values.mode === "point" ? values.lng ?? null : null,
    startLat: values.mode === "stretch" ? values.startLat ?? null : null,
    startLng: values.mode === "stretch" ? values.startLng ?? null : null,
    endLat: values.mode === "stretch" ? values.endLat ?? null : null,
    endLng: values.mode === "stretch" ? values.endLng ?? null : null,
  });

  const onCreateSubmit = (values: ZoneFormValues) => {
    createMutation.mutate({ data: toPayload(values) });
  };

  const onEditSubmit = (values: ZoneFormValues) => {
    if (editingZone) {
      updateMutation.mutate({ id: editingZone.id, data: toPayload(values) });
    }
  };

  const openEditDialog = (zone: AdminSpeedZone) => {
    editForm.reset({
      name: zone.name,
      type: zone.type,
      mode: zone.mode as "point" | "stretch",
      status: zone.status,
      road: zone.road || "",
      description: zone.description || "",
      speedLimit: zone.speedLimit || 0,
      bearing: (zone as any).bearing ?? null,
      lat: zone.lat ?? 0,
      lng: zone.lng ?? 0,
      startLat: zone.startLat ?? 0,
      startLng: zone.startLng ?? 0,
      endLat: zone.endLat ?? 0,
      endLng: zone.endLng ?? 0,
    });
    setEditingZone(zone);
  };

  const handleMapClick = async (rawLat: number, rawLng: number) => {
    setIsSnapping(true);
    const { lat, lng } = await snapToRoad(rawLat, rawLng);
    setIsSnapping(false);

    if (creationMode === "point") {
      setPendingCoords({ mode: "point", lat, lng });
      createForm.reset({ ...defaultValues, mode: "point", lat, lng });
      setIsAddOpen(true);
      return;
    }

    if (!pendingCoords || pendingCoords.mode !== "stretch" || pendingCoords.endLat != null) {
      setPendingCoords({ mode: "stretch", startLat: lat, startLng: lng });
      return;
    }

    const complete: PendingZoneCoords = { mode: "stretch", startLat: pendingCoords.startLat, startLng: pendingCoords.startLng, endLat: lat, endLng: lng };
    setPendingCoords(complete);
    createForm.reset({
      ...defaultValues,
      mode: "stretch",
      startLat: complete.startLat,
      startLng: complete.startLng,
      endLat: complete.endLat,
      endLng: complete.endLng,
    });
    setIsAddOpen(true);
  };

  const handleSnapCreate = async () => {
    const mode = createForm.getValues("mode");
    setIsSnapping(true);
    if (mode === "point") {
      const lat = createForm.getValues("lat") ?? 0;
      const lng = createForm.getValues("lng") ?? 0;
      const snapped = await snapToRoad(lat, lng);
      createForm.setValue("lat", snapped.lat, { shouldDirty: true });
      createForm.setValue("lng", snapped.lng, { shouldDirty: true });
      if (pendingCoords?.mode === "point") setPendingCoords({ mode: "point", lat: snapped.lat, lng: snapped.lng });
    } else {
      const [sLat, sLng, eLat, eLng] = [
        createForm.getValues("startLat") ?? 0, createForm.getValues("startLng") ?? 0,
        createForm.getValues("endLat") ?? 0,  createForm.getValues("endLng") ?? 0,
      ];
      const [start, end] = await Promise.all([snapToRoad(sLat, sLng), snapToRoad(eLat, eLng)]);
      createForm.setValue("startLat", start.lat, { shouldDirty: true });
      createForm.setValue("startLng", start.lng, { shouldDirty: true });
      createForm.setValue("endLat", end.lat, { shouldDirty: true });
      createForm.setValue("endLng", end.lng, { shouldDirty: true });
      if (pendingCoords?.mode === "stretch") setPendingCoords({ mode: "stretch", startLat: start.lat, startLng: start.lng, endLat: end.lat, endLng: end.lng });
    }
    setIsSnapping(false);
    toast({ title: "Snapped to road", description: "Coordinates adjusted to nearest road." });
  };

  const handleSnapEdit = async () => {
    const mode = editForm.getValues("mode");
    setIsSnapping(true);
    if (mode === "point") {
      const lat = editForm.getValues("lat") ?? 0;
      const lng = editForm.getValues("lng") ?? 0;
      const snapped = await snapToRoad(lat, lng);
      editForm.setValue("lat", snapped.lat, { shouldDirty: true });
      editForm.setValue("lng", snapped.lng, { shouldDirty: true });
    } else {
      const [sLat, sLng, eLat, eLng] = [
        editForm.getValues("startLat") ?? 0, editForm.getValues("startLng") ?? 0,
        editForm.getValues("endLat") ?? 0,  editForm.getValues("endLng") ?? 0,
      ];
      const [start, end] = await Promise.all([snapToRoad(sLat, sLng), snapToRoad(eLat, eLng)]);
      editForm.setValue("startLat", start.lat, { shouldDirty: true });
      editForm.setValue("startLng", start.lng, { shouldDirty: true });
      editForm.setValue("endLat", end.lat, { shouldDirty: true });
      editForm.setValue("endLng", end.lng, { shouldDirty: true });
    }
    setIsSnapping(false);
    toast({ title: "Snapped to road", description: "Coordinates adjusted to nearest road." });
  };

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-page-title">Speed Zones</h1>
            <p className="text-muted-foreground mt-1" data-testid="text-page-description">Manage fixed speed cameras, checkpoints, and enforced stretches.</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex bg-muted/50 p-1 rounded-lg">
              <Button
                variant={viewMode === "table" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-2 px-3 shadow-none"
                onClick={() => setViewMode("table")}
                data-testid="btn-view-table"
              >
                <List className="h-4 w-4" /> Table
              </Button>
              <Button
                variant={viewMode === "map" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-2 px-3 shadow-none"
                onClick={() => setViewMode("map")}
                data-testid="btn-view-map"
              >
                <Map className="h-4 w-4" /> Map
              </Button>
            </div>

            <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) setPendingCoords(null); }}>
              <DialogTrigger asChild>
                <Button
                  className="gap-2"
                  onClick={() => {
                    setPendingCoords(null);
                    createForm.reset(defaultValues);
                  }}
                  data-testid="btn-add-zone"
                >
                  <Plus className="h-4 w-4" /> Add Zone
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[450px]">
                <DialogHeader>
                  <DialogTitle>Add Speed Zone</DialogTitle>
                  <DialogDescription>Define a new enforcement point or stretch.</DialogDescription>
                </DialogHeader>
                <Form {...createForm}>
                  <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4 pt-4">
                    <FormField control={createForm.control} name="name" render={({ field }) => (
                      <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="e.g. Thika Road Camera" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={createForm.control}
                        name="type"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Type</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                {Object.keys(TYPE_COLORS).map(type => (
                                  <SelectItem key={type} value={type} className="capitalize">{type}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={createForm.control}
                        name="mode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Mode</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="point" className="capitalize">Point</SelectItem>
                                <SelectItem value="stretch" className="capitalize">Stretch</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    {createForm.watch("mode") === "point" ? (
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={createForm.control} name="lat" render={({ field }) => (
                          <FormItem><FormLabel>Latitude</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                        )} />
                        <FormField control={createForm.control} name="lng" render={({ field }) => (
                          <FormItem><FormLabel>Longitude</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                        )} />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={createForm.control} name="startLat" render={({ field }) => (
                          <FormItem><FormLabel>Start Lat</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                        )} />
                        <FormField control={createForm.control} name="startLng" render={({ field }) => (
                          <FormItem><FormLabel>Start Lng</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                        )} />
                        <FormField control={createForm.control} name="endLat" render={({ field }) => (
                          <FormItem><FormLabel>End Lat</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                        )} />
                        <FormField control={createForm.control} name="endLng" render={({ field }) => (
                          <FormItem><FormLabel>End Lng</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                        )} />
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full gap-2 text-xs"
                      disabled={isSnapping}
                      onClick={handleSnapCreate}
                    >
                      {isSnapping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation2 className="h-3.5 w-3.5" />}
                      {isSnapping ? "Snapping to road..." : "Snap to Road"}
                    </Button>
                    <FormField control={createForm.control} name="road" render={({ field }) => (
                      <FormItem><FormLabel>Road Name</FormLabel><FormControl><Input value={field.value || ''} onChange={field.onChange} /></FormControl></FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={createForm.control} name="status" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              {Object.keys(STATUS_COLORS).map(status => (
                                <SelectItem key={status} value={status} className="capitalize">{status}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={createForm.control} name="speedLimit" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Speed Limit (km/h)</FormLabel>
                          <FormControl><Input type="number" min={0} placeholder="e.g. 50" value={field.value ?? ''} onChange={field.onChange} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={createForm.control} name="description" render={({ field }) => (
                      <FormItem><FormLabel>Description</FormLabel><FormControl><Input value={field.value || ''} onChange={field.onChange} /></FormControl></FormItem>
                    )} />
                    <FormField control={createForm.control} name="bearing" render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Camera bearing (0–359°){" "}
                          <span className="text-muted-foreground font-normal">— optional</span>
                        </FormLabel>
                        <div className="flex items-center gap-2">
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              max={359}
                              placeholder="e.g. 90"
                              value={field.value ?? ''}
                              onChange={field.onChange}
                              className="w-28"
                            />
                          </FormControl>
                          {field.value != null && (
                            <span className="text-sm text-muted-foreground font-medium">
                              {bearingLabel(field.value as number)} — traffic heading {field.value}°
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">Direction of traffic this camera enforces. Leave blank for omnidirectional cameras.</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <DialogFooter className="pt-4">
                      <Button type="submit" disabled={createMutation.isPending} className="w-full">
                        {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {createMutation.isPending ? "Saving..." : "Save Zone"}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 bg-muted/20 p-3 rounded-lg border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or road..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-background"
              data-testid="input-search"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[160px] bg-background" data-testid="select-type">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.keys(TYPE_COLORS).map(type => (
                <SelectItem key={type} value={type} className="capitalize">{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[160px] bg-background" data-testid="select-status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {Object.keys(STATUS_COLORS).map(status => (
                <SelectItem key={status} value={status} className="capitalize">{status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {viewMode === "map" ? (
          isLoading ? (
            <div className="border rounded-xl bg-muted/10 h-[550px] flex items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading map data...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground font-medium">Creation mode:</span>
                  <div className="flex bg-muted/50 p-1 rounded-lg">
                    <Button
                      variant={creationMode === "point" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 gap-1.5 px-2.5 shadow-none text-xs"
                      onClick={() => { setCreationMode("point"); setPendingCoords(null); }}
                    >
                      <MapPin className="h-3 w-3" /> Point
                    </Button>
                    <Button
                      variant={creationMode === "stretch" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 gap-1.5 px-2.5 shadow-none text-xs"
                      onClick={() => { setCreationMode("stretch"); setPendingCoords(null); }}
                    >
                      <Gauge className="h-3 w-3" /> Stretch
                    </Button>
                  </div>
                </div>
                <span className="text-muted-foreground">
                  {creationMode === "point"
                    ? "Tip: Click map to place a single camera/zone."
                    : pendingCoords?.mode === "stretch" && pendingCoords.endLat == null
                      ? "Start point set — click again to set the end point."
                      : "Tip: Click to set start point, then click again for end point."}
                </span>
              </div>
              <div className="relative rounded-xl overflow-hidden border shadow-sm">
                {isSnapping && (
                  <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-background/60 backdrop-blur-sm">
                    <div className="flex items-center gap-2 rounded-lg bg-card border px-4 py-2 shadow-lg text-sm font-medium">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      Snapping to nearest road…
                    </div>
                  </div>
                )}
                <SpeedZonesMap
                  zones={data?.zones ?? []}
                  onEdit={openEditDialog}
                  onDelete={(id) => setZoneToDelete(id)}
                  onMapClick={handleMapClick}
                  pendingCoords={pendingCoords}
                />
              </div>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="w-[120px]">Type</TableHead>
                    <TableHead>Zone Name / Road</TableHead>
                    <TableHead className="w-[100px]">Mode</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[120px]">Speed Limit</TableHead>
                    <TableHead className="w-[150px]">Created</TableHead>
                    <TableHead className="w-[70px] text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-48 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />
                        Loading speed zones...
                      </TableCell>
                    </TableRow>
                  ) : data?.zones.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-48 text-center">
                        <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-20" />
                        <p className="text-muted-foreground font-medium">No speed zones found</p>
                        <p className="text-sm text-muted-foreground/70 mt-1">Try adjusting your search or filters.</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.zones.map((zone) => (
                      <TableRow key={zone.id} className="hover:bg-muted/30 transition-colors group" data-testid={`row-zone-${zone.id}`}>
                        <TableCell>
                          <Badge variant="outline" className={`capitalize font-medium shadow-none ${TYPE_COLORS[zone.type] || "bg-secondary text-secondary-foreground"}`}>
                            {zone.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-start gap-2.5">
                            {zone.mode === "stretch" ? (
                              <Gauge className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                            ) : (
                              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                            )}
                            <div>
                              <div className="font-medium text-sm text-foreground">{zone.name}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {zone.road || "Unknown Road"}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground capitalize">{zone.mode}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`capitalize shadow-none ${STATUS_COLORS[zone.status] || "bg-secondary"}`}>
                            {zone.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {zone.speedLimit != null ? <span className="font-medium text-foreground">{zone.speedLimit} km/h</span> : <span>—</span>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {format(new Date(zone.createdAt), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => openEditDialog(zone)} className="cursor-pointer">
                                <Edit className="mr-2 h-4 w-4" />
                                Edit Details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => verifyMutation.mutate({ id: zone.id })}
                                disabled={zone.verified || verifyMutation.isPending}
                                className="cursor-pointer text-emerald-700 focus:text-emerald-700"
                              >
                                <ShieldCheck className="mr-2 h-4 w-4" />
                                {zone.verified ? "Already Verified" : "Mark as Verified"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => removeMutation.mutate({ id: zone.id })}
                                disabled={zone.status === "inactive" || removeMutation.isPending}
                                className="cursor-pointer text-amber-700 focus:text-amber-700"
                              >
                                <EyeOff className="mr-2 h-4 w-4" />
                                {zone.status === "inactive" ? "Already Deactivated" : "Deactivate Zone"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                onClick={() => setZoneToDelete(zone.id)} 
                                className="text-destructive focus:text-destructive cursor-pointer"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Zone
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {data && data.total > data.limit && (
              <div className="flex items-center justify-between px-2">
                <span className="text-sm text-muted-foreground">
                  Showing <span className="font-medium text-foreground">{(page - 1) * data.limit + 1}</span> to <span className="font-medium text-foreground">{Math.min(page * data.limit, data.total)}</span> of <span className="font-medium text-foreground">{data.total}</span> entries
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shadow-none"
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                    data-testid="btn-prev-page"
                  >
                    <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shadow-none"
                    disabled={page * data.limit >= data.total}
                    onClick={() => setPage(p => p + 1)}
                    data-testid="btn-next-page"
                  >
                    Next <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!editingZone} onOpenChange={(open) => !open && setEditingZone(null)}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Edit Speed Zone</DialogTitle>
            <DialogDescription>Update details for {editingZone?.name}.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 pt-4">
              <FormField control={editForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {Object.keys(TYPE_COLORS).map(type => (
                            <SelectItem key={type} value={type} className="capitalize">{type}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="mode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mode (Cannot change)</FormLabel>
                      <Select disabled onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="point" className="capitalize">Point</SelectItem>
                          <SelectItem value="stretch" className="capitalize">Stretch</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {editForm.watch("mode") === "point" ? (
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={editForm.control} name="lat" render={({ field }) => (
                    <FormItem><FormLabel>Latitude</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                  )} />
                  <FormField control={editForm.control} name="lng" render={({ field }) => (
                    <FormItem><FormLabel>Longitude</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                  )} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={editForm.control} name="startLat" render={({ field }) => (
                    <FormItem><FormLabel>Start Lat</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                  )} />
                  <FormField control={editForm.control} name="startLng" render={({ field }) => (
                    <FormItem><FormLabel>Start Lng</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                  )} />
                  <FormField control={editForm.control} name="endLat" render={({ field }) => (
                    <FormItem><FormLabel>End Lat</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                  )} />
                  <FormField control={editForm.control} name="endLng" render={({ field }) => (
                    <FormItem><FormLabel>End Lng</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                  )} />
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-2 text-xs"
                disabled={isSnapping}
                onClick={handleSnapEdit}
              >
                {isSnapping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation2 className="h-3.5 w-3.5" />}
                {isSnapping ? "Snapping to road..." : "Snap to Road"}
              </Button>
              <FormField control={editForm.control} name="road" render={({ field }) => (
                <FormItem><FormLabel>Road Name</FormLabel><FormControl><Input value={field.value || ''} onChange={field.onChange} /></FormControl></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={editForm.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.keys(STATUS_COLORS).map(status => (
                          <SelectItem key={status} value={status} className="capitalize">{status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="speedLimit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Speed Limit (km/h)</FormLabel>
                    <FormControl><Input type="number" min={0} value={field.value ?? ''} onChange={field.onChange} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={editForm.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Input value={field.value || ''} onChange={field.onChange} /></FormControl></FormItem>
              )} />
              <FormField control={editForm.control} name="bearing" render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Camera bearing (0–359°){" "}
                    <span className="text-muted-foreground font-normal">— optional</span>
                  </FormLabel>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={359}
                        placeholder="e.g. 90"
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        className="w-28"
                      />
                    </FormControl>
                    {field.value != null && (
                      <span className="text-sm text-muted-foreground font-medium">
                        {bearingLabel(field.value as number)} — traffic heading {field.value}°
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Direction of traffic this camera enforces. Leave blank for omnidirectional cameras.</p>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="pt-4">
                <Button type="submit" disabled={updateMutation.isPending} className="w-full">
                  {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!zoneToDelete} onOpenChange={(open) => !open && setZoneToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Speed Zone</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this speed zone? It will be removed from the map for all drivers immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
