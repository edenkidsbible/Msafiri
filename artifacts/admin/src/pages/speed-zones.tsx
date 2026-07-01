import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import {
  useAdminListSpeedZones,
  useAdminDeleteSpeedZone,
  useAdminCreateSpeedZone,
  useAdminUpdateSpeedZone,
  getAdminListSpeedZonesQueryKey,
} from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Edit, AlertCircle, MapPin, Search, Plus, Map, List, Gauge } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import type { AdminSpeedZone } from "@workspace/api-client-react";
import { SpeedZonesMap, type PendingZoneCoords } from "@/components/speed-zones-map";

const TYPE_COLORS: Record<string, string> = {
  camera: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  police: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  zone:   "bg-orange-500/10 text-orange-500 border-orange-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  active:   "bg-primary/20 text-primary border-primary/30",
  inactive: "bg-muted text-muted-foreground border-muted-foreground/30",
};

const zoneSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
  mode: z.enum(["point", "stretch"]),
  status: z.string().min(1),
  road: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  speedLimit: z.coerce.number().optional().nullable(),
  lat: z.coerce.number().optional().nullable(),
  lng: z.coerce.number().optional().nullable(),
  startLat: z.coerce.number().optional().nullable(),
  startLng: z.coerce.number().optional().nullable(),
  endLat: z.coerce.number().optional().nullable(),
  endLng: z.coerce.number().optional().nullable(),
});

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
        toast({ title: "Speed Zone Removed", description: "The speed zone has been permanently removed." });
        invalidate();
        setZoneToDelete(null);
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to remove the speed zone.", variant: "destructive" });
        setZoneToDelete(null);
      }
    }
  });

  const createMutation = useAdminCreateSpeedZone({
    mutation: {
      onSuccess: () => {
        toast({ title: "Speed Zone Created", description: "New speed zone has been added." });
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
        toast({ title: "Speed Zone Updated", description: "Speed zone updated." });
        invalidate();
        setEditingZone(null);
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to update speed zone.", variant: "destructive" });
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
      lat: zone.lat ?? 0,
      lng: zone.lng ?? 0,
      startLat: zone.startLat ?? 0,
      startLng: zone.startLng ?? 0,
      endLat: zone.endLat ?? 0,
      endLng: zone.endLng ?? 0,
    });
    setEditingZone(zone);
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (creationMode === "point") {
      setPendingCoords({ mode: "point", lat, lng });
      createForm.reset({ ...defaultValues, mode: "point", lat, lng });
      setIsAddOpen(true);
      return;
    }

    // stretch mode: first click sets start, second click sets end and opens dialog
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

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight uppercase font-mono">Speed Zones</h1>
            <p className="text-muted-foreground mt-1">Fixed speed cameras, checkpoints, and enforced speed stretches.</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center border border-border rounded-md overflow-hidden">
              <Button
                variant="ghost"
                size="sm"
                className={`rounded-none gap-2 font-mono uppercase tracking-wider text-xs px-3 h-9 ${viewMode === "table" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                onClick={() => setViewMode("table")}
              >
                <List className="h-4 w-4" /> Table
              </Button>
              <div className="w-px h-6 bg-border" />
              <Button
                variant="ghost"
                size="sm"
                className={`rounded-none gap-2 font-mono uppercase tracking-wider text-xs px-3 h-9 ${viewMode === "map" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                onClick={() => setViewMode("map")}
              >
                <Map className="h-4 w-4" /> Map
              </Button>
            </div>

            <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) setPendingCoords(null); }}>
              <DialogTrigger asChild>
                <Button
                  className="gap-2 font-mono uppercase tracking-wider"
                  onClick={() => {
                    setPendingCoords(null);
                    createForm.reset(defaultValues);
                  }}
                >
                  <Plus className="h-4 w-4" /> Add Speed Zone
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle className="uppercase font-mono tracking-wider">Add Speed Zone</DialogTitle>
                  <DialogDescription className="sr-only">Fill in the form to add a new speed zone.</DialogDescription>
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
                    <FormField control={createForm.control} name="road" render={({ field }) => (
                      <FormItem><FormLabel>Road Name</FormLabel><FormControl><Input value={field.value || ''} onChange={field.onChange} /></FormControl></FormItem>
                    )} />
                    <FormField control={createForm.control} name="speedLimit" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Speed Limit (km/h)</FormLabel>
                        <FormControl><Input type="number" min={0} placeholder="e.g. 50" value={field.value ?? ''} onChange={field.onChange} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={createForm.control} name="description" render={({ field }) => (
                      <FormItem><FormLabel>Description</FormLabel><FormControl><Input value={field.value || ''} onChange={field.onChange} /></FormControl></FormItem>
                    )} />
                    <DialogFooter className="pt-4">
                      <Button type="submit" disabled={createMutation.isPending} className="font-mono uppercase w-full">
                        {createMutation.isPending ? "Saving..." : "Save Speed Zone"}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or road..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card/50"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px] bg-card/50">
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
            <SelectTrigger className="w-[180px] bg-card/50">
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
            <div className="border border-border/50 rounded-md bg-card/30 h-[520px] flex items-center justify-center text-muted-foreground">
              Loading speed zones...
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 -mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono uppercase">Click mode:</span>
                  <div className="flex items-center border border-border rounded-md overflow-hidden">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`rounded-none gap-1 font-mono uppercase tracking-wider text-xs px-3 h-7 ${creationMode === "point" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                      onClick={() => { setCreationMode("point"); setPendingCoords(null); }}
                    >
                      <MapPin className="h-3 w-3" /> Point
                    </Button>
                    <div className="w-px h-5 bg-border" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`rounded-none gap-1 font-mono uppercase tracking-wider text-xs px-3 h-7 ${creationMode === "stretch" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                      onClick={() => { setCreationMode("stretch"); setPendingCoords(null); }}
                    >
                      <Gauge className="h-3 w-3" /> Stretch
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  {creationMode === "point"
                    ? "Click anywhere on the map to add a point zone."
                    : pendingCoords?.mode === "stretch" && pendingCoords.endLat == null
                      ? "Start point set — click again to set the end point."
                      : "Click to set the start point, then click again for the end point."}
                </p>
              </div>
              <SpeedZonesMap
                zones={data?.zones ?? []}
                onEdit={openEditDialog}
                onDelete={(id) => setZoneToDelete(id)}
                onMapClick={handleMapClick}
                pendingCoords={pendingCoords}
              />
            </>
          )
        ) : (
          <>
            <div className="border border-border/50 rounded-md bg-card/30 overflow-hidden">
              <Table>
                <TableHeader className="bg-secondary/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-mono text-xs uppercase tracking-wider">Type</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-wider">Name / Road</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-wider">Mode</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-wider">Status</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-wider">Speed Limit</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-wider">Created At</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                        Loading speed zones...
                      </TableCell>
                    </TableRow>
                  ) : data?.zones.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center">
                        <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2 opacity-50" />
                        <p className="text-muted-foreground">No speed zones found matching parameters.</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.zones.map((zone) => (
                      <TableRow key={zone.id} className="hover:bg-muted/50 transition-colors">
                        <TableCell>
                          <Badge variant="outline" className={`capitalize ${TYPE_COLORS[zone.type] || "bg-secondary text-secondary-foreground"}`}>
                            {zone.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                            <div>
                              <div className="font-medium text-sm">{zone.name}</div>
                              <div className="text-xs text-muted-foreground font-mono mt-0.5">
                                {zone.road || "Unknown Sector"}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-mono capitalize">{zone.mode}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`capitalize font-mono text-xs ${STATUS_COLORS[zone.status] || "bg-secondary"}`}>
                            {zone.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {zone.speedLimit != null ? `${zone.speedLimit} km/h` : <span className="text-muted-foreground/50">—</span>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(zone.createdAt), "MMM d, HH:mm")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(zone)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setZoneToDelete(zone.id)}
                            >
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

            {data && data.total > data.limit && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground font-mono">
                  Showing {(page - 1) * data.limit + 1}-{Math.min(page * data.limit, data.total)} of {data.total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page * data.limit >= data.total}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={!!editingZone} onOpenChange={(open) => !open && setEditingZone(null)}>
        <DialogContent className="bg-card border-border sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="uppercase font-mono tracking-wider">Edit Speed Zone</DialogTitle>
            <DialogDescription className="sr-only">Edit the selected speed zone.</DialogDescription>
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
                  name="status"
                  render={({ field }) => (
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
              <FormField control={editForm.control} name="road" render={({ field }) => (
                <FormItem><FormLabel>Road Name</FormLabel><FormControl><Input value={field.value || ''} onChange={field.onChange} /></FormControl></FormItem>
              )} />
              <FormField control={editForm.control} name="speedLimit" render={({ field }) => (
                <FormItem>
                  <FormLabel>Speed Limit (km/h)</FormLabel>
                  <FormControl><Input type="number" min={0} placeholder="e.g. 50" value={field.value ?? ''} onChange={field.onChange} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Input value={field.value || ''} onChange={field.onChange} /></FormControl></FormItem>
              )} />
              <DialogFooter className="pt-4">
                <Button type="submit" disabled={updateMutation.isPending} className="font-mono uppercase w-full">
                  {updateMutation.isPending ? "Updating..." : "Update Speed Zone"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!zoneToDelete} onOpenChange={(open) => !open && setZoneToDelete(null)}>
        <AlertDialogContent className="bg-card border-destructive/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this speed zone. This action cannot be reversed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Remove Zone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
