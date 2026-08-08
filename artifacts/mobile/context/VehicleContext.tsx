/**
 * VehicleContext — shared active-vehicle state for the entire app.
 *
 * Every data domain (drive sessions, dashcam clips, accident reports, stats)
 * reads activeVehicleId from here to scope what it shows. The garage swipe and
 * vehicle picker write to it so all screens react automatically.
 *
 * Architecture:
 *  • vehicles      — the full saved list from AsyncStorage (same as savedVehicles.ts)
 *  • activeVehicle — the vehicle whose data is shown everywhere right now
 *  • setActiveVehicle(id) — call when the user swipes to a different car
 *  • refreshVehicles()    — call after add / remove / edit so all consumers update
 *
 * Backward compatibility:
 *  • On first install, vehicleId is null until ensureVehicles() seeds the list.
 *  • All server-side columns (vehicle_id on live_trips, etc.) are nullable;
 *    existing rows without a vehicleId are treated as belonging to the default vehicle.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadVehicles, type SavedVehicle } from "@/utils/savedVehicles";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VehicleContextValue {
  /** All saved vehicles for this device. Empty until vehicles are added. */
  vehicles: SavedVehicle[];
  /** The vehicle whose data is currently shown across the whole app. */
  activeVehicle: SavedVehicle | null;
  /** Convenience — same as activeVehicle?.id ?? null. */
  activeVehicleId: string | null;
  /**
   * Switch the active vehicle. Pass the vehicle's id.
   * Persists the choice to AsyncStorage so it survives app restarts.
   * Call this whenever the user swipes to a different car in the garage.
   */
  setActiveVehicle: (id: string) => void;
  /**
   * Reload the vehicle list from AsyncStorage and recompute the active vehicle.
   * Call this after adding, removing, or editing a vehicle so every screen
   * that reads `vehicles` gets the freshest list.
   */
  refreshVehicles: () => Promise<void>;
}

// ── Context ───────────────────────────────────────────────────────────────────

const VehicleContext = createContext<VehicleContextValue | null>(null);

export function useVehicle(): VehicleContextValue {
  const ctx = useContext(VehicleContext);
  if (!ctx) throw new Error("useVehicle must be used inside VehicleProvider");
  return ctx;
}

// ── AsyncStorage key ──────────────────────────────────────────────────────────

const ACTIVE_VEHICLE_KEY = "msafiri_active_vehicle_id_v1";

// ── Provider ──────────────────────────────────────────────────────────────────

export function VehicleProvider({ children }: { children: React.ReactNode }) {
  const [vehicles, setVehicles]           = useState<SavedVehicle[]>([]);
  const [activeVehicleId, _setActiveId]   = useState<string | null>(null);

  // Keep a ref so callbacks can read the latest list without closure staleness
  const vehiclesRef = useRef<SavedVehicle[]>([]);
  vehiclesRef.current = vehicles;

  // Derive the active vehicle object from the list + id
  const activeVehicle: SavedVehicle | null =
    vehicles.find((v) => v.id === activeVehicleId) ??
    vehicles.find((v) => v.isDefault) ??
    vehicles[0] ??
    null;

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const list = await loadVehicles();
      setVehicles(list);

      const storedId = await AsyncStorage.getItem(ACTIVE_VEHICLE_KEY);
      // Validate: the stored id must still exist in the list
      const validId =
        storedId && list.some((v) => v.id === storedId)
          ? storedId
          : list.find((v) => v.isDefault)?.id ?? list[0]?.id ?? null;

      _setActiveId(validId);
    })();
  }, []);

  // ── Public API ──────────────────────────────────────────────────────────────

  const setActiveVehicle = useCallback((id: string) => {
    _setActiveId(id);
    AsyncStorage.setItem(ACTIVE_VEHICLE_KEY, id).catch(() => {});
  }, []);

  const refreshVehicles = useCallback(async () => {
    const list = await loadVehicles();
    setVehicles(list);

    // If the currently active vehicle was removed, fall back to default
    _setActiveId((prevId) => {
      const stillExists = prevId && list.some((v) => v.id === prevId);
      if (stillExists) return prevId;
      const fallback =
        list.find((v) => v.isDefault)?.id ?? list[0]?.id ?? null;
      if (fallback) AsyncStorage.setItem(ACTIVE_VEHICLE_KEY, fallback).catch(() => {});
      return fallback;
    });
  }, []);

  return (
    <VehicleContext.Provider
      value={{ vehicles, activeVehicle, activeVehicleId, setActiveVehicle, refreshVehicles }}
    >
      {children}
    </VehicleContext.Provider>
  );
}
