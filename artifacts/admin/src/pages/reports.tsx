import { useState, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useAdminListReports, useAdminDeleteReport, useAdminCreateReport, useAdminUpdateReport, useAdminBulkReports, useAdminImportReports, useAdminListBlockedDevices, useAdminBlockDevice, useAdminUnblockDevice } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Edit, AlertCircle, MapPin, Search, Plus, Map, List, Loader2, ArrowLeft, ArrowRight, MoreHorizontal, CheckCircle2, XCircle, Download, Upload, ShieldOff, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import type { AdminReport } from "@workspace/api-client-react";
import { ReportsMap } from "@/components/reports-map";
import { getToken } from "@/lib/auth";

const TYPE_COLORS: Record<string, string> = {
  camera:    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20",
  police:    "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20",
  alcoblow:  "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20",
  accident:  "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
  traffic:   "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20",
  roadblock: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20",
  roadworks: "bg-lime-50 text-lime-700 border-lime-200 dark:bg-lime-600/10 dark:text-lime-500 dark:border-lime-600/20",
  hazard:    "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20",
  pothole:   "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  debris:    "bg-stone-50 text-stone-700 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/20",
  breakdown: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20",
  weather:   "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20",
  closure:   "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-500/10 dark:text-pink-400 dark:border-pink-500/20",
  clear:     "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  active:    "bg-primary/10 text-primary border-primary/20",
  confirmed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  expired:   "bg-muted text-muted-foreground border-muted-foreground/20",
  denied:    "bg-destructive/10 text-destructive border-destructive/20",
  flagged:   "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
};

const reportSchema = z.object({
  type:       z.string().min(1, "Type is required"),
  lat:        z.coerce.number().min(-90).max(90),
  lng:        z.coerce.number().min(-180).max(180),
  status:     z.string().min(1, "Status is required"),
  roadName:   z.string().optional().nullable(),
  speedLimit: z.coerce.number().optional().nullable(),
});

function handleExportCsv(type?: string, status?: string) {
  const token = getToken();
  const params = new URLSearchParams();
  if (type)   params.set("type", type);
  if (status) params.set("status", status);
  const url = `/api/admin/reports/export${params.size ? "?" + params.toString() : ""}`;
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.blob())
    .then((blob) => {
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.setAttribute("download", "reports.csv");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

export default function Reports() {
  const rawSearch = useSearch();
  const deepLinkParams = new URLSearchParams(rawSearch);
  const highlightId = deepLinkParams.get("highlight");

  const [page, setPage] = useState(1);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(deepLinkParams.get("q") ?? "");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "map">("table");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const [reportToDelete, setReportToDelete] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<AdminReport | null>(null);
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [deviceToBlock, setDeviceToBlock] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [blockedDevicesOpen, setBlockedDevicesOpen] = useState(false);

  const [locationQuery, setLocationQuery] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<Array<{ name: string; lat: number; lng: number }>>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!locationQuery.trim() || locationQuery.length < 3) {
      setLocationSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      setLocationLoading(true);
      try {
        const resp = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(locationQuery)}&limit=6&bbox=33.9,-4.7,41.9,4.6&lang=en`
        );
        const data = await resp.json();
        const results = (data.features || []).map((f: { properties: Record<string, string>; geometry: { coordinates: [number, number] } }) => {
          const p = f.properties;
          const parts = [p.name, p.street, p.district, p.city, p.county].filter(Boolean);
          const deduped = [...new Set(parts)];
          return {
            name: deduped.slice(0, 3).join(", "),
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
          };
        });
        setLocationSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch {
        setLocationSuggestions([]);
      } finally {
        setLocationLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [locationQuery]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectSuggestion = (s: { name: string; lat: number; lng: number }) => {
    createForm.setValue("lat", s.lat);
    createForm.setValue("lng", s.lng);
    createForm.setValue("roadName", s.name);
    setLocationQuery(s.name);
    setShowSuggestions(false);
  };

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useAdminListReports(
    {
      page,
      limit: viewMode === "map" ? 500 : 20,
      search: search || undefined,
      type:   typeFilter !== "all" ? typeFilter : undefined,
      status: statusFilter !== "all" ? statusFilter : undefined,
    },
    // Poll every 30 s so vote-driven status changes (confirmed / denied / flagged)
    // from mobile users appear without the admin having to manually refresh.
    // Cast: orval requires the full UseQueryOptions shape but merges queryKey
    // internally — only refetchInterval is needed here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { refetchInterval: 30_000 } as any },
  );

  const deleteMutation = useAdminDeleteReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Incident removed", description: "The report has been permanently deleted." });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
        setReportToDelete(null);
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to remove the report.", variant: "destructive" });
        setReportToDelete(null);
      }
    }
  });

  const bulkMutation = useAdminBulkReports({
    mutation: {
      onSuccess: (result, vars) => {
        const action = (vars.data as any).action;
        const label = action === "delete" ? "deleted" : action === "confirm" ? "confirmed" : "denied";
        toast({ title: `Bulk action complete`, description: `${result.affected} report${result.affected !== 1 ? "s" : ""} ${label}.` });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
        setSelectedIds(new Set());
        setBulkDeleteOpen(false);
      },
      onError: () => {
        toast({ title: "Bulk action failed", variant: "destructive" });
        setBulkDeleteOpen(false);
      },
    },
  });

  const createMutation = useAdminCreateReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Incident created", description: "New report has been added to the system." });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
        setIsAddOpen(false);
        setPendingCoords(null);
        createForm.reset();
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to log report.", variant: "destructive" });
      }
    }
  });

  const updateMutation = useAdminUpdateReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Incident updated", description: "Report details have been saved." });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
        setEditingReport(null);
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to update report.", variant: "destructive" });
      }
    }
  });

  const importMutation = useAdminImportReports({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
        const parts = [`${result.created} created`, `${result.updated} restored/updated`];
        if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
        toast({
          title: "CSV import complete",
          description: parts.join(", ") + ".",
          variant: result.skipped > 0 && result.created + result.updated === 0 ? "destructive" : "default",
        });
        if (result.errors.length > 0) {
          console.warn("CSV import row errors:", result.errors);
        }
      },
      onError: () => {
        toast({ title: "Import failed", description: "Could not process the CSV file.", variant: "destructive" });
      }
    }
  });

  const { data: blockedData } = useAdminListBlockedDevices({
    query: { queryKey: ["/api/admin/reports/blocked-devices"] },
  });
  const blockedDeviceIds = new Set((blockedData?.devices ?? []).map((d) => d.deviceId));

  const blockMutation = useAdminBlockDevice({
    mutation: {
      onSuccess: (result) => {
        toast({ title: "Device blocked", description: `${result.deviceId.slice(0, 12)}… can no longer submit or vote on reports.` });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/blocked-devices"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/moderation-queue"] });
        setDeviceToBlock(null);
        setBlockReason("");
      },
      onError: () => toast({ title: "Failed to block device", variant: "destructive" }),
    },
  });

  const unblockMutation = useAdminUnblockDevice({
    mutation: {
      onSuccess: () => {
        toast({ title: "Device unblocked" });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/blocked-devices"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/moderation-queue"] });
      },
      onError: () => toast({ title: "Failed to unblock device", variant: "destructive" }),
    },
  });

  const createForm = useForm<z.infer<typeof reportSchema>>({
    resolver: zodResolver(reportSchema),
    defaultValues: { type: "hazard", lat: 0, lng: 0, status: "active", roadName: "", speedLimit: 0 },
  });

  const editForm = useForm<z.infer<typeof reportSchema>>({ resolver: zodResolver(reportSchema) });

  const handleDelete = () => {
    if (reportToDelete) deleteMutation.mutate({ id: reportToDelete });
  };

  const onCreateSubmit = (values: z.infer<typeof reportSchema>) => {
    createMutation.mutate({ data: { ...values, deviceId: "admin-console" } });
  };

  const onEditSubmit = (values: z.infer<typeof reportSchema>) => {
    if (editingReport) updateMutation.mutate({ id: editingReport.id, data: values });
  };

  const openEditDialog = (report: AdminReport) => {
    editForm.reset({ type: report.type, lat: report.lat, lng: report.lng, status: report.status, roadName: report.roadName || "", speedLimit: report.speedLimit || 0 });
    setEditingReport(report);
  };

  // Deep-link support from global search: ?highlight=<id> opens that report's
  // edit dialog as soon as it shows up in the (search-filtered) list.
  const highlightHandled = useRef(false);
  useEffect(() => {
    if (!highlightId || highlightHandled.current) return;
    const match = data?.reports.find((r) => r.id === highlightId);
    if (match) {
      openEditDialog(match);
      highlightHandled.current = true;
    }
  }, [highlightId, data]);

  const handleMapClick = (lat: number, lng: number) => {
    setPendingCoords({ lat, lng });
    createForm.reset({ type: "hazard", lat, lng, status: "active", roadName: "", speedLimit: 0 });
    setIsAddOpen(true);
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      toast({ title: "Invalid file", description: "Please select a .csv file.", variant: "destructive" });
      return;
    }

    try {
      const csv = await readFileAsText(file);
      importMutation.mutate({ data: { csv } });
    } catch {
      toast({ title: "Could not read file", variant: "destructive" });
    }
  };

  const reports = data?.reports ?? [];
  const allOnPageSelected = reports.length > 0 && reports.every((r) => selectedIds.has(r.id));

  const toggleAll = () => {
    if (allOnPageSelected) {
      setSelectedIds((prev) => { const next = new Set(prev); reports.forEach((r) => next.delete(r.id)); return next; });
    } else {
      setSelectedIds((prev) => { const next = new Set(prev); reports.forEach((r) => next.add(r.id)); return next; });
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const doBulk = (action: "confirm" | "deny" | "delete") => {
    bulkMutation.mutate({ data: { action, ids: [...selectedIds] } });
  };

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-page-title">Incident Reports</h1>
            <p className="text-muted-foreground mt-1" data-testid="text-page-description">View and manage active incidents across the network.</p>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleImportFileChange}
              data-testid="input-import-csv"
            />
            <Button
              variant="outline"
              className="gap-2 shadow-none"
              disabled={importMutation.isPending}
              onClick={handleImportClick}
              data-testid="btn-import-csv"
            >
              {importMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Import CSV
            </Button>
            <Button
              variant="outline"
              className="gap-2 shadow-none"
              onClick={() => handleExportCsv(
                typeFilter !== "all" ? typeFilter : undefined,
                statusFilter !== "all" ? statusFilter : undefined,
              )}
              data-testid="btn-export-csv"
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button
              variant="outline"
              className="gap-2 shadow-none"
              onClick={() => setBlockedDevicesOpen(true)}
              data-testid="btn-blocked-devices"
            >
              <ShieldOff className="h-4 w-4" /> Blocked Devices
              {blockedDeviceIds.size > 0 && <Badge className="ml-1">{blockedDeviceIds.size}</Badge>}
            </Button>

            <div className="flex bg-muted/50 p-1 rounded-lg">
              <Button variant={viewMode === "table" ? "secondary" : "ghost"} size="sm" className="h-8 gap-2 px-3 shadow-none" onClick={() => setViewMode("table")} data-testid="btn-view-table">
                <List className="h-4 w-4" /> Table
              </Button>
              <Button variant={viewMode === "map" ? "secondary" : "ghost"} size="sm" className="h-8 gap-2 px-3 shadow-none" onClick={() => setViewMode("map")} data-testid="btn-view-map">
                <Map className="h-4 w-4" /> Map
              </Button>
            </div>

            <Dialog open={isAddOpen} onOpenChange={(open) => {
              setIsAddOpen(open);
              if (!open) {
                setPendingCoords(null);
                setLocationQuery("");
                setLocationSuggestions([]);
                setShowSuggestions(false);
              }
            }}>
              <DialogTrigger asChild>
                <Button className="gap-2" data-testid="btn-add-report"><Plus className="h-4 w-4" /> Add Incident</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                  <DialogTitle>Log New Incident</DialogTitle>
                  <DialogDescription>Search for a road, area, or landmark to place the incident.</DialogDescription>
                </DialogHeader>
                <Form {...createForm}>
                  <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4 pt-2">

                    {/* Location search */}
                    <div ref={searchRef} className="relative">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        {locationLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
                        <Input
                          placeholder="Search road, street, area, landmark…"
                          value={locationQuery}
                          onChange={(e) => setLocationQuery(e.target.value)}
                          onFocus={() => locationSuggestions.length > 0 && setShowSuggestions(true)}
                          className="pl-9 pr-9"
                          autoComplete="off"
                        />
                      </div>
                      {showSuggestions && locationSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-xl z-[9999] overflow-hidden">
                          {locationSuggestions.map((s, i) => (
                            <button
                              key={i}
                              type="button"
                              className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors text-left border-b border-border/40 last:border-0"
                              onClick={() => selectSuggestion(s)}
                            >
                              <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                              <div>
                                <div className="text-sm font-medium text-foreground leading-tight">{s.name}</div>
                                <div className="text-xs text-muted-foreground font-mono mt-0.5">{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Coords preview — shown once a location is picked or coords already set from map click */}
                    {(createForm.watch("lat") !== 0 || createForm.watch("lng") !== 0) && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg text-sm">
                        <MapPin className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-foreground font-medium truncate">{createForm.watch("roadName") || "Selected location"}</span>
                        <span className="font-mono text-muted-foreground text-xs ml-auto shrink-0">
                          {(createForm.watch("lat") as number).toFixed(5)}, {(createForm.watch("lng") as number).toFixed(5)}
                        </span>
                      </div>
                    )}

                    {/* Manual lat/lng — always available for precise edits */}
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={createForm.control} name="lat" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">Latitude</FormLabel>
                          <FormControl><Input type="number" step="any" className="font-mono text-sm" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={createForm.control} name="lng" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-muted-foreground">Longitude</FormLabel>
                          <FormControl><Input type="number" step="any" className="font-mono text-sm" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={createForm.control} name="type" render={({ field }) => (
                        <FormItem><FormLabel>Incident Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent className="z-[99999]">{Object.keys(TYPE_COLORS).map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                      <FormField control={createForm.control} name="status" render={({ field }) => (
                        <FormItem><FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent className="z-[99999]">{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={createForm.control} name="roadName" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Road / Location Name</FormLabel>
                          <FormControl><Input value={field.value || ""} onChange={field.onChange} placeholder="Auto-filled from search" /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={createForm.control} name="speedLimit" render={({ field }) => (
                        <FormItem><FormLabel>Speed Limit (km/h)</FormLabel><FormControl><Input type="number" min={0} placeholder="e.g. 50" value={field.value ?? ""} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>

                    <DialogFooter className="pt-2">
                      <Button type="submit" disabled={createMutation.isPending} className="w-full">
                        {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {createMutation.isPending ? "Saving..." : "Save Incident"}
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
            <Input placeholder="Search by road name..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-background" data-testid="input-search" />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[160px] bg-background" data-testid="select-type"><SelectValue placeholder="All Types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.keys(TYPE_COLORS).map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[160px] bg-background" data-testid="select-status"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Bulk action toolbar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
            <span className="text-sm font-medium text-foreground">{selectedIds.size} selected</span>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                size="sm"
                variant="outline"
                className="gap-2 h-8 shadow-none border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
                disabled={bulkMutation.isPending}
                onClick={() => doBulk("confirm")}
              >
                {bulkMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Confirm All
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2 h-8 shadow-none border-amber-500/30 text-amber-600 hover:bg-amber-500/10 hover:text-amber-600"
                disabled={bulkMutation.isPending}
                onClick={() => doBulk("deny")}
              >
                {bulkMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                Deny All
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2 h-8 shadow-none border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={bulkMutation.isPending}
                onClick={() => setBulkDeleteOpen(true)}
              >
                {bulkMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete All
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {viewMode === "map" ? (
          isLoading ? (
            <div className="border rounded-xl bg-muted/10 h-[550px] flex items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading map data...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                {data && data.reports.length > 0 && (
                  <span className="text-muted-foreground">Displaying {data.reports.length} of {data.total} incidents</span>
                )}
                <span className="text-muted-foreground ml-auto">Tip: Click anywhere on the map to add an incident.</span>
              </div>
              <div className="rounded-xl overflow-hidden border shadow-sm">
                <ReportsMap reports={data?.reports ?? []} onEdit={openEditDialog} onDelete={(id) => setReportToDelete(id)} onMapClick={handleMapClick} pendingCoords={pendingCoords} />
              </div>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="w-[44px]">
                      <Checkbox
                        checked={allOnPageSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead className="w-[120px]">Type</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="w-[120px]">Speed Limit</TableHead>
                    <TableHead className="w-[120px]">Confidence</TableHead>
                    <TableHead className="w-[150px]">Reported</TableHead>
                    <TableHead className="w-[70px] text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-48 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />
                        Loading reports...
                      </TableCell>
                    </TableRow>
                  ) : data?.reports.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-48 text-center">
                        <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-20" />
                        <p className="text-muted-foreground font-medium">No incidents found</p>
                        <p className="text-sm text-muted-foreground/70 mt-1">Try adjusting your search or filters.</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.reports.map((report) => (
                      <TableRow key={report.id} className="hover:bg-muted/30 transition-colors group" data-testid={`row-report-${report.id}`}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(report.id)}
                            onCheckedChange={() => toggleOne(report.id)}
                            aria-label={`Select ${report.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className={`capitalize font-medium shadow-none ${TYPE_COLORS[report.type] || "bg-secondary text-secondary-foreground"}`}>
                              {report.type}
                            </Badge>
                            {report.deviceBlocked && (
                              <Badge variant="outline" className="gap-1 shadow-none border-destructive/30 text-destructive bg-destructive/10" title="Reporting device is blocked">
                                <ShieldAlert className="h-3 w-3" /> Blocked
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-start gap-2.5">
                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                            <div>
                              <div className="font-medium text-sm text-foreground">{report.roadName || "Unknown Sector"}</div>
                              <div className="text-xs text-muted-foreground mt-0.5 font-mono">{report.lat.toFixed(5)}, {report.lng.toFixed(5)}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`capitalize shadow-none ${STATUS_COLORS[report.status] || "bg-secondary"}`}>
                            {report.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {report.speedLimit != null ? <span className="font-medium text-foreground">{report.speedLimit} km/h</span> : <span>—</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            <span className="text-emerald-600 dark:text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 rounded">{report.confirmCount}</span>
                            <span className="text-muted-foreground/30">/</span>
                            <span className="text-destructive bg-destructive/10 px-1.5 rounded">{report.denyCount}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {format(new Date(report.createdAt), "MMM d, HH:mm")}
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
                              <DropdownMenuItem onClick={() => openEditDialog(report)} className="cursor-pointer">
                                <Edit className="mr-2 h-4 w-4" /> Edit Details
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {report.deviceBlocked ? (
                                <DropdownMenuItem
                                  onClick={() => unblockMutation.mutate({ deviceId: report.deviceId })}
                                  className="cursor-pointer"
                                  data-testid={`btn-unblock-device-${report.id}`}
                                >
                                  <ShieldOff className="mr-2 h-4 w-4" /> Unblock Device
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() => { setDeviceToBlock(report.deviceId); setBlockReason(""); }}
                                  className="cursor-pointer"
                                  data-testid={`btn-block-device-${report.id}`}
                                >
                                  <ShieldOff className="mr-2 h-4 w-4" /> Block Device
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setReportToDelete(report.id)} className="text-destructive focus:text-destructive cursor-pointer">
                                <Trash2 className="mr-2 h-4 w-4" /> Delete Incident
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
                  Showing <span className="font-medium text-foreground">{(page - 1) * data.limit + 1}</span> to{" "}
                  <span className="font-medium text-foreground">{Math.min(page * data.limit, data.total)}</span> of{" "}
                  <span className="font-medium text-foreground">{data.total}</span> entries
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 shadow-none" disabled={page === 1} onClick={() => setPage((p) => p - 1)} data-testid="btn-prev-page">
                    <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Previous
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 shadow-none" disabled={page * data.limit >= data.total} onClick={() => setPage((p) => p + 1)} data-testid="btn-next-page">
                    Next <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingReport} onOpenChange={(open) => !open && setEditingReport(null)}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Edit Incident</DialogTitle>
            <DialogDescription>Modify details for this report.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={editForm.control} name="type" render={({ field }) => (
                  <FormItem><FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent className="z-[99999]">{Object.keys(TYPE_COLORS).map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <FormField control={editForm.control} name="status" render={({ field }) => (
                  <FormItem><FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent className="z-[99999]">{Object.keys(STATUS_COLORS).map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <FormField control={editForm.control} name="lat" render={({ field }) => (
                  <FormItem><FormLabel>Latitude</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={editForm.control} name="lng" render={({ field }) => (
                  <FormItem><FormLabel>Longitude</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl></FormItem>
                )} />
              </div>
              <FormField control={editForm.control} name="roadName" render={({ field }) => (
                <FormItem><FormLabel>Road Name</FormLabel><FormControl><Input value={field.value || ""} onChange={field.onChange} /></FormControl></FormItem>
              )} />
              <FormField control={editForm.control} name="speedLimit" render={({ field }) => (
                <FormItem><FormLabel>Speed Limit (km/h)</FormLabel><FormControl><Input type="number" min={0} value={field.value ?? ""} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
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

      {/* Delete single */}
      <AlertDialog open={!!reportToDelete} onOpenChange={(open) => !open && setReportToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Incident</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the report. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Block device */}
      <Dialog open={!!deviceToBlock} onOpenChange={(open) => { if (!open) { setDeviceToBlock(null); setBlockReason(""); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Block Device</DialogTitle>
            <DialogDescription>
              This device will no longer be able to submit new reports or vote (confirm/deny) on existing ones. You can unblock it later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="text-sm font-mono bg-muted/40 px-3 py-2 rounded-md break-all">{deviceToBlock}</div>
            <div>
              <label className="text-sm font-medium">Reason (optional)</label>
              <Textarea
                className="mt-1.5"
                placeholder="e.g. Repeated spam/fake reports"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                data-testid="input-block-reason"
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button
              variant="destructive"
              className="w-full gap-2"
              disabled={blockMutation.isPending}
              onClick={() => deviceToBlock && blockMutation.mutate({ data: { deviceId: deviceToBlock, reason: blockReason || undefined } })}
              data-testid="btn-confirm-block-device"
            >
              {blockMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
              Block Device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Blocked devices list */}
      <Dialog open={blockedDevicesOpen} onOpenChange={setBlockedDevicesOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Blocked Devices</DialogTitle>
            <DialogDescription>Devices currently blocked from submitting or voting on reports.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto space-y-2 pt-2">
            {(blockedData?.devices ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">No devices are currently blocked.</div>
            ) : (
              blockedData?.devices.map((d) => (
                <div key={d.deviceId} className="flex items-start justify-between gap-3 border rounded-lg px-3 py-2.5" data-testid={`row-blocked-device-${d.deviceId}`}>
                  <div className="min-w-0">
                    <div className="text-sm font-mono truncate">{d.deviceId}</div>
                    {d.reason && <div className="text-xs text-muted-foreground mt-1">{d.reason}</div>}
                    <div className="text-xs text-muted-foreground/70 mt-1">
                      Blocked by {d.blockedBy} · {format(new Date(d.createdAt), "MMM d, yyyy HH:mm")}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 h-8 shrink-0 shadow-none"
                    disabled={unblockMutation.isPending}
                    onClick={() => unblockMutation.mutate({ deviceId: d.deviceId })}
                    data-testid={`btn-unblock-${d.deviceId}`}
                  >
                    <ShieldOff className="h-3.5 w-3.5" /> Unblock
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirm */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Report{selectedIds.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the selected incidents. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => doBulk("delete")} disabled={bulkMutation.isPending}>
              {bulkMutation.isPending ? "Deleting..." : `Delete ${selectedIds.size} Reports`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
