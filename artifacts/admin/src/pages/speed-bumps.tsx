import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleMarker, MapContainer, Popup, TileLayer, useMapEvents } from "react-leaflet";
import { AlertTriangle, CheckCircle2, Edit, List, Loader2, Map, MapPin, Plus, Search, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth";
import { useTheme } from "@/components/ThemeProvider";

interface SpeedBump {
  id: string; name: string; road: string | null; description: string | null; featureType: string;
  lat: number; lng: number; direction: string | null; source: string; alertEnabled: boolean;
  verified: boolean; status: "active" | "inactive"; createdAt: string; updatedAt: string;
}
interface BumpList { bumps: SpeedBump[]; total: number; page: number; limit: number }
type BumpForm = Pick<SpeedBump, "name" | "road" | "description" | "featureType" | "lat" | "lng" | "direction" | "alertEnabled"> & { status: "active" | "inactive"; verified: boolean };

const emptyForm: BumpForm = { name: "", road: "", description: "", featureType: "speed_bump", lat: -1.286389, lng: 36.817223, direction: "", alertEnabled: true, status: "active", verified: true };
const featureTypes = ["speed_bump", "hump", "table", "rumble_strip", "chicane", "other"];

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function MapClick({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (event) => onClick(event.latlng.lat, event.latlng.lng) });
  return null;
}

function BumpsMap({ bumps, editing, onCoordinate }: { bumps: SpeedBump[]; editing: BumpForm | null; onCoordinate: (lat: number, lng: number) => void }) {
  const { resolvedTheme } = useTheme();
  const center = useMemo<[number, number]>(() => editing ? [editing.lat, editing.lng] : bumps.length ? [bumps[0].lat, bumps[0].lng] : [-1.286389, 36.817223], [bumps, editing]);
  const url = resolvedTheme === "dark" ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  return <div className="h-[540px] overflow-hidden rounded-xl border">
    <MapContainer center={center} zoom={bumps.length ? 11 : 7} className="h-full w-full" scrollWheelZoom>
      <TileLayer url={url} attribution='&copy; OpenStreetMap contributors &copy; CARTO' />
      <MapClick onClick={onCoordinate} />
      {bumps.map((bump) => <CircleMarker key={bump.id} center={[bump.lat, bump.lng]} radius={8} pathOptions={{ color: bump.status === "active" ? "#f97316" : "#94a3b8", fillColor: bump.verified ? "#f97316" : "#eab308", fillOpacity: bump.alertEnabled ? .9 : .35 }}>
        <Popup><strong>{bump.name}</strong><br />{bump.road ?? "No road specified"}<br /><small>{bump.featureType.replaceAll("_", " ")}</small></Popup>
      </CircleMarker>)}
      {editing && <CircleMarker center={[editing.lat, editing.lng]} radius={11} pathOptions={{ color: "#2563eb", fillColor: "#2563eb", fillOpacity: .45 }}><Popup>Selected location</Popup></CircleMarker>}
    </MapContainer>
  </div>;
}

