export type VehicleSnapshot = Record<string, unknown>;

export interface BackupCandidate {
  vehicles_json: unknown;
  settings_json: unknown;
}

export function parseVehiclesSnapshot(raw: unknown): VehicleSnapshot[] | null {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(
      (vehicle): vehicle is VehicleSnapshot =>
        !!vehicle &&
        typeof vehicle === "object" &&
        typeof (vehicle as VehicleSnapshot).id === "string" &&
        typeof (vehicle as VehicleSnapshot).vehicleType === "string",
    );
    return valid.length === parsed.length ? valid : null;
  } catch {
    return null;
  }
}

export function parseSettingsSnapshot(raw: unknown): Record<string, unknown> {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function selectRestorableBackup<T extends BackupCandidate>(
  candidates: T[],
): { backup: T; vehicles: VehicleSnapshot[] } | null {
  let fallback: { backup: T; vehicles: VehicleSnapshot[] } | null = null;
  for (const candidate of candidates) {
    const vehicles = parseVehiclesSnapshot(candidate.vehicles_json);
    if (!vehicles) continue;
    if (!fallback) fallback = { backup: candidate, vehicles };
    if (vehicles.length > 0) return { backup: candidate, vehicles };
  }
  return fallback;
}

export function mergeRestorableBackups<T extends BackupCandidate>(
  candidatesNewestFirst: T[],
): {
  vehicles: VehicleSnapshot[];
  validBackups: T[];
  malformedBackups: T[];
} | null {
  const byId = new Map<string, VehicleSnapshot>();
  const validBackups: T[] = [];
  const malformedBackups: T[] = [];

  for (const candidate of candidatesNewestFirst) {
    const vehicles = parseVehiclesSnapshot(candidate.vehicles_json);
    if (!vehicles) {
      malformedBackups.push(candidate);
      continue;
    }
    validBackups.push(candidate);
    for (const vehicle of vehicles) {
      const id = vehicle.id as string;
      // Candidates are newest-first, so the first version wins on collisions.
      if (!byId.has(id)) byId.set(id, vehicle);
    }
  }

  if (validBackups.length === 0) return null;
  return {
    vehicles: [...byId.values()],
    validBackups,
    malformedBackups,
  };
}