/**
 * PoiPickerMap — lightweight Leaflet map that lets admins drop a pin to set
 * lat/lng instead of typing raw coordinates.
 *
 * Clicking the map fires onPick(lat, lng).
 * A Marker is shown at the current (lat, lng) whenever they are valid.
 * The map auto-centers once on the first valid coordinate pair (e.g. when an
 * existing POI is loaded for editing).  After that the admin can pan freely.
 */

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import { useTheme } from "@/components/ThemeProvider";
import L from "leaflet";

// ── Leaflet default icon fix (same as speed-zones-map.tsx) ──────────────────
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const KENYA_CENTER: [number, number] = [-1.286389, 36.817223];

export function isValidPoiCoord(lat: number, lng: number): boolean {
  return (
    !isNaN(lat) && !isNaN(lng) &&
    lat !== 0   && lng !== 0   &&
    lat >= -90  && lat <= 90   &&
    lng >= -180 && lng <= 180
  );
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/**
 * Centers the map once on the first valid coordinate pair.
 * Uses a ref so it fires only on the first valid value even if the admin keeps
 * typing — subsequent panning is left fully under their control.
 */
function FlyToOnce({ lat, lng }: { lat: number; lng: number }) {
  const map     = useMap();
  const didFly  = useRef(false);

  useEffect(() => {
    if (didFly.current || !isValidPoiCoord(lat, lng)) return;
    didFly.current = true;
    map.setView([lat, lng], 15, { animate: false });
  }, [lat, lng, map]);

  return null;
}

// ── Public component ─────────────────────────────────────────────────────────

interface PoiPickerMapProps {
  lat:    number;
  lng:    number;
  onPick: (lat: number, lng: number) => void;
}

export function PoiPickerMap({ lat, lng, onPick }: PoiPickerMapProps) {
  const { resolvedTheme } = useTheme();

  const tileUrl = resolvedTheme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  const mapBg = resolvedTheme === "dark" ? "#0f172a" : "#e5e7eb";

  const hasPin = isValidPoiCoord(lat, lng);

  return (
    <div className="border border-border/50 rounded-md overflow-hidden" style={{ height: 280 }}>
      <MapContainer
        center={KENYA_CENTER}
        zoom={7}
        style={{ height: "100%", width: "100%", background: mapBg }}
        scrollWheelZoom
      >
        <TileLayer
          key={tileUrl}
          url={tileUrl}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={19}
        />
        <ClickHandler onPick={onPick} />
        <FlyToOnce lat={lat} lng={lng} />
        {hasPin && <Marker position={[lat, lng]} />}
      </MapContainer>
    </div>
  );
}
