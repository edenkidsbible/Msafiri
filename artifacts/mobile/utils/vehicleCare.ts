/**
 * Vehicle Care — data model and AsyncStorage helpers.
 *
 * All data lives locally in AsyncStorage (keyed per-device). No backend
 * required. The schema mirrors the spec: one record per service event,
 * plus a reminder config per maintenance item.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ServiceRecord {
  id: string;
  itemId: string;
  itemName: string;
  category: string;
  date: string;        // ISO-8601
  mileageKm: number;
  costKSh?: number;
  garage?: string;
  notes?: string;
}

export interface ReminderConfig {
  itemId: string;
  itemName: string;
  category: string;
  intervalKm?: number;    // e.g. 5000
  intervalMonths?: number; // e.g. 6
}

export interface VehicleCareData {
  records: ServiceRecord[];
  reminders: ReminderConfig[];
  initialOdometerKm: number;   // user-entered starting odometer
  tripAccumulatedKm: number;   // km added from app trips since initial entry
}

// ── Defaults ──────────────────────────────────────────────────────────────────

/** Canonical maintenance catalogue with sensible default intervals */
export const MAINTENANCE_CATALOGUE: ReminderConfig[] = [
  // Engine
  { itemId: "engine-oil",       itemName: "Engine Oil",        category: "Engine",       intervalKm: 5000,  intervalMonths: 6 },
  { itemId: "oil-filter",       itemName: "Oil Filter",        category: "Engine",       intervalKm: 5000,  intervalMonths: 6 },
  { itemId: "air-filter",       itemName: "Air Filter",        category: "Engine",       intervalKm: 15000, intervalMonths: 12 },
  { itemId: "fuel-filter",      itemName: "Fuel Filter",       category: "Engine",       intervalKm: 30000, intervalMonths: 24 },
  { itemId: "spark-plugs",      itemName: "Spark Plugs",       category: "Engine",       intervalKm: 30000, intervalMonths: 24 },
  { itemId: "timing-belt",      itemName: "Timing Belt",       category: "Engine",       intervalKm: 80000, intervalMonths: 60 },
  { itemId: "serpentine-belt",  itemName: "Serpentine Belt",   category: "Engine",       intervalKm: 60000, intervalMonths: 48 },
  { itemId: "coolant",          itemName: "Coolant",           category: "Engine",       intervalKm: 40000, intervalMonths: 24 },
  { itemId: "radiator-flush",   itemName: "Radiator Flush",    category: "Engine",       intervalKm: 40000, intervalMonths: 24 },
  // Transmission
  { itemId: "transmission-oil", itemName: "Transmission Oil",  category: "Transmission", intervalKm: 40000, intervalMonths: 24 },
  { itemId: "differential-oil", itemName: "Differential Oil",  category: "Transmission", intervalKm: 40000, intervalMonths: 24 },
  { itemId: "transfer-oil",     itemName: "Transfer Case Oil", category: "Transmission", intervalKm: 40000, intervalMonths: 24 },
  // Brakes
  { itemId: "brake-pads",       itemName: "Brake Pads",        category: "Brakes",       intervalKm: 20000, intervalMonths: 18 },
  { itemId: "brake-discs",      itemName: "Brake Discs",       category: "Brakes",       intervalKm: 40000, intervalMonths: 36 },
  { itemId: "brake-shoes",      itemName: "Brake Shoes",       category: "Brakes",       intervalKm: 40000, intervalMonths: 36 },
  { itemId: "brake-fluid",      itemName: "Brake Fluid",       category: "Brakes",                          intervalMonths: 24 },
  // Tyres
  { itemId: "tyre-rotation",    itemName: "Tyre Rotation",     category: "Tyres",        intervalKm: 10000, intervalMonths: 6 },
  { itemId: "wheel-alignment",  itemName: "Wheel Alignment",   category: "Tyres",        intervalKm: 10000, intervalMonths: 6 },
  { itemId: "wheel-balancing",  itemName: "Wheel Balancing",   category: "Tyres",        intervalKm: 10000, intervalMonths: 6 },
  { itemId: "new-tyres",        itemName: "New Tyres",         category: "Tyres",        intervalKm: 50000, intervalMonths: 48 },
  // Suspension
  { itemId: "shock-absorbers",  itemName: "Shock Absorbers",   category: "Suspension",   intervalKm: 60000, intervalMonths: 48 },
  { itemId: "bushings",         itemName: "Bushings",          category: "Suspension",   intervalKm: 60000, intervalMonths: 48 },
  // Battery
  { itemId: "battery",          itemName: "Battery",           category: "Battery",                         intervalMonths: 36 },
  // AC
  { itemId: "ac-service",       itemName: "AC Service",        category: "Air Conditioning",                intervalMonths: 12 },
  { itemId: "cabin-filter",     itemName: "Cabin Air Filter",  category: "Air Conditioning", intervalKm: 15000, intervalMonths: 12 },
  // Miscellaneous
  { itemId: "wiper-blades",     itemName: "Wiper Blades",      category: "Miscellaneous",                  intervalMonths: 12 },
  { itemId: "washer-fluid",     itemName: "Washer Fluid",      category: "Miscellaneous",                  intervalMonths: 3 },
];

