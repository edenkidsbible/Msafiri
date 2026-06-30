import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Marker, useMapEvents } from "react-leaflet";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, Trash2 } from "lucide-react";
import type { AdminReport } from "@workspace/api-client-react";
import { useTheme } from "@/components/ThemeProvider";
import L from "leaflet";

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const TYPE_LABELS: Record<string, string> = {
  camera:    "Speed Camera",
  police:    "Police Checkpoint",
  alcoblow:  "Alcoblow",
  accident:  "Accident",
  traffic:   "Traffic Jam",
  roadblock: "Roadblock",
  roadworks: "Road Works",
  hazard:    "Hazard",
  pothole:   "Pothole",
  debris:    "Debris",
  breakdown: "Broken Down",
  weather:   "Bad Weather",
  closure:   "Road Closed",
  clear:     "Road Clear",
};

function resolveTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? (type ? type.charAt(0).toUpperCase() + type.slice(1) : "Unknown");
}

// Palette kept in sync with mobile incidentTypes.ts
const TYPE_MARKER_COLORS: Record<string, string> = {
  camera:    "#E53935",
  police:    "#1565C0",
  alcoblow:  "#283593",
  accident:  "#B71C1C",
  traffic:   "#C62828",
  roadblock: "#7B1FA2",
  roadworks: "#FBC02D",
  hazard:    "#FF6F00",
  pothole:   "#F57C00",
  debris:    "#795548",
  breakdown: "#FF8F00",
  weather:   "#37474F",
  closure:   "#880E4F",
  clear:     "#00C853",
  __unknown: "#546E7A",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-primary/20 text-primary border-primary/30",
  confirmed: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30",
  expired: "bg-muted text-muted-foreground border-muted-foreground/30",
  denied: "bg-destructive/20 text-destructive border-destructive/30",
};

const TYPE_COLORS: Record<string, string> = {
  camera:    "bg-red-500/10 text-red-500 border-red-500/20",
  police:    "bg-blue-800/10 text-blue-800 border-blue-800/20",
  alcoblow:  "bg-indigo-700/10 text-indigo-700 border-indigo-700/20",
  accident:  "bg-red-800/10 text-red-800 border-red-800/20",
  traffic:   "bg-red-700/10 text-red-700 border-red-700/20",
  roadblock: "bg-purple-700/10 text-purple-700 border-purple-700/20",
  roadworks: "bg-yellow-600/10 text-yellow-600 border-yellow-600/20",
  hazard:    "bg-amber-600/10 text-amber-600 border-amber-600/20",
  pothole:   "bg-amber-500/10 text-amber-500 border-amber-500/20",
  debris:    "bg-stone-500/10 text-stone-500 border-stone-500/20",
  breakdown: "bg-yellow-600/10 text-yellow-600 border-yellow-600/20",
  weather:   "bg-slate-600/10 text-slate-600 border-slate-600/20",
  closure:   "bg-pink-800/10 text-pink-800 border-pink-800/20",
  clear:     "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  __unknown: "bg-slate-500/10 text-slate-500 border-slate-500/20",
};

interface ReportsMapProps {
  reports: AdminReport[];
  onEdit: (report: AdminReport) => void;
  onDelete: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  pendingCoords?: { lat: number; lng: number } | null;
}

const KENYA_CENTER: [number, number] = [-1.286389, 36.817223];

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function ReportsMap({ reports, onEdit, onDelete, onMapClick, pendingCoords }: ReportsMapProps) {
  const { resolvedTheme } = useTheme();
  const tileUrl = resolvedTheme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  const mapBg = resolvedTheme === "dark" ? "#0f172a" : "#e5e7eb";

  const validReports = reports.filter(
    (r) => r.lat !== 0 || r.lng !== 0
  );

  const center: [number, number] =
    validReports.length > 0
      ? [
          validReports.reduce((s, r) => s + r.lat, 0) / validReports.length,
          validReports.reduce((s, r) => s + r.lng, 0) / validReports.length,
        ]
      : KENYA_CENTER;

  return (
    <div className="border border-border/50 rounded-md overflow-hidden" style={{ height: 520 }}>
      <MapContainer
        center={center}
        zoom={validReports.length > 0 ? 10 : 7}
        style={{ height: "100%", width: "100%", background: mapBg }}
        scrollWheelZoom={true}
      >
        <TileLayer
          key={tileUrl}
          url={tileUrl}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={19}
        />
        {onMapClick && <MapClickHandler onMapClick={onMapClick} />}
        {pendingCoords && (
          <Marker position={[pendingCoords.lat, pendingCoords.lng]}>
            <Popup>
              <div className="text-xs font-mono text-center">
                <div className="font-semibold mb-0.5">Selected Location</div>
                <div>{pendingCoords.lat.toFixed(5)}, {pendingCoords.lng.toFixed(5)}</div>
              </div>
            </Popup>
          </Marker>
        )}
        {validReports.map((report) => {
          const color = TYPE_MARKER_COLORS[report.type] ?? TYPE_MARKER_COLORS.__unknown;
          return (
            <CircleMarker
              key={report.id}
              center={[report.lat, report.lng]}
              radius={8}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.85,
                weight: 2,
              }}
              eventHandlers={{
                click: (e) => { e.originalEvent.stopPropagation(); },
              }}
            >
              <Popup className="leaflet-popup-dark">
                <div className="min-w-[220px] space-y-2 font-sans text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className={`text-xs ${TYPE_COLORS[report.type] ?? TYPE_COLORS.__unknown}`}
                    >
                      {resolveTypeLabel(report.type)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`capitalize text-xs ${STATUS_COLORS[report.status] ?? "bg-secondary"}`}
                    >
                      {report.status}
                    </Badge>
                  </div>

                  <div className="font-semibold text-foreground leading-tight">
                    {report.roadName || "Unknown Road"}
                  </div>

                  <div className="text-xs text-muted-foreground font-mono">
                    {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
                  </div>

                  {report.speedLimit != null && (
                    <div className="text-xs text-muted-foreground">
                      Speed limit: <span className="text-foreground font-mono">{report.speedLimit} km/h</span>
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground flex gap-3">
                    <span className="text-emerald-500">+{report.confirmCount} confirms</span>
                    <span className="text-destructive">-{report.denyCount} denies</span>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {format(new Date(report.createdAt), "MMM d, yyyy HH:mm")}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 flex-1"
                      onClick={() => onEdit(report)}
                    >
                      <Edit className="h-3 w-3" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 flex-1 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                      onClick={() => onDelete(report.id)}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
