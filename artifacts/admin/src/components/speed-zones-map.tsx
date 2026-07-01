import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Marker, Polyline, useMapEvents } from "react-leaflet";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Edit, Trash2 } from "lucide-react";
import type { AdminSpeedZone } from "@workspace/api-client-react";
import { useTheme } from "@/components/ThemeProvider";
import L from "leaflet";

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const TYPE_LABELS: Record<string, string> = {
  camera: "Speed Camera",
  police: "Police Checkpoint",
  zone:   "Speed Zone",
};

function resolveTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? (type ? type.charAt(0).toUpperCase() + type.slice(1) : "Unknown");
}

const TYPE_MARKER_COLORS: Record<string, string> = {
  camera: "#E53935",
  police: "#1565C0",
  zone:   "#FB8C00",
  __unknown: "#546E7A",
};

const TYPE_COLORS: Record<string, string> = {
  camera: "bg-red-500/10 text-red-500 border-red-500/20",
  police: "bg-blue-800/10 text-blue-800 border-blue-800/20",
  zone:   "bg-orange-500/10 text-orange-500 border-orange-500/20",
  __unknown: "bg-slate-500/10 text-slate-500 border-slate-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  active:   "bg-primary/20 text-primary border-primary/30",
  inactive: "bg-muted text-muted-foreground border-muted-foreground/30",
};

export type PendingZoneCoords =
  | { mode: "point"; lat: number; lng: number }
  | { mode: "stretch"; startLat: number; startLng: number; endLat?: number; endLng?: number };

interface SpeedZonesMapProps {
  zones: AdminSpeedZone[];
  onEdit: (zone: AdminSpeedZone) => void;
  onDelete: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  pendingCoords?: PendingZoneCoords | null;
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

export function SpeedZonesMap({ zones, onEdit, onDelete, onMapClick, pendingCoords }: SpeedZonesMapProps) {
  const { resolvedTheme } = useTheme();
  const tileUrl = resolvedTheme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  const mapBg = resolvedTheme === "dark" ? "#0f172a" : "#e5e7eb";

  const pointZones = zones.filter((z) => z.mode === "point" && z.lat != null && z.lng != null);
  const stretchZones = zones.filter((z) => z.mode === "stretch" && z.startLat != null && z.startLng != null && z.endLat != null && z.endLng != null);

  const allCoords: [number, number][] = [
    ...pointZones.map((z) => [z.lat as number, z.lng as number] as [number, number]),
    ...stretchZones.flatMap((z) => [
      [z.startLat as number, z.startLng as number] as [number, number],
      [z.endLat as number, z.endLng as number] as [number, number],
    ]),
  ];

  const center: [number, number] =
    allCoords.length > 0
      ? [
          allCoords.reduce((s, c) => s + c[0], 0) / allCoords.length,
          allCoords.reduce((s, c) => s + c[1], 0) / allCoords.length,
        ]
      : KENYA_CENTER;

  return (
    <div className="border border-border/50 rounded-md overflow-hidden" style={{ height: 520 }}>
      <MapContainer
        center={center}
        zoom={allCoords.length > 0 ? 10 : 7}
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

        {pendingCoords?.mode === "point" && (
          <Marker position={[pendingCoords.lat, pendingCoords.lng]}>
            <Popup>
              <div className="text-xs font-mono text-center">
                <div className="font-semibold mb-0.5">Selected Location</div>
                <div>{pendingCoords.lat.toFixed(5)}, {pendingCoords.lng.toFixed(5)}</div>
              </div>
            </Popup>
          </Marker>
        )}

        {pendingCoords?.mode === "stretch" && (
          <>
            <Marker position={[pendingCoords.startLat, pendingCoords.startLng]}>
              <Popup>
                <div className="text-xs font-mono text-center">
                  <div className="font-semibold mb-0.5">Start Point</div>
                  <div>{pendingCoords.startLat.toFixed(5)}, {pendingCoords.startLng.toFixed(5)}</div>
                </div>
              </Popup>
            </Marker>
            {pendingCoords.endLat != null && pendingCoords.endLng != null && (
              <>
                <Marker position={[pendingCoords.endLat, pendingCoords.endLng]}>
                  <Popup>
                    <div className="text-xs font-mono text-center">
                      <div className="font-semibold mb-0.5">End Point</div>
                      <div>{pendingCoords.endLat.toFixed(5)}, {pendingCoords.endLng.toFixed(5)}</div>
                    </div>
                  </Popup>
                </Marker>
                <Polyline
                  positions={[[pendingCoords.startLat, pendingCoords.startLng], [pendingCoords.endLat, pendingCoords.endLng]]}
                  pathOptions={{ color: "#FB8C00", weight: 4, dashArray: "6 6" }}
                />
              </>
            )}
          </>
        )}

        {stretchZones.map((zone) => {
          const color = TYPE_MARKER_COLORS[zone.type] ?? TYPE_MARKER_COLORS.__unknown;
          return (
            <Polyline
              key={zone.id}
              positions={[[zone.startLat as number, zone.startLng as number], [zone.endLat as number, zone.endLng as number]]}
              pathOptions={{ color, weight: 5, opacity: 0.85 }}
              eventHandlers={{ click: (e) => { e.originalEvent.stopPropagation(); } }}
            >
              <Popup className="leaflet-popup-dark">
                <ZonePopupContent zone={zone} onEdit={onEdit} onDelete={onDelete} />
              </Popup>
            </Polyline>
          );
        })}

        {pointZones.map((zone) => {
          const color = TYPE_MARKER_COLORS[zone.type] ?? TYPE_MARKER_COLORS.__unknown;
          return (
            <CircleMarker
              key={zone.id}
              center={[zone.lat as number, zone.lng as number]}
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
                <ZonePopupContent zone={zone} onEdit={onEdit} onDelete={onDelete} />
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

function ZonePopupContent({ zone, onEdit, onDelete }: { zone: AdminSpeedZone; onEdit: (z: AdminSpeedZone) => void; onDelete: (id: string) => void }) {
  return (
    <div className="min-w-[220px] space-y-2 font-sans text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className={`text-xs ${TYPE_COLORS[zone.type] ?? TYPE_COLORS.__unknown}`}>
          {resolveTypeLabel(zone.type)}
        </Badge>
        <Badge variant="outline" className={`capitalize text-xs ${STATUS_COLORS[zone.status] ?? "bg-secondary"}`}>
          {zone.status}
        </Badge>
      </div>

      <div className="font-semibold text-foreground leading-tight">
        {zone.name}
      </div>

      {zone.road && (
        <div className="text-xs text-muted-foreground">{zone.road}</div>
      )}

      {zone.speedLimit != null && (
        <div className="text-xs text-muted-foreground">
          Speed limit: <span className="text-foreground font-mono">{zone.speedLimit} km/h</span>
        </div>
      )}

      {zone.description && (
        <div className="text-xs text-muted-foreground">{zone.description}</div>
      )}

      <div className="text-xs text-muted-foreground">
        {format(new Date(zone.createdAt), "MMM d, yyyy HH:mm")}
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 flex-1"
          onClick={() => onEdit(zone)}
        >
          <Edit className="h-3 w-3" /> Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 flex-1 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
          onClick={() => onDelete(zone.id)}
        >
          <Trash2 className="h-3 w-3" /> Delete
        </Button>
      </div>
    </div>
  );
}