export const CATEGORIES = [
  "Engine", "Transmission", "Brakes", "Tyres",
  "Suspension", "Battery", "Air Conditioning", "Miscellaneous",
];

// ── Storage helpers ───────────────────────────────────────────────────────────

const STORAGE_KEY = "msafiri_vehicle_care_v1";

const DEFAULT_DATA: VehicleCareData = {
  records: [],
  reminders: MAINTENANCE_CATALOGUE.map(c => ({ ...c })),
  initialOdometerKm: 0,
  tripAccumulatedKm: 0,
};

export async function loadVehicleCareData(): Promise<VehicleCareData> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DATA };
    const parsed = JSON.parse(raw) as Partial<VehicleCareData>;
    return {
      records: parsed.records ?? [],
      reminders: parsed.reminders ?? DEFAULT_DATA.reminders,
      initialOdometerKm: parsed.initialOdometerKm ?? 0,
      tripAccumulatedKm: parsed.tripAccumulatedKm ?? 0,
    };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

export async function saveVehicleCareData(data: VehicleCareData): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function addServiceRecord(record: ServiceRecord): Promise<void> {
  const data = await loadVehicleCareData();
  data.records = [record, ...data.records];
  await saveVehicleCareData(data);
}

export async function updateTripOdometer(additionalKm: number): Promise<void> {
  const data = await loadVehicleCareData();
  data.tripAccumulatedKm = (data.tripAccumulatedKm ?? 0) + additionalKm;
  await saveVehicleCareData(data);
}

// ── Computed values ───────────────────────────────────────────────────────────

export function estimatedOdometerKm(data: VehicleCareData): number {
  return (data.initialOdometerKm ?? 0) + (data.tripAccumulatedKm ?? 0);
}

interface ItemStatus {
  reminder: ReminderConfig;
  lastRecord: ServiceRecord | null;
  /** km until next service (negative = overdue) */
  kmRemaining: number | null;
  /** days until next service (negative = overdue) */
  daysRemaining: number | null;
  /** overall status */
  status: "ok" | "upcoming" | "overdue";
}

export function computeItemStatuses(data: VehicleCareData): ItemStatus[] {
  const odometerKm = estimatedOdometerKm(data);
  const now = Date.now();

  return data.reminders.map(reminder => {
    // Find latest record for this item
    const records = data.records
      .filter(r => r.itemId === reminder.itemId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const last = records[0] ?? null;

    let kmRemaining: number | null = null;
    let daysRemaining: number | null = null;

    if (last) {
      if (reminder.intervalKm) {
        kmRemaining = last.mileageKm + reminder.intervalKm - odometerKm;
      }
      if (reminder.intervalMonths) {
        const nextServiceDate = new Date(last.date);
        nextServiceDate.setMonth(nextServiceDate.getMonth() + reminder.intervalMonths);
        daysRemaining = Math.round((nextServiceDate.getTime() - now) / 86_400_000);
      }
    }

    const isOverdue =
      (kmRemaining !== null && kmRemaining < 0) ||
      (daysRemaining !== null && daysRemaining < 0);

    const isUpcoming =
      !isOverdue && (
        (kmRemaining !== null && kmRemaining <= 1000) ||
        (daysRemaining !== null && daysRemaining <= 30)
      );

    return {
      reminder,
      lastRecord: last,
      kmRemaining,
      daysRemaining,
      status: isOverdue ? "overdue" : isUpcoming ? "upcoming" : "ok",
    };
  });
}

export interface VehicleCareStats {
  upcoming30Days: number;
  overdue: number;
  completedThisYear: number;
  spentLast12MonthsKSh: number;
  healthScore: number;
  healthLabel: "Excellent" | "Good" | "Needs Attention" | "Critical";
}

export function computeVehicleCareStats(data: VehicleCareData): VehicleCareStats {
  const statuses = computeItemStatuses(data);
  const now = new Date();
  const thisYear = now.getFullYear();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const overdue = statuses.filter(s => s.status === "overdue").length;
  const upcoming30Days = statuses.filter(s => s.status === "upcoming").length;
  const completedThisYear = data.records.filter(
    r => new Date(r.date).getFullYear() === thisYear
  ).length;
  const spentLast12MonthsKSh = data.records
    .filter(r => new Date(r.date) >= twelveMonthsAgo)
    .reduce((sum, r) => sum + (r.costKSh ?? 0), 0);

  // Health score: start at 100, deduct for overdue items, bonus for recent completions
  let score = 100;
  score -= overdue * 8;
  score += Math.min(completedThisYear, 5) * 1;
  score = Math.max(10, Math.min(100, score));

  const healthLabel: VehicleCareStats["healthLabel"] =
    score >= 90 ? "Excellent"
    : score >= 75 ? "Good"
    : score >= 50 ? "Needs Attention"
    : "Critical";

  return { upcoming30Days, overdue, completedThisYear, spentLast12MonthsKSh, healthScore: Math.round(score), healthLabel };
}
