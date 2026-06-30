import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useAdminListReports, useAdminDeleteReport, useAdminCreateReport, useAdminUpdateReport } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Edit, AlertCircle, MapPin, Search, Plus, Map, List } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import type { AdminReport } from "@workspace/api-client-react";
import { ReportsMap } from "@/components/reports-map";

const TYPE_COLORS: Record<string, string> = {
  camera: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  police: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  accident: "bg-red-500/10 text-red-500 border-red-500/20",
  pothole: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  roadblock: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  clear: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  hazard: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-primary/20 text-primary border-primary/30",
  confirmed: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30",
  expired: "bg-muted text-muted-foreground border-muted-foreground/30",
  denied: "bg-destructive/20 text-destructive border-destructive/30",
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
        toast({ title: "Incident Archived", description: "The report has been permanently removed from the grid." });
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
        toast({ title: "Incident Created", description: "New telemetry logged." });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
        setIsAddOpen(false);
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
        toast({ title: "Incident Updated", description: "Telemetry updated." });
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

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight uppercase font-mono">Incident Log</h1>
            <p className="text-muted-foreground mt-1">Live telemetry of all reported grid anomalies.</p>
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

            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 font-mono uppercase tracking-wider">
                  <Plus className="h-4 w-4" /> Add Incident
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle className="uppercase font-mono tracking-wider">Log New Incident</DialogTitle>
                  <DialogDescription className="sr-only">Fill in the form to log a new incident report.</DialogDescription>
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
                      <Button type="submit" disabled={createMutation.isPending} className="font-mono uppercase w-full">
                        {createMutation.isPending ? "Logging..." : "Log Incident"}
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
              placeholder="Search by road name..."
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
              Scanning grid for anomalies...
            </div>
          ) : (
            <>
              {data && data.reports.length > 0 && (
                <p className="text-xs text-muted-foreground font-mono -mb-2">
                  Plotting {data.reports.length} of {data.total} incidents — use filters to narrow the view.
                </p>
              )}
              <ReportsMap
                reports={data?.reports ?? []}
                onEdit={openEditDialog}
                onDelete={(id) => setReportToDelete(id)}
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
                    <TableHead className="font-mono text-xs uppercase tracking-wider">Location / Road</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-wider">Status</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-wider">Speed Limit</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-wider">Confidence</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-wider">Logged At</TableHead>
                    <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                        Scanning grid for anomalies...
                      </TableCell>
                    </TableRow>
                  ) : data?.reports.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center">
                        <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2 opacity-50" />
                        <p className="text-muted-foreground">No telemetry found matching parameters.</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.reports.map((report) => (
                      <TableRow key={report.id} className="hover:bg-muted/50 transition-colors">
                        <TableCell>
                          <Badge variant="outline" className={`capitalize ${TYPE_COLORS[report.type] || "bg-secondary text-secondary-foreground"}`}>
                            {report.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                            <div>
                              <div className="font-medium text-sm">{report.roadName || "Unknown Sector"}</div>
                              <div className="text-xs text-muted-foreground font-mono mt-0.5">
                                {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`capitalize font-mono text-xs ${STATUS_COLORS[report.status] || "bg-secondary"}`}>
                            {report.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {report.speedLimit != null ? `${report.speedLimit} km/h` : <span className="text-muted-foreground/50">—</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs font-mono">
                            <span className="text-emerald-500">+{report.confirmCount}</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="text-destructive">-{report.denyCount}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(report.createdAt), "MMM d, HH:mm")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(report)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setReportToDelete(report.id)}
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

      <Dialog open={!!editingReport} onOpenChange={(open) => !open && setEditingReport(null)}>
        <DialogContent className="bg-card border-border sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="uppercase font-mono tracking-wider">Edit Incident</DialogTitle>
            <DialogDescription className="sr-only">Edit the selected incident report.</DialogDescription>
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
                <Button type="submit" disabled={updateMutation.isPending} className="font-mono uppercase w-full">
                  {updateMutation.isPending ? "Updating..." : "Update Incident"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!reportToDelete} onOpenChange={(open) => !open && setReportToDelete(null)}>
        <AlertDialogContent className="bg-card border-destructive/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Confirm Deletion
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently erase this incident report from the grid. This action cannot be reversed and may affect historical telemetry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Erase Record
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
