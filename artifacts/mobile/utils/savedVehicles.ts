/**
 * savedVehicles — multi-vehicle list stored in AsyncStorage.
 *
 * The primary vehicle (isDefault: true) stays in sync with AppContext's
 * makeId/modelId. Additional vehicles are stored here only.
 *
 * Slot management:
 *   - When the user taps "Change Vehicle" on slide N, we write the slot
 *     index to PENDING_SLOT_KEY and route to /car-picker.
 *   - On the next garage focus, we read PENDING_SLOT_KEY, update that
 *     slot's make/model from AppContext (car-picker always writes there),
 *     then clear the key.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { VehicleTypeId } from "@/data/vehicleTypes";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SavedVehicle {
  id: string;
  makeId: string | null;
  modelId: string | null;
  customMakeName: string | null;
  customModelName: string | null;
  vehicleType: VehicleTypeId;
  isDefault: boolean;
  // Optional extras collected during vehicle setup
  fuelType?: "Petrol" | "Diesel" | "Electric" | "Hybrid" | "CNG";
  transmission?: "Automatic" | "Manual";
  odometerKm?: number;
  plateNumber?: string;
  // Shared-vehicle metadata — set when a vehicle is registered for sharing
  // (role="owner") or joined as a co-driver (role="driver").
  sharedVehicleId?:   string;               // ID in shared_vehicles table
  sharedVehicleRole?: "owner" | "driver";
  /** Server-issued HMAC token — required to authorize owner-level actions (removing members). */
  memberToken?:       string;
}

export interface VehicleDetails {
  fuelType?: SavedVehicle["fuelType"];
  transmission?: SavedVehicle["transmission"];
  odometerKm?: number;
  plateNumber?: string;
}

// ── Keys ──────────────────────────────────────────────────────────────────────

const LIST_KEY                    = "msafiri_vehicles_v1";
export const PENDING_SLOT_KEY     = "msafiri_pending_vehicle_slot";
const PENDING_DETAILS_KEY         = "msafiri_pending_vehicle_details";
/**
 * Stores the ID of the first vehicle ever created on this device.
 * Used to consistently attribute NULL-vehicleId drive sessions regardless
 * of which vehicle is currently set as the default.  Written once, never
 * updated (even when the primary vehicle is deleted and another one takes
 * its place), so trips from before multi-vehicle support always live under
 * the same vehicle.
 */
const PRIMARY_VEHICLE_ID_KEY      = "msafiri_primary_vehicle_id";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the ID of the first vehicle ever created on this device.
 * Falls back to the first entry in `fallbackList` and persists that
 * so subsequent calls are fast (no list parse needed).
 * Returns null only when the device has no vehicles at all.
 *
 * Validation: if the stored primary ID no longer exists in `fallbackList`
 * (e.g. the original vehicle was deleted), we reassign to the first
 * remaining vehicle and persist that, so NULL-vehicleId legacy sessions
 * stay visible under the new primary rather than becoming orphaned.
 */
export async function getPrimaryVehicleId(
  fallbackList: SavedVehicle[],
): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(PRIMARY_VEHICLE_ID_KEY);
    if (stored) {
      // Validate: the stored primary must still exist in the current list.
      if (fallbackList.some((v) => v.id === stored)) return stored;
      // The original vehicle was deleted — reassign to the current first vehicle.
      const reassigned = fallbackList[0]?.id ?? null;
      if (reassigned) {
        AsyncStorage.setItem(PRIMARY_VEHICLE_ID_KEY, reassigned).catch(() => {});
      } else {
        AsyncStorage.removeItem(PRIMARY_VEHICLE_ID_KEY).catch(() => {});
      }
      return reassigned;
    }
  } catch {
    // ignore storage errors — fall through to list fallback
  }
  const first = fallbackList[0]?.id ?? null;
  if (first) {
    AsyncStorage.setItem(PRIMARY_VEHICLE_ID_KEY, first).catch(() => {});
  }
  return first;
}

export async function setPrimaryVehicleIdIfUnset(id: string): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(PRIMARY_VEHICLE_ID_KEY);
    if (!stored) await AsyncStorage.setItem(PRIMARY_VEHICLE_ID_KEY, id);
  } catch {
    // best-effort — a missing primary ID just means isDefault falls back as before
  }
}

