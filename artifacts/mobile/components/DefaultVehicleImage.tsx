/**
 * DefaultVehicleImage
 *
 * Shows the image for the user's current default vehicle — using the exact
 * same resolution order as the Garage tab's VehicleImage component so the
 * two surfaces always display the same picture.
 *
 * Resolution order:
 *   Phase 0 – GET /car-images/:makeId/:modelId  (standard or custom slug)
 *   Phase 1 – GET /car-images/:makeId/<first-standard-model>  (silhouette)
 *   Phase 2 – local type-specific transparent PNG fallback
 *
 * The component refreshes its vehicle data whenever it mounts or whenever
 * the parent signals a refresh via the `refreshKey` prop.
 */

import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, ImageStyle, StyleProp, Text, View } from "react-native";
import { CAR_MAKES, getCarImageUrl } from "@/data/carModels";
import { loadVehicles, SavedVehicle } from "@/utils/savedVehicles";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";

// ── Local fallback images (generated transparent PNGs) ───────────────────────
const VEHICLE_IMAGES: Record<string, ReturnType<typeof require>> = {
  car:        require("@/assets/images/vehicle-car.png"),
  motorcycle: require("@/assets/images/vehicle-motorcycle.png"),
  truck:      require("@/assets/images/vehicle-truck.png"),
  psv:        require("@/assets/images/vehicle-bus.png"),
  bus:        require("@/assets/images/vehicle-bus.png"),
  tractor:    require("@/assets/images/vehicle-tractor.png"),
};
const DEFAULT_IMAGE = require("@/assets/images/vehicle-car.png");

// ── Helpers (mirrors garage.tsx logic exactly) ────────────────────────────────

function firstStandardModel(makeId: string): string | null {
  const make = CAR_MAKES.find((m) => m.id === makeId);
  return make?.models?.[0]?.id ?? null;
}

function customModelSlug(modelId: string): string {
  return modelId.startsWith("custom-") ? modelId.slice(7) : modelId;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  width: number;
  height: number;
  /** Increment to force a re-load (e.g. after the user changes their vehicle). */
  refreshKey?: number | string;
  style?: StyleProp<ImageStyle>;
}

export function DefaultVehicleImage({ width, height, refreshKey, style }: Props) {
  const [vehicle, setVehicle] = useState<SavedVehicle | null>(null);
  const [loaded, setLoaded]   = useState(false);

  // Load the default vehicle from the real source of truth on mount / refresh
  useEffect(() => {
    setLoaded(false);
    loadVehicles().then((list) => {
      const def = list.find((v) => v.isDefault) ?? list[0] ?? null;
      setVehicle(def);
    }).catch(() => setVehicle(null));
  }, [refreshKey]);

  // ── No vehicle or custom make → local PNG fallback ────────────────────────
  const noMake = !vehicle?.makeId || vehicle.makeId.startsWith("custom-");

  if (!vehicle || noMake) {
    const src = VEHICLE_IMAGES[vehicle?.vehicleType ?? "car"] ?? DEFAULT_IMAGE;
    return (
      <Image
        source={src}
        style={[{ width, height }, style]}
        resizeMode="contain"
      />
    );
  }

  // ── Has a known make → use the 3-phase R2 fallback, same as garage ────────
  return (
    <VehicleImagePhased
      vehicle={vehicle}
      width={width}
      height={height}
      style={style}
      loaded={loaded}
      onLoaded={() => setLoaded(true)}
    />
  );
}

// ── Inner phased-fallback component ──────────────────────────────────────────

interface PhasedProps {
  vehicle: SavedVehicle;
  width: number;
  height: number;
  style?: StyleProp<ImageStyle>;
  loaded: boolean;
  onLoaded: () => void;
}

function VehicleImagePhased({ vehicle, width, height, style, loaded, onLoaded }: PhasedProps) {
  // phase 0 = model image, phase 1 = first-standard-model silhouette, phase 2 = local PNG
  const [phase, setPhase] = useState(0);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset phases when vehicle changes
  useEffect(() => {
    setPhase(0);
    retryCount.current = 0;
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, [vehicle.makeId, vehicle.modelId]);

  useEffect(() => {
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, []);

  const makeId = vehicle.makeId!;
  // A model is "custom" only when it actually exists and carries the prefix —
  // missing modelId means the user chose a make but hasn't picked a model yet,
  // which is a valid state (treated the same as phase 1 silhouette).
  const isModelCustom = !!vehicle.modelId && vehicle.modelId.startsWith("custom-");

  if (phase >= 2) {
    // Local PNG fallback
    const src = VEHICLE_IMAGES[vehicle.vehicleType] ?? DEFAULT_IMAGE;
    return (
      <Image
        source={src}
        style={[{ width, height }, style]}
        resizeMode="contain"
      />
    );
  }

  let uri: string;
  if (phase === 0) {
    if (!vehicle.modelId) {
      // Make known but no model chosen yet — show first standard-model silhouette
      // rather than crashing. Fall through to the phase-1 path.
      const fallback = firstStandardModel(makeId);
      if (!fallback) {
        const src = VEHICLE_IMAGES[vehicle.vehicleType] ?? DEFAULT_IMAGE;
        return (
          <Image source={src} style={[{ width, height }, style]} resizeMode="contain" />
        );
      }
      uri = getCarImageUrl(makeId, fallback);
    } else {
      const slug = isModelCustom ? customModelSlug(vehicle.modelId) : vehicle.modelId;
      uri = getCarImageUrl(makeId, slug);
    }
  } else {
    const fallback = firstStandardModel(makeId);
    if (!fallback) {
      // No standard model to fall back to — jump straight to local PNG
      setTimeout(() => setPhase(2), 0);
      const src = VEHICLE_IMAGES[vehicle.vehicleType] ?? DEFAULT_IMAGE;
      return (
        <Image
          source={src}
          style={[{ width, height }, style]}
          resizeMode="contain"
        />
      );
    }
    uri = getCarImageUrl(makeId, fallback);
  }

  function handleError() {
    onLoaded(); // clear spinner
    if (phase === 0 && isModelCustom && retryCount.current < 4) {
      // Custom image may still be generating — poll every 15 s
      retryCount.current += 1;
      retryTimer.current = setTimeout(() => setPhase(0), 15_000);
    } else {
      setPhase((p) => p + 1);
    }
  }

  return (
    <View style={{ width, height, alignItems: "center", justifyContent: "center" }}>
      {!loaded && (
        <ActivityIndicator
          size="small"
          color="#00A845"
          style={{ position: "absolute" }}
        />
      )}
      <Image
        key={`${uri}-${retryCount.current}`}
        source={{ uri }}
        style={[{ width, height }, style]}
        resizeMode="contain"
        onLoad={onLoaded}
        onError={handleError}
      />
    </View>
  );
}
