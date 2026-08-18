import { useState, useEffect } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { FormDialog, FormDialogFooter } from "@/components/ui/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

type RoadRecordInputDataType = "speed_limit" | "road_condition" | "hazard" | "poi" | "camera" | "other";
type RoadRecordInputConfidence = "A" | "B" | "C" | "D";
type RoadRecordInputStatus = "active" | "needs_verification" | "archived";

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

interface RoadRecordFormProps {
  open: boolean;
  onClose: () => void;
  record?: RoadRecord;
}

export function RoadRecordForm({ open, onClose, record }: RoadRecordFormProps) {
  const qc = useQueryClient();

  const [form, setForm] = useState({
    county: record?.county ?? "",
    corridor: record?.corridor ?? "",
    dataType: (record?.dataType ?? "speed_limit") as RoadRecordInputDataType,
    confidence: (record?.confidence ?? "C") as RoadRecordInputConfidence,
    status: (record?.status ?? "active") as RoadRecordInputStatus,
    speedLimitKph: record?.speedLimitKph?.toString() ?? "",
    landmark: record?.landmark ?? "",
    coordinates: record?.coordinates ?? "",
    evidence: record?.evidence ?? "",
    verifier: record?.verifier ?? "",
    notes: record?.notes ?? "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        county: record?.county ?? "",
        corridor: record?.corridor ?? "",
        dataType: (record?.dataType ?? "speed_limit") as RoadRecordInputDataType,
        confidence: (record?.confidence ?? "C") as RoadRecordInputConfidence,
        status: (record?.status ?? "active") as RoadRecordInputStatus,
        speedLimitKph: record?.speedLimitKph?.toString() ?? "",
        landmark: record?.landmark ?? "",
        coordinates: record?.coordinates ?? "",
        evidence: record?.evidence ?? "",
        verifier: record?.verifier ?? "",
        notes: record?.notes ?? "",
      });
    }
  }, [open, record]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ops-road-records"] });
  };

  const createRecord = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch("/api/ops/road-records", { method: "POST", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to create road record");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const updateRecord = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch(`/api/ops/road-records/${record!.id}`, { method: "PATCH", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to update road record");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.county || !form.corridor || !form.dataType || !form.confidence) return;
    const payload = {
      county: form.county,
      corridor: form.corridor,
      dataType: form.dataType,
      confidence: form.confidence,
      status: form.status || undefined,
      speedLimitKph: form.speedLimitKph ? parseInt(form.speedLimitKph) : undefined,
      landmark: form.landmark || undefined,
      coordinates: form.coordinates || undefined,
      evidence: form.evidence || undefined,
      verifier: form.verifier || undefined,
      notes: form.notes || undefined,
    };
    if (record) {
      await updateRecord.mutateAsync(payload);
    } else {
      await createRecord.mutateAsync(payload);
    }
  };

  const isLoading = createRecord.isPending || updateRecord.isPending;
  const isConfidenceA = form.confidence === "A";

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={record ? "Edit Road Record" : "Add Road Record"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>County *</Label>
            <Input
              placeholder="e.g. Nairobi"
              value={form.county}
              onChange={e => setForm(f => ({ ...f, county: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Corridor *</Label>
            <Input
              placeholder="e.g. Uhuru Highway"
              value={form.corridor}
              onChange={e => setForm(f => ({ ...f, corridor: e.target.value }))}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Data Type *</Label>
            <Select value={form.dataType} onValueChange={v => setForm(f => ({ ...f, dataType: v as RoadRecordInputDataType }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="speed_limit">Speed Limit</SelectItem>
                <SelectItem value="road_condition">Road Condition</SelectItem>
                <SelectItem value="hazard">Hazard</SelectItem>
                <SelectItem value="poi">Point of Interest</SelectItem>
                <SelectItem value="camera">Camera</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Confidence *</Label>
            <Select value={form.confidence} onValueChange={v => setForm(f => ({ ...f, confidence: v as RoadRecordInputConfidence }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="A">A — Confirmed</SelectItem>
                <SelectItem value="B">B — Strong</SelectItem>
                <SelectItem value="C">C — Community</SelectItem>
                <SelectItem value="D">D — Unverified</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {form.dataType === "speed_limit" && (
          <div className="space-y-1.5">
            <Label>Speed Limit (km/h)</Label>
            <Input
              type="number"
              min="0"
              placeholder="e.g. 50"
              value={form.speedLimitKph}
              onChange={e => setForm(f => ({ ...f, speedLimitKph: e.target.value }))}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Landmark</Label>
          <Input
            placeholder="Nearest recognisable feature"
            value={form.landmark}
            onChange={e => setForm(f => ({ ...f, landmark: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Coordinates</Label>
          <Input
            placeholder="e.g. -1.2921, 36.8219"
            value={form.coordinates}
            onChange={e => setForm(f => ({ ...f, coordinates: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as RoadRecordInputStatus }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="needs_verification">Needs Verification</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isConfidenceA && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg space-y-3">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              Confidence A requires evidence + verifier
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Evidence *</Label>
                <Input placeholder="Source of confirmation" value={form.evidence} onChange={e => setForm(f => ({ ...f, evidence: e.target.value }))} required={isConfidenceA} />
              </div>
              <div className="space-y-1.5">
                <Label>Verifier *</Label>
                <Input placeholder="Who verified this?" value={form.verifier} onChange={e => setForm(f => ({ ...f, verifier: e.target.value }))} required={isConfidenceA} />
              </div>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Input placeholder="Optional notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        <FormDialogFooter>
          <div />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {record ? "Save Changes" : "Add Record"}
            </Button>
          </div>
        </FormDialogFooter>
      </form>
    </FormDialog>
  );
}