export async function loadVehicles(): Promise<SavedVehicle[]> {
  try {
    const raw = await AsyncStorage.getItem(LIST_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as SavedVehicle[];
    // Normalize plate display format on every read so legacy/raw stored values
    // always render as "KDA 123A" regardless of how they were originally saved.
    return list.map((v) =>
      v.plateNumber ? { ...v, plateNumber: normalizePlate(v.plateNumber) } : v
    );
  } catch {
    return [];
  }
}

export async function saveVehicles(list: SavedVehicle[]): Promise<void> {
  await AsyncStorage.setItem(LIST_KEY, JSON.stringify(list));
}

/**
 * Seed the list from AppContext values on first run.
 * Returns the list (existing or freshly seeded).
 */
export async function ensureVehicles(params: {
  makeId: string | null;
  modelId: string | null;
  customMakeName: string | null;
  customModelName: string | null;
  vehicleType: VehicleTypeId;
}): Promise<SavedVehicle[]> {
  const existing = await loadVehicles();
  if (existing.length > 0) return existing;

  // Do NOT seed when AppContext has no valid vehicle identity. This covers the
  // case where the user deliberately deleted all their vehicles — we cleared
  // AppContext make/model to "" at that point. Without this guard, every
  // garage focus would re-create the deleted vehicle from stale AppContext keys.
  if (!params.makeId) return [];

  // Seed from the single AppContext vehicle
  const seed: SavedVehicle = {
    id: "v0",
    makeId: params.makeId,
    modelId: params.modelId,
    customMakeName: params.customMakeName,
    customModelName: params.customModelName,
    vehicleType: params.vehicleType,
    isDefault: true,
  };
  await saveVehicles([seed]);
  await setPrimaryVehicleIdIfUnset(seed.id);
  return [seed];
}

/**
 * After car-picker returns, update the slot that was being edited.
 * Also picks up any pending vehicle details (fuel type, transmission, odometer).
 * Returns the updated list (or null if no pending slot).
 */
export async function applyPendingSlot(params: {
  makeId: string | null;
  modelId: string | null;
  customMakeName: string | null;
  customModelName: string | null;
  vehicleType: VehicleTypeId;
}): Promise<SavedVehicle[] | null> {
  const slotRaw = await AsyncStorage.getItem(PENDING_SLOT_KEY);
  if (slotRaw === null) return null;

  const slot = parseInt(slotRaw, 10);
  await AsyncStorage.removeItem(PENDING_SLOT_KEY);

  // Consume any extra details saved by the vehicle-details step
  const details = await loadPendingDetails();
  await clearPendingDetails();

  const list = await loadVehicles();

  if (slot === -1) {
    // Adding a brand-new vehicle
    const newVehicle: SavedVehicle = {
      id: `v${Date.now()}`,
      makeId: params.makeId,
      modelId: params.modelId,
      customMakeName: params.customMakeName,
      customModelName: params.customModelName,
      vehicleType: params.vehicleType,
      isDefault: false,
      ...(details ?? {}),
    };
    const updated = [...list, newVehicle];
    await saveVehicles(updated);
    // If the list was empty, this is the first vehicle — record it as primary
    if (list.length === 0) await setPrimaryVehicleIdIfUnset(newVehicle.id);
    return updated;
  }

  // Updating an existing slot
  const updated = list.map((v, i) =>
    i === slot
      ? {
          ...v,
          makeId: params.makeId,
          modelId: params.modelId,
          customMakeName: params.customMakeName,
          customModelName: params.customModelName,
          vehicleType: params.vehicleType,
          ...(details ?? {}),
        }
      : v
  );
  await saveVehicles(updated);
  return updated;
}

export async function setDefaultVehicle(id: string): Promise<SavedVehicle[]> {
  const list = await loadVehicles();
  const updated = list.map(v => ({ ...v, isDefault: v.id === id }));
  await saveVehicles(updated);
  return updated;
}

/**
 * Persist the sharedVehicleId (and role) on an existing local vehicle after
 * the owner successfully registers it for sharing.
 */
export async function setSharedVehicleId(
  localVehicleId: string,
  sharedVehicleId: string,
  role: "owner" | "driver",
  memberToken?: string,
): Promise<void> {
  const list = await loadVehicles();
  const updated = list.map(v =>
    v.id === localVehicleId
      ? { ...v, sharedVehicleId, sharedVehicleRole: role, ...(memberToken ? { memberToken } : {}) }
      : v,
  );
  await saveVehicles(updated);
}

/**
 * Create a new local SavedVehicle entry for a shared vehicle the user just
 * joined as a co-driver. Idempotent — no-ops if the sharedVehicleId is
 * already in the list.
 */
export async function addSharedVehicle(params: {
  sharedVehicleId: string;
  displayName:     string;
  vehicleType:     string;
  plateNumber?:    string;
  memberToken?:    string;
}): Promise<SavedVehicle[]> {
  const list = await loadVehicles();

  // Idempotent — skip if already joined (e.g. user tapped Join twice)
  if (list.some(v => v.sharedVehicleId === params.sharedVehicleId)) return list;

  const newVehicle: SavedVehicle = {
    id:              `shared-${params.sharedVehicleId}`,
    makeId:          null,
    modelId:         null,
    customMakeName:  params.displayName,
    customModelName: null,
    vehicleType:     (params.vehicleType as any) ?? "car",
    isDefault:       false,
    plateNumber:     params.plateNumber ?? undefined,
    sharedVehicleId: params.sharedVehicleId,
    sharedVehicleRole: "driver",
    ...(params.memberToken ? { memberToken: params.memberToken } : {}),
  };

  const updated = [...list, newVehicle];
  await saveVehicles(updated);
  return updated;
}

/**
 * Remove a joined shared vehicle from the local list by its sharedVehicleId.
 * Called after a co-driver successfully leaves via the API.
 */
export async function removeSharedVehicle(sharedVehicleId: string): Promise<SavedVehicle[]> {
  const list = await loadVehicles();
  const updated = list.filter(v => v.sharedVehicleId !== sharedVehicleId);
  await saveVehicles(updated);
  return updated;
}

export async function removeVehicle(id: string): Promise<SavedVehicle[]> {
  const list = await loadVehicles();
  let updated = list.filter(v => v.id !== id);
  // Ensure there's always a default
  if (updated.length > 0 && !updated.some(v => v.isDefault)) {
    updated = updated.map((v, i) => ({ ...v, isDefault: i === 0 }));
  }
  await saveVehicles(updated);
  return updated;
}

export async function setPendingSlot(slot: number): Promise<void> {
  await AsyncStorage.setItem(PENDING_SLOT_KEY, String(slot));
}

// ── Pending vehicle details (fuel type, transmission, odometer) ───────────────

export async function savePendingDetails(details: VehicleDetails): Promise<void> {
  await AsyncStorage.setItem(PENDING_DETAILS_KEY, JSON.stringify(details));
}

export async function loadPendingDetails(): Promise<VehicleDetails | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_DETAILS_KEY);
    return raw ? (JSON.parse(raw) as VehicleDetails) : null;
  } catch {
    return null;
  }
}

