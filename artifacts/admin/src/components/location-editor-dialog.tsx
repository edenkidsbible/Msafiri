/**
 * LocationEditorDialog
 *
 * Opens a full-screen dialog with a draggable Leaflet marker so an admin can
 * correct the coordinates of any incident or camera report.  On drag-end the
 * marker's new position is reverse-geocoded via Nominatim to auto-fill the road
 * name; the admin can override it before saving.
 *
 * The component owns the PATCH mutation internally so callers just pass an
 * `onSaved` callback they use to invalidate their query cache.
 */
import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { Loader2, MapPin } from "lucide-react";
import { useAdminUpdateReport } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { AdminReport } from "@workspace/api-client-react";
import { useTheme } from "@/components/ThemeProvider";

// Ensure Leaflet's default icons resolve even after Vite asset hashing
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const TYPE_LABELS: Record<string, string> = {
  camera:    "Speed Camera",   police:    "Police Checkpoint",
  alcoblow:  "Alcoblow",       accident:  "Accident",
  traffic:   "Traffic Jam",    roadblock: "Roadblock",
  roadworks: "Road Works",     hazard:    "Hazard",
  pothole:   "Pothole",        debris:    "Debris",
  breakdown: "Broken Down",    weather:   "Bad Weather",
  closure:   "Road Closed",    clear:     "Road Clear",
};

/** Nominatim reverse-geocode → best-effort road + area string. */
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`,
      { headers: { "Accept-Language": "en", "User-Agent": "MsafiriAdmin/1.0" } },
    );
    if (!res.ok) return null;
    const data = await res.json() as { address?: Record<string, string> };
    const addr = data.address ?? {};
    const road = addr.road ?? addr.pedestrian ?? addr.highway ?? addr.footway ?? "";
    const area = addr.suburb ?? addr.neighbourhood ?? addr.town ?? addr.city ?? addr.county ?? "";
    const parts = [road, area].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

/** Flies the map to a new centre whenever `lat`/`lng` change. */
function MapRecenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [lat, lng, map]);
  return null;
}

/** Calls `map.invalidateSize()` once after mount so the map fills the dialog. */
function MapSizeGuard() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 50);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

export interface LocationEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: AdminReport;
  /** Called after a successful save so the parent can invalidate its cache. */
  onSaved: () => void;
}

export function LocationEditorDialog({ open, onOpenChange, report, onSaved }: LocationEditorDialogProps) {
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [lat, setLat]           = useState(report.lat);
  const [lng, setLng]           = useState(report.lng);
  const [roadName, setRoadName] = useState(report.roadName ?? "");
  const [geocoding, setGeocoding] = useState(false);
  const [dirty, setDirty]       = useState(false);
  const markerRef               = useRef<L.Marker | null>(null);

  // Reset every time a new report is opened
  useEffect(() => {
    setLat(report.lat);
    setLng(report.lng);
    setRoadName(report.roadName ?? "");
    setDirty(false);
  }, [report.id, report.lat, report.lng, report.roadName]);

  const updateMutation = useAdminUpdateReport({
    mutation: {
      onSuccess: () => {
        toast({ title: "Location saved" });
        onSaved();
        onOpenChange(false);
      },
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    },
  });

  async function handleDragEnd() {
    const marker = markerRef.current;
    if (!marker) return;
    const pos = marker.getLatLng();
    setLat(pos.lat);
    setLng(pos.lng);
    setDirty(true);
    setGeocoding(true);
    const name = await reverseGeocode(pos.lat, pos.lng);
    if (name) setRoadName(name);
    setGeocoding(false);
  }

  const tileUrl = resolvedTheme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

  const typeLabel = TYPE_LABELS[report.type] ?? report.type;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-primary shrink-0" />
            Edit Location — {typeLabel}
            {report.roadName && (
              <span className="font-normal text-muted-foreground truncate text-sm">· {report.roadName}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Map — force remount when report changes so center is correct */}
        <div className="relative" style={{ height: 300 }}>
          <MapContainer
            key={report.id}
            center={[report.lat, report.lng]}
            zoom={16}
            scrollWheelZoom
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              key={tileUrl}
              url={tileUrl}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
              maxZoom={19}
            />
            <MapSizeGuard />
            <Marker
              draggable
              position={[lat, lng]}
              ref={markerRef}
              eventHandlers={{ dragend: handleDragEnd }}
            />
          </MapContainer>

          {/* Coordinate readout */}
          <div className="absolute bottom-2 left-2 z-[1000] bg-background/90 backdrop-blur-sm border border-border rounded px-2 py-1 text-xs font-mono select-all pointer-events-none">
            {lat.toFixed(6)},&thinsp;{lng.toFixed(6)}
          </div>

          {/* Hint */}
          <div className="absolute top-2 right-2 z-[1000] bg-background/85 backdrop-blur-sm border border-border rounded px-2 py-1 text-xs text-muted-foreground pointer-events-none">
            Drag marker to correct position
          </div>
        </div>

        {/* Road name + actions */}
        <div className="px-5 py-4 space-y-4 border-t bg-muted/30">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Road Name</Label>
            <div className="relative">
              <Input
                value={roadName}
                onChange={(e) => { setRoadName(e.target.value); setDirty(true); }}
                placeholder="Auto-filled after dragging, or type manually…"
                className="pr-8"
              />
              {geocoding && (
                <Loader2 className="h-3.5 w-3.5 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Drag the pin to auto-fill from OpenStreetMap. You can also type or correct the name manually.
            </p>
          </div>

          <div className="flex justify-between items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground"
              onClick={async () => {
                setGeocoding(true);
                const name = await reverseGeocode(lat, lng);
                if (name) { setRoadName(name); setDirty(true); }
                setGeocoding(false);
              }}
              disabled={geocoding}
            >
              {geocoding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <MapPin className="h-3.5 w-3.5 mr-1.5" />}
              Lookup Road Name
            </Button>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={updateMutation.isPending || !dirty}
                onClick={() =>
                  updateMutation.mutate({
                    id: report.id,
                    data: { lat, lng, roadName: roadName.trim() || null },
                  })
                }
              >
                {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Save Location
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
