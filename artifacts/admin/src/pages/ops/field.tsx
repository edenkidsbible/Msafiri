import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Map, AlertTriangle, MapPin, CheckCircle2, ShieldCheck, AlertCircle, PlusCircle, Pencil } from "lucide-react";
import { FieldTripForm } from "@/components/ops/FieldTripForm";
import { RoadRecordForm } from "@/components/ops/RoadRecordForm";

const formatKes = (v: string | number | null | undefined) => {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 }).format(n);
};

interface FieldTrip {
  id: number;
  date: string;
  purpose: string;
  corridor?: string | null;
  status: string;
  plannedKm?: number | null;
  parkingKes?: string | null;
  tollsKes?: string | null;
  totalTripCostKes?: string | null;
  requiredOutputs?: string | null;
  notes?: string | null;
}

interface RoadRecord {
  id: number;
  county: string;
  corridor: string;
  dataType: string;
  confidence: string;
  status: string;
  speedLimitKph?: number | null;
  landmark?: string | null;
  coordinates?: string | null;
  evidence?: string | null;
  verifier?: string | null;
  notes?: string | null;
}

const TRIP_STATUS_COLORS: Record<string, string> = {
  planned: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  cancelled: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300",
};

export default function FieldRoad() {
  const [activeTab, setActiveTab] = useState<'trips' | 'records'>('trips');
  const [tripFormOpen, setTripFormOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<FieldTrip | undefined>(undefined);
  const [recordFormOpen, setRecordFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RoadRecord | undefined>(undefined);

  const { data: tripsData, isLoading: loadingTrips } = useQuery<{ items: FieldTrip[] } | FieldTrip[]>({
    queryKey: ["ops-field-trips"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/field-trips");
      if (!r.ok) throw new Error("Failed to fetch field trips");
      return r.json();
    },
  });

  const { data: recordsData, isLoading: loadingRecords } = useQuery<{ items: RoadRecord[] } | RoadRecord[]>({
    queryKey: ["ops-road-records"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/road-records");
      if (!r.ok) throw new Error("Failed to fetch road records");
      return r.json();
    },
  });

  const trips: FieldTrip[] = Array.isArray(tripsData) ? tripsData : (tripsData as any)?.items ?? [];
  const records: RoadRecord[] = Array.isArray(recordsData) ? recordsData : (recordsData as any)?.items ?? [];

  const openCreateTrip = () => { setEditingTrip(undefined); setTripFormOpen(true); };
  const openEditTrip = (t: FieldTrip) => { setEditingTrip(t); setTripFormOpen(true); };
  const closeTripForm = () => { setTripFormOpen(false); setEditingTrip(undefined); };

  const openCreateRecord = () => { setEditingRecord(undefined); setRecordFormOpen(true); };
  const openEditRecord = (r: RoadRecord) => { setEditingRecord(r); setRecordFormOpen(true); };
  const closeRecordForm = () => { setRecordFormOpen(false); setEditingRecord(undefined); };

  if (loadingTrips || loadingRecords) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 w-full" /></div>;
  }

  const confidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'A': return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent hover:bg-emerald-500/25"><ShieldCheck className="w-3 h-3 mr-1" /> Confirmed (A)</Badge>;
      case 'B': return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-transparent hover:bg-blue-500/25"><CheckCircle2 className="w-3 h-3 mr-1" /> Strong (B)</Badge>;
      case 'C': return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-transparent hover:bg-amber-500/25"><AlertCircle className="w-3 h-3 mr-1" /> Community (C)</Badge>;
      case 'D': return <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-transparent hover:bg-red-500/25"><AlertTriangle className="w-3 h-3 mr-1" /> Unverified (D)</Badge>;
      default: return <Badge variant="outline">{confidence}</Badge>;
    }
  };

  return (
    <div className="space-y-8 animate-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Field & Road Data</h1>
          <p className="text-muted-foreground mt-1">Ground truth mapping and trip logistics.</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'trips' ? (
            <Button onClick={openCreateTrip}><PlusCircle className="w-4 h-4 mr-2" /> Plan Trip</Button>
          ) : (
            <Button onClick={openCreateRecord}><PlusCircle className="w-4 h-4 mr-2" /> Add Road Record</Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 border-b">
        <button
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'trips' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setActiveTab('trips')}
        >
          <MapPin className="w-4 h-4 inline mr-1.5" />
          Field Trips <span className="ml-1 text-xs opacity-60">{trips.length}</span>
        </button>
        <button
          className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'records' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setActiveTab('records')}
        >
          <Map className="w-4 h-4 inline mr-1.5" />
          Road Records <span className="ml-1 text-xs opacity-60">{records.length}</span>
        </button>
      </div>

      {/* Trips tab */}
      {activeTab === 'trips' && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left font-medium p-4 text-muted-foreground">Date</th>
                <th className="text-left font-medium p-4 text-muted-foreground">Purpose</th>
                <th className="text-left font-medium p-4 text-muted-foreground hidden md:table-cell">Corridor</th>
                <th className="text-left font-medium p-4 text-muted-foreground">Status</th>
                <th className="text-left font-medium p-4 text-muted-foreground hidden lg:table-cell">Cost</th>
                <th className="w-10 p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {trips.map(trip => (
                <tr key={trip.id} className="hover:bg-muted/20 group">
                  <td className="p-4 text-muted-foreground text-xs whitespace-nowrap">
                    {new Date(trip.date).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="p-4">
                    <p className="font-medium text-foreground">{trip.purpose}</p>
                    {trip.requiredOutputs && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{trip.requiredOutputs}</p>
                    )}
                  </td>
                  <td className="p-4 hidden md:table-cell text-muted-foreground text-xs">
                    {trip.corridor || "—"}
                  </td>
                  <td className="p-4">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full capitalize ${TRIP_STATUS_COLORS[trip.status] ?? "bg-secondary text-secondary-foreground"}`}>
                      {trip.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="p-4 hidden lg:table-cell text-muted-foreground text-xs">
                    {trip.totalTripCostKes ? formatKes(trip.totalTripCostKes) : "—"}
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => openEditTrip(trip)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </td>
                </tr>
              ))}
              {!trips.length && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">No field trips yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Road records tab */}
      {activeTab === 'records' && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left font-medium p-4 text-muted-foreground">Location</th>
                <th className="text-left font-medium p-4 text-muted-foreground">Type</th>
                <th className="text-left font-medium p-4 text-muted-foreground hidden md:table-cell">Details</th>
                <th className="text-left font-medium p-4 text-muted-foreground">Confidence</th>
                <th className="text-left font-medium p-4 text-muted-foreground">Status</th>
                <th className="w-10 p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map(record => (
                <tr key={record.id} className="hover:bg-muted/20 group">
                  <td className="p-4">
                    <p className="font-medium text-foreground">{record.county}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{record.corridor}</p>
                  </td>
                  <td className="p-4">
                    <Badge variant="secondary" className="capitalize">{record.dataType.replace('_', ' ')}</Badge>
                  </td>
                  <td className="p-4 hidden md:table-cell">
                    {record.speedLimitKph ? (
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border-2 border-red-500 font-bold text-xs bg-white text-black shrink-0">
                        {record.speedLimitKph}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs truncate max-w-[200px] block">
                        {record.landmark || record.coordinates || 'No details'}
                      </span>
                    )}
                  </td>
                  <td className="p-4">{confidenceBadge(record.confidence)}</td>
                  <td className="p-4 capitalize text-muted-foreground text-xs">{record.status.replace('_', ' ')}</td>
                  <td className="p-4">
                    <button
                      onClick={() => openEditRecord(record)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </td>
                </tr>
              ))}
              {!records.length && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">No road records found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <FieldTripForm open={tripFormOpen} onClose={closeTripForm} trip={editingTrip} />
      <RoadRecordForm open={recordFormOpen} onClose={closeRecordForm} record={editingRecord} />
    </div>
  );
}
