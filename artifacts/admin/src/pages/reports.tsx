import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useAdminListReports, useAdminDeleteReport, useAdminCreateReport, useAdminUpdateReport } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Edit, AlertCircle, MapPin, Search, Plus, Map, List, Loader2, ArrowLeft, ArrowRight, MoreHorizontal } from "lucide-react";
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
  active: "bg-primary/10 text-primary border-primary/20",
  confirmed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  expired: "bg-muted text-muted-foreground border-muted-foreground/20",
  denied: "bg-destructive/10 text-destructive border-destructive/20",
};

const reportSchema = z.object({
  type: z.string().min(1, "Type is required"),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  status: z.string().min(1, "Status is required"),
  roadName: z.string().optional().nullable(),
  speedLimit: z.coerce.number().optional().nullable(),
});

export default function Reports() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "map">("table");

  const [reportToDelete, setReportToDelete] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<AdminReport | null>(null);
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useAdminListReports({
    page,
    limit: viewMode === "map" ? 500 : 20,
    search: search || undefined,
    type: typeFilter !== "all" ? typeFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

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

  const createForm = useForm<z.infer<typeof reportSchema>>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      type: "hazard",
      lat: 0,
      lng: 0,
      status: "active",
      roadName: "",
      speedLimit: 0,
    },
  });

  const editForm = useForm<z.infer<typeof reportSchema>>({
    resolver: zodResolver(reportSchema),
  });

  const handleDelete = () => {
    if (reportToDelete) {
      deleteMutation.mutate({ id: reportToDelete });
    }
  };

  const onCreateSubmit = (values: z.infer<typeof reportSchema>) => {
    createMutation.mutate({ data: { ...values, deviceId: "admin-console" } });
  };

  const onEditSubmit = (values: z.infer<typeof reportSchema>) => {
    if (editingReport) {
      updateMutation.mutate({ id: editingReport.id, data: values });
    }
  };

  const openEditDialog = (report: AdminReport) => {
    editForm.reset({
      type: report.type,
      lat: report.lat,
      lng: report.lng,
      status: report.status,
      roadName: report.roadName || "",
      speedLimit: report.speedLimit || 0,
    });
    setEditingReport(report);
  };

  const handleMapClick = (lat: number, lng: number) => {
    setPendingCoords({ lat, lng });
    createForm.reset({
      type: "hazard",
      lat,
      lng,
      status: "active",
      roadName: "",
      speedLimit: 0,
    });
    setIsAddOpen(true);
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
                <Button className="gap-2" data-testid="btn-add-report">
                  <Plus className="h-4 w-4" /> Add Incident
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[450px]">
                <DialogHeader>
                  <DialogTitle>Log New Incident</DialogTitle>
                  <DialogDescription>Create a new incident report on the network.</DialogDescription>
                </DialogHeader>
                <Form {...createForm}>
                  <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4 pt-4">
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
                      <FormField control={createForm.control} name="lat" render={({ field }) => (
                        <FormItem><FormLabel>Latitude</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl></FormItem>
                      )} />
                      <FormField control={createForm.control} name="lng" render={({ field }) => (
                        <FormItem><FormLabel>Longitude</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl></FormItem>
                      )} />
                    </div>
                    <FormField control={createForm.control} name="roadName" render={({ field }) => (
                      <FormItem><FormLabel>Road Name</FormLabel><FormControl><Input value={field.value || ''} onChange={field.onChange} /></FormControl></FormItem>
                    )} />
                    <FormField control={createForm.control} name="speedLimit" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Speed Limit (km/h)</FormLabel>
                        <FormControl><Input type="number" min={0} placeholder="e.g. 50" value={field.value ?? ''} onChange={field.onChange} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <DialogFooter className="pt-4">
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
            <Input
              placeholder="Search by road name..."
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
              <div className="flex items-center justify-between text-sm">
                {data && data.reports.length > 0 && (
                  <span className="text-muted-foreground">
                    Displaying {data.reports.length} of {data.total} incidents
                  </span>
                )}
                <span className="text-muted-foreground ml-auto">
                  Tip: Click anywhere on the map to add an incident.
                </span>
              </div>
              <div className="rounded-xl overflow-hidden border shadow-sm">
                <ReportsMap
                  reports={data?.reports ?? []}
                  onEdit={openEditDialog}
                  onDelete={(id) => setReportToDelete(id)}
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
                      <TableCell colSpan={7} className="h-48 text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />
                        Loading reports...
                      </TableCell>
                    </TableRow>
                  ) : data?.reports.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-48 text-center">
                        <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-20" />
                        <p className="text-muted-foreground font-medium">No incidents found</p>
                        <p className="text-sm text-muted-foreground/70 mt-1">Try adjusting your search or filters.</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.reports.map((report) => (
                      <TableRow key={report.id} className="hover:bg-muted/30 transition-colors group" data-testid={`row-report-${report.id}`}>
                        <TableCell>
                          <Badge variant="outline" className={`capitalize font-medium shadow-none ${TYPE_COLORS[report.type] || "bg-secondary text-secondary-foreground"}`}>
                            {report.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-start gap-2.5">
                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                            <div>
                              <div className="font-medium text-sm text-foreground">{report.roadName || "Unknown Sector"}</div>
                              <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                                {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
                              </div>
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
                                <Edit className="mr-2 h-4 w-4" />
                                Edit Details
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                onClick={() => setReportToDelete(report.id)} 
                                className="text-destructive focus:text-destructive cursor-pointer"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Incident
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

      <Dialog open={!!editingReport} onOpenChange={(open) => !open && setEditingReport(null)}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Edit Incident</DialogTitle>
            <DialogDescription>Update details for this incident report.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 pt-4">
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
                <FormField control={editForm.control} name="lat" render={({ field }) => (
                  <FormItem><FormLabel>Latitude</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl></FormItem>
                )} />
                <FormField control={editForm.control} name="lng" render={({ field }) => (
                  <FormItem><FormLabel>Longitude</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl></FormItem>
                )} />
              </div>
              <FormField control={editForm.control} name="roadName" render={({ field }) => (
                <FormItem><FormLabel>Road Name</FormLabel><FormControl><Input value={field.value || ''} onChange={field.onChange} /></FormControl></FormItem>
              )} />
              <FormField control={editForm.control} name="speedLimit" render={({ field }) => (
                <FormItem>
                  <FormLabel>Speed Limit (km/h)</FormLabel>
                  <FormControl><Input type="number" min={0} placeholder="e.g. 50" value={field.value ?? ''} onChange={field.onChange} /></FormControl>
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

      <AlertDialog open={!!reportToDelete} onOpenChange={(open) => !open && setReportToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Incident</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this incident report? This action cannot be undone and it will be removed from the public API immediately.
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
