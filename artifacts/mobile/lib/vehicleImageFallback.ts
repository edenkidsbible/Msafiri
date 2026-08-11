/**
 * Shared helpers for vehicle image resolution and type-based PNG fallbacks.
 *
 * Slug derivation must match the server-side `customVehicles.ts` slugify so
 * that locally-constructed R2 keys point to the same objects the server wrote.
 */

/** Mirror of the server-side slugify used when storing custom vehicle images. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Type-specific local PNG fallback images.  These are used as the final
 * fallback when no R2 image is available — replacing the old emoji approach
 * with a consistent unbranded silhouette.
 */
export const VEHICLE_FALLBACK_IMAGES: Record<string, ReturnType<typeof require>> = {
  car:        require("@/assets/images/vehicle-car.png"),
  motorcycle: require("@/assets/images/vehicle-motorcycle.png"),
  truck:      require("@/assets/images/vehicle-truck.png"),
  psv:        require("@/assets/images/vehicle-bus.png"),
  bus:        require("@/assets/images/vehicle-bus.png"),
  tractor:    require("@/assets/images/vehicle-tractor.png"),
};

const DEFAULT_FALLBACK = require("@/assets/images/vehicle-car.png");

/**
 * Returns the local PNG asset number that best matches the vehicle type.
 * React Native require() returns a number (registered asset ID) at runtime.
 */
export function getVehicleFallbackImage(vehicleType: string): number {
  return (VEHICLE_FALLBACK_IMAGES[vehicleType] ?? DEFAULT_FALLBACK) as number;
}