export async function clearPendingDetails(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_DETAILS_KEY);
}

// ── Edit existing vehicle metadata ────────────────────────────────────────────

/**
 * Update the editable metadata fields of an existing vehicle.
 * Make, model, and vehicleType are intentionally excluded — changing them
 * would cause data-attribution mixup (the exact issue "Change Vehicle" caused).
 * Trip history and session data are unaffected; only the descriptive fields change.
 */
/**
 * Normalise a Kenyan number plate to canonical form.
 * Standard civilian format: 3 letters + space + 3 digits + 1 letter  →  "KDA 123A".
 * Strips spaces and hyphens, uppercases, then inserts the canonical space if the
 * pattern matches. Non-standard plates (govt, motorcycle, vintage) are stored
 * stripped + uppercase with no reformatting.
 */
export function normalizePlate(raw: string): string {
  const stripped = raw.replace(/[\s\-]/g, "").toUpperCase();
  const m = stripped.match(/^([A-Z]{3})(\d{3})([A-Z])$/);
  if (m) return `${m[1]} ${m[2]}${m[3]}`;   // e.g. "KDA 123A"
  return stripped;
}

export async function updateVehicleDetails(
  id: string,
  details: VehicleDetails,
): Promise<SavedVehicle[]> {
  const list = await loadVehicles();
  const updated = list.map(v =>
    v.id === id
      ? {
          ...v,
          ...(details.fuelType !== undefined     && { fuelType: details.fuelType }),
          ...(details.transmission !== undefined && { transmission: details.transmission }),
          ...(details.odometerKm !== undefined   && { odometerKm: details.odometerKm }),
          ...(details.plateNumber !== undefined  && { plateNumber: details.plateNumber }),
        }
      : v,
  );
  await saveVehicles(updated);
  return updated;
}