export default function SpeedBumps() {
  const { toast } = useToast(); const queryClient = useQueryClient();
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("all"); const [featureType, setFeatureType] = useState("all");
  const [view, setView] = useState<"list" | "map">("list"); const [form, setForm] = useState<BumpForm | null>(null); const [editing, setEditing] = useState<SpeedBump | null>(null); const [deleteId, setDeleteId] = useState<string | null>(null);
  const queryKey = ["/api/admin/speed-bumps", search, status, featureType, view];
  const { data, isLoading } = useQuery({ queryKey, queryFn: () => {
    const params = new URLSearchParams({ limit: view === "map" ? "500" : "100" });
    if (search) params.set("search", search); if (status !== "all") params.set("status", status); if (featureType !== "all") params.set("featureType", featureType);
    return requestJson<BumpList>(`/api/admin/speed-bumps?${params}`);
  }});
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/speed-bumps"] });
  const save = useMutation({ mutationFn: (values: BumpForm) => {
    const payload = { ...values, road: values.road || null, description: values.description || null, direction: values.direction || null };
    return editing ? requestJson(`/api/admin/speed-bumps/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) }) : requestJson("/api/admin/speed-bumps", { method: "POST", body: JSON.stringify(payload) });
  }, onSuccess: () => { toast({ title: editing ? "Speed bump updated" : "Speed bump created" }); setForm(null); setEditing(null); invalidate(); }, onError: (error: Error) => toast({ title: "Could not save speed bump", description: error.message, variant: "destructive" }) });
  const patch = useMutation({ mutationFn: ({ id, values }: { id: string; values: Partial<SpeedBump> }) => requestJson(`/api/admin/speed-bumps/${id}`, { method: "PATCH", body: JSON.stringify(values) }), onSuccess: invalidate, onError: (error: Error) => toast({ title: "Update failed", description: error.message, variant: "destructive" }) });
  const remove = useMutation({ mutationFn: (id: string) => requestJson(`/api/admin/speed-bumps/${id}`, { method: "DELETE" }), onSuccess: () => { toast({ title: "Speed bump deleted" }); setDeleteId(null); invalidate(); }, onError: (error: Error) => toast({ title: "Delete failed", description: error.message, variant: "destructive" }) });
  const bumps = data?.bumps ?? [];
  const updateForm = <K extends keyof BumpForm>(key: K, value: BumpForm[K]) => setForm(current => current ? { ...current, [key]: value } : current);
  const openEdit = (bump: SpeedBump) => { setEditing(bump); setForm({ name: bump.name, road: bump.road ?? "", description: bump.description ?? "", featureType: bump.featureType, lat: bump.lat, lng: bump.lng, direction: bump.direction ?? "", alertEnabled: bump.alertEnabled, status: bump.status, verified: bump.verified }); };
  return <AdminLayout><div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 border-b pb-6 md:flex-row md:items-end"><div><h1 className="text-3xl font-bold">Speed Bumps</h1><p className="mt-1 text-muted-foreground">Manage road-calming features and driver alerts independently from speed zones.</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => setView(view === "list" ? "map" : "list")}>{view === "list" ? <Map className="mr-2 h-4 w-4" /> : <List className="mr-2 h-4 w-4" />}{view === "list" ? "Map" : "List"}</Button><Button onClick={() => { setEditing(null); setForm(emptyForm); }}><Plus className="mr-2 h-4 w-4" />Add speed bump</Button></div></div>
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search name, road, or OSM ID…" value={search} onChange={e => setSearch(e.target.value)} /></div><Select value={featureType} onValueChange={setFeatureType}><SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All feature types</SelectItem>{featureTypes.map(type => <SelectItem key={type} value={type}>{type.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select><Select value={status} onValueChange={setStatus}><SelectTrigger className="sm:w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></div>
    {view === "map" ? <><p className="text-sm text-muted-foreground"><MapPin className="mr-1 inline h-4 w-4" />Click a location to add a new speed bump. Use the location map in the editor to relocate an existing one.</p><BumpsMap bumps={bumps} editing={null} onCoordinate={(lat, lng) => { setEditing(null); setForm({ ...emptyForm, lat, lng }); }} /></> : <div className="rounded-xl border">{isLoading ? <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading speed bumps…</div> : <Table><TableHeader><TableRow><TableHead>Feature</TableHead><TableHead>Road / location</TableHead><TableHead>Alert</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{bumps.length === 0 ? <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No speed bumps match these filters.</TableCell></TableRow> : bumps.map(bump => <TableRow key={bump.id}><TableCell><div className="font-medium">{bump.name}</div><span className="capitalize text-xs text-muted-foreground">{bump.featureType.replaceAll("_", " ")}</span></TableCell><TableCell><div>{bump.road ?? "—"}</div><div className="font-mono text-xs text-muted-foreground">{bump.lat.toFixed(5)}, {bump.lng.toFixed(5)}</div></TableCell><TableCell><div className="flex flex-wrap gap-1"><Badge variant={bump.alertEnabled ? "default" : "secondary"}>{bump.alertEnabled ? "Enabled" : "Muted"}</Badge>{bump.verified && <Badge variant="outline"><CheckCircle2 className="mr-1 h-3 w-3" />Verified</Badge>}</div></TableCell><TableCell><Badge variant={bump.status === "active" ? "default" : "secondary"} className="capitalize">{bump.status}</Badge></TableCell><TableCell><div className="flex gap-1"><Button size="sm" variant="ghost" title="Edit or relocate" onClick={() => openEdit(bump)}><Edit className="h-4 w-4" /></Button><Button size="sm" variant="ghost" title={bump.verified ? "Unverify" : "Verify"} onClick={() => patch.mutate({ id: bump.id, values: { verified: !bump.verified } })}><CheckCircle2 className="h-4 w-4" /></Button><Button size="sm" variant="ghost" title={bump.status === "active" ? "Deactivate" : "Activate"} onClick={() => patch.mutate({ id: bump.id, values: { status: bump.status === "active" ? "inactive" : "active" } })}><AlertTriangle className="h-4 w-4" /></Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteId(bump.id)}><Trash2 className="h-4 w-4" /></Button></div></TableCell></TableRow>)}</TableBody></Table>}</div>}
    <Dialog open={!!form} onOpenChange={open => { if (!open) { setForm(null); setEditing(null); } }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{editing ? "Edit speed bump" : "Add speed bump"}</DialogTitle><DialogDescription>Set its location, driver alert behavior, and review status.</DialogDescription></DialogHeader>{form && <div className="grid gap-4 py-2"><div><Label>Name</Label><Input value={form.name} onChange={e => updateForm("name", e.target.value)} /></div><div className="grid grid-cols-2 gap-3"><div><Label>Feature type</Label><Select value={form.featureType} onValueChange={v => updateForm("featureType", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{featureTypes.map(type => <SelectItem key={type} value={type}>{type.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div><div><Label>Road</Label><Input value={form.road ?? ""} onChange={e => updateForm("road", e.target.value)} /></div></div><div className="grid grid-cols-2 gap-3"><div><Label>Latitude</Label><Input type="number" step="any" value={form.lat} onChange={e => updateForm("lat", Number(e.target.value))} /></div><div><Label>Longitude</Label><Input type="number" step="any" value={form.lng} onChange={e => updateForm("lng", Number(e.target.value))} /></div></div><div><Label>Relocate on map</Label><BumpsMap bumps={[]} editing={form} onCoordinate={(lat, lng) => setForm({ ...form, lat, lng })} /></div><div><Label>Direction (optional)</Label><Input placeholder="e.g. northbound" value={form.direction ?? ""} onChange={e => updateForm("direction", e.target.value)} /></div><div><Label>Description (optional)</Label><Input value={form.description ?? ""} onChange={e => updateForm("description", e.target.value)} /></div><div className="grid grid-cols-2 gap-4 rounded-lg border p-3"><label className="flex items-center justify-between gap-2 text-sm">Driver alerts<Switch checked={form.alertEnabled} onCheckedChange={v => updateForm("alertEnabled", v)} /></label><label className="flex items-center justify-between gap-2 text-sm">Verified<Switch checked={form.verified} onCheckedChange={v => updateForm("verified", v)} /></label></div><Select value={form.status} onValueChange={v => updateForm("status", v as BumpForm["status"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active — visible to drivers</SelectItem><SelectItem value="inactive">Inactive — hidden from drivers</SelectItem></SelectContent></Select></div>}<DialogFooter><Button variant="outline" onClick={() => { setForm(null); setEditing(null); }}>Cancel</Button><Button disabled={!form?.name || save.isPending} onClick={() => form && save.mutate(form)}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? "Save changes" : "Create speed bump"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}><DialogContent><DialogHeader><DialogTitle>Delete speed bump?</DialogTitle><DialogDescription>This permanently removes the road feature and its alert.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button><Button variant="destructive" disabled={remove.isPending} onClick={() => deleteId && remove.mutate(deleteId)}>Delete</Button></DialogFooter></DialogContent></Dialog>
  </div></AdminLayout>;
}