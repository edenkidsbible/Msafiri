export type VehicleTypeId = "car" | "psv" | "bus" | "truck" | "motorcycle" | "tractor";

export interface VehicleTypeDef {
  id: VehicleTypeId;
  label: string;
  shortLabel: string;
  iconSet: "Ionicons" | "MaterialCommunityIcons";
  icon: string;
  /** Legal max speed in a built-up/town area (km/h). */
  townLimit: number;
  /** Legal max speed on the open highway/road (km/h). */
  highwayLimit: number;
}

export const DEFAULT_VEHICLE_TYPE: VehicleTypeId = "car";

// Reference: Traffic Act Cap. 403 / Traffic (General) Rules / Legal Notice 161/2003
// ("Michuki Rules"), cross-checked against current NTSA guidance.
export const VEHICLE_TYPES: VehicleTypeDef[] = [
  { id: "car", label: "Private Car", shortLabel: "Car", iconSet: "Ionicons", icon: "car-sport-outline", townLimit: 50, highwayLimit: 110 },
  { id: "psv", label: "Matatu / PSV", shortLabel: "Matatu", iconSet: "Ionicons", icon: "bus-outline", townLimit: 50, highwayLimit: 80 },
  { id: "bus", label: "Bus", shortLabel: "Bus", iconSet: "Ionicons", icon: "bus", townLimit: 50, highwayLimit: 80 },
  { id: "truck", label: "Truck / Goods Vehicle", shortLabel: "Truck", iconSet: "MaterialCommunityIcons", icon: "truck-outline", townLimit: 50, highwayLimit: 80 },
  { id: "motorcycle", label: "Motorcycle", shortLabel: "Motorcycle", iconSet: "MaterialCommunityIcons", icon: "motorbike", townLimit: 50, highwayLimit: 80 },
  { id: "tractor", label: "Tractor / Heavy Earthmover", shortLabel: "Tractor", iconSet: "MaterialCommunityIcons", icon: "tractor-variant", townLimit: 30, highwayLimit: 30 },
];

export function getVehicleTypeDef(id: VehicleTypeId | null | undefined): VehicleTypeDef {
  return VEHICLE_TYPES.find((v) => v.id === id) ?? VEHICLE_TYPES[0];
}

/**
 * Caps a zone's posted speed limit to the legal maximum for the given vehicle
 * class. Zones at or below 50 km/h are treated as the "town" tier; anything
 * above is the "highway/open road" tier. Private cars effectively pass
 * through unchanged since every zone in the dataset is already at or below
 * the car's highway cap.
 */
export function capSpeedLimit(postedLimit: number, vehicle: VehicleTypeDef): number {
  const tierLimit = postedLimit <= 50 ? vehicle.townLimit : vehicle.highwayLimit;
  return Math.min(postedLimit, tierLimit);
}
