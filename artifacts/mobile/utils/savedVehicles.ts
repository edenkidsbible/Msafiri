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
}

export interface VehicleDetails {
  fuelType?: SavedVehicle["fuelType"];
  transmission?: SavedVehicle["transmission"];
  odometerKm?: number;
}

// ── Keys ──────────────────────────────────────────────────────────────────────

const LIST_KEY                    = "msafiri_vehicles_v1";
export const PENDING_SLOT_KEY     = "msafiri_pending_vehicle_slot";
const PENDING_DETAILS_KEY         = "msafiri_pending_vehicle_details";

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function loadVehicles(): Promise<SavedVehicle[]> {
  try {
    const raw = await AsyncStorage.getItem(LIST_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedVehicle[];
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
