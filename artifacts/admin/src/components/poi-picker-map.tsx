/**
 * PoiPickerMap — lightweight Leaflet map that lets admins drop a pin to set
 * lat/lng instead of typing raw coordinates.
 *
 * Clicking the map fires onPick(lat, lng).
 * A Marker is shown at the current (lat, lng) whenever they are valid.
 * The map auto-centers once on the first valid coordinate pair (e.g. when an
 * existing POI is loaded for editing).  After that the admin can pan freely.
 *
 * A geocoding search box (Photon / komoot) is shown above the map.
 * Selecting a result flies the map to that location, calls onPick, and calls
 * onAddressResult so the parent can pre-fill the address field.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import { useTheme } from "@/components/ThemeProvider";
import { Input } from "@/components/ui/input";
import { Loader2, Search, X } from "lucide-react";
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

// ── Photon geocoding types ────────────────────────────────────────────────────

interface PhotonFeature {
  geometry: { coordinates: [number, number] }; // [lng, lat]
  properties: {
    name?:    string;
    street?:  string;
    housenumber?: string;
    city?:    string;
    county?:  string;
    country?: string;
    osm_value?: string;
  };
}

interface PhotonResult {
  label: string;
  lat: number;
  lng: number;
}

function featureToResult(f: PhotonFeature): PhotonResult {
  const p = f.properties;
  const parts: string[] = [];
  if (p.name)   parts.push(p.name);
  if (p.street) parts.push(p.housenumber ? `${p.housenumber} ${p.street}` : p.street);
  if (p.city)   parts.push(p.city);
  if (p.county && p.county !== p.city) parts.push(p.county);
  const label = parts.length ? parts.join(", ") : "Unknown location";
  return { label, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
}

// Short display address (name + city, or street + city) used to pre-fill the
// POI address field.
function featureToAddress(f: PhotonFeature): string {
  const p = f.properties;
  const parts: string[] = [];
  if (p.name && p.name !== p.street) parts.push(p.name);
  if (p.street) parts.push(p.housenumber ? `${p.housenumber} ${p.street}` : p.street);
  if (p.city)   parts.push(p.city);
  return parts.length ? parts.join(", ") : "";
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
  const map    = useMap();
  const didFly = useRef(false);

  useEffect(() => {
    if (didFly.current || !isValidPoiCoord(lat, lng)) return;
    didFly.current = true;
    map.setView([lat, lng], 15, { animate: false });
  }, [lat, lng, map]);

  return null;
}

/**
 * Flies the map to an explicitly chosen search result.
 * `seq` increments on every selection, so the same coordinates selected twice
 * still trigger the fly.
 */
function FlyToSearch({ lat, lng, seq }: { lat: number; lng: number; seq: number }) {
  const map    = useMap();
  const seqRef = useRef(-1);

  useEffect(() => {
    if (seq <= 0 || seq === seqRef.current) return;
    seqRef.current = seq;
    map.flyTo([lat, lng], 16, { duration: 0.8 });
  }, [lat, lng, seq, map]);

  return null;
}

// ── Geocoding search box (rendered outside MapContainer) ─────────────────────

interface GeoSearchBoxProps {
  onSelect: (result: PhotonResult, address: string) => void;
}

function GeoSearchBox({ onSelect }: GeoSearchBoxProps) {
  const [query,      setQuery]      = useState("");
  const [results,    setResults]    = useState<{ result: PhotonResult; address: string }[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [open,       setOpen]       = useState(false);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 3) { setResults([]); setOpen(false); return; }
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&bbox=33.9,-4.7,42.0,4.6`;
      const res = await fetch(url, { signal: abortRef.current.signal });
      if (!res.ok) throw new Error("Geocoding request failed");
      const json = await res.json() as { features: PhotonFeature[] };
      const items = (json.features ?? []).map((f) => ({
        result:  featureToResult(f),
        address: featureToAddress(f),
      }));
      setResults(items);
      setOpen(items.length > 0);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setResults([]);
        setOpen(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 400);
  };

  const handleSelect = (item: { result: PhotonResult; address: string }) => {
    setQuery(item.result.label);
    setOpen(false);
    setResults([]);
    onSelect(item.result, item.address);
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <div className="relative flex items-center">
        {loading
          ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
          : <Search  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        }
        <Input
          ref={inputRef}
          placeholder="Search for a location, e.g. Shell Westlands Nairobi"
          value={query}
          onChange={handleChange}
          onFocus={() => { if (results.length) setOpen(true); }}
          className="pl-9 pr-8 text-sm"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-[1000] mt-1 w-full rounded-md border border-border bg-popover text-popover-foreground shadow-md max-h-56 overflow-y-auto text-sm">
          {results.map((item, i) => (
            <li key={i}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground truncate"
                onClick={() => handleSelect(item)}
              >
                {item.result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

interface PoiPickerMapProps {
  lat:    number;
  lng:    number;
  onPick: (lat: number, lng: number) => void;
  /** Called when the user picks from the geocoder; parent can pre-fill address */
  onAddressResult?: (address: string, lat: number, lng: number) => void;
}

export function PoiPickerMap({ lat, lng, onPick, onAddressResult }: PoiPickerMapProps) {
  const { resolvedTheme } = useTheme();

  const tileUrl = resolvedTheme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  const mapBg = resolvedTheme === "dark" ? "#0f172a" : "#e5e7eb";

  const hasPin = isValidPoiCoord(lat, lng);

  // Track search-result selection to drive FlyToSearch
  const [searchTarget, setSearchTarget] = useState<{ lat: number; lng: number; seq: number } | null>(null);

  const handleSearchSelect = (result: PhotonResult, address: string) => {
    onPick(result.lat, result.lng);
    if (onAddressResult) onAddressResult(address, result.lat, result.lng);
    setSearchTarget(prev => ({ lat: result.lat, lng: result.lng, seq: (prev?.seq ?? 0) + 1 }));
  };

  return (
    <div className="space-y-2">
      <GeoSearchBox onSelect={handleSearchSelect} />

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
          {searchTarget && (
            <FlyToSearch lat={searchTarget.lat} lng={searchTarget.lng} seq={searchTarget.seq} />
          )}
          {hasPin && <Marker position={[lat, lng]} />}
        </MapContainer>
      </div>
    </div>
  );
}
