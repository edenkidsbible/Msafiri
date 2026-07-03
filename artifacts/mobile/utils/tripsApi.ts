import { apiGet, apiPost, apiPatch, apiDelete } from "@/utils/apiClient";

export interface SavedPlace {
  id: string;
  label: string;
  kind: "home" | "work" | "custom";
  address: string | null;
  lat: number;
  lng: number;
  usualTimeMinutes: number | null;
  createdAt: number;
}

export interface PlannedTrip {
  id: string;
  savedPlaceId: string | null;
  label: string;
  destLat: number;
  destLng: number;
  plannedAt: number;
  status: "upcoming" | "notified" | "completed" | "cancelled";
  notifiedAt: number | null;
  createdAt: number;
}

export async function listSavedPlaces(deviceId: string): Promise<SavedPlace[]> {
  const { places } = await apiGet<{ places: SavedPlace[] }>(`/saved-places?deviceId=${encodeURIComponent(deviceId)}`);
  return places;
}

export async function createSavedPlace(deviceId: string, input: {
  label: string; kind?: "home" | "work" | "custom"; address?: string | null;
  lat: number; lng: number; usualTimeMinutes?: number | null;
}): Promise<SavedPlace> {
  return apiPost<SavedPlace>("/saved-places", { deviceId, ...input });
}

export async function updateSavedPlace(deviceId: string, id: string, input: Partial<{
  label: string; kind: "home" | "work" | "custom"; address: string | null;
  lat: number; lng: number; usualTimeMinutes: number | null;
}>): Promise<SavedPlace> {
  return apiPatch<SavedPlace>(`/saved-places/${id}`, { deviceId, ...input });
}

export async function deleteSavedPlace(deviceId: string, id: string): Promise<void> {
  await apiDelete(`/saved-places/${id}`, { deviceId });
}

export async function listPlannedTrips(deviceId: string): Promise<PlannedTrip[]> {
  const { trips } = await apiGet<{ trips: PlannedTrip[] }>(`/planned-trips?deviceId=${encodeURIComponent(deviceId)}`);
  return trips;
}

export async function createPlannedTrip(deviceId: string, input: {
  savedPlaceId?: string | null; label: string; destLat: number; destLng: number; plannedAt: number;
}): Promise<PlannedTrip> {
  return apiPost<PlannedTrip>("/planned-trips", { deviceId, ...input });
}

export async function updatePlannedTrip(deviceId: string, id: string, input: Partial<{
  status: "upcoming" | "notified" | "completed" | "cancelled"; plannedAt: number;
}>): Promise<PlannedTrip> {
  return apiPatch<PlannedTrip>(`/planned-trips/${id}`, { deviceId, ...input });
}

export async function deletePlannedTrip(deviceId: string, id: string): Promise<void> {
  await apiDelete(`/planned-trips/${id}`, { deviceId });
}
