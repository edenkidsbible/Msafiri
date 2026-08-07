/**
 * vehicleSessionMap — persists a local vehicleId → sessionId[] mapping.
 *
 * Drive sessions on the server only carry a deviceId; they have no vehicleId
 * column. This utility bridges the gap by recording which vehicle was active
 * when each drive session was created and using that map to filter garage stats
 * per vehicle.
 *
 * The default vehicle (isDefault: true) acts as a catch-all: it receives all
 * sessions that have NOT been explicitly assigned to another vehicle (e.g.
 * sessions created before this feature was added).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DriveSession } from "@/utils/driveSessionApi";

const MAP_KEY = "msafiri_vehicle_session_map_v1";

type SessionMap = Record<string, string[]>; // vehicleId → sessionId[]

async function loadMap(): Promise<SessionMap> {
  try {
    const raw = await AsyncStorage.getItem(MAP_KEY);
    return raw ? (JSON.parse(raw) as SessionMap) : {};
  } catch {
    return {};
  }
}

/**
 * Record that `sessionId` was driven in `vehicleId`.
 * Safe to call fire-and-forget; errors are swallowed.
 */
export async function recordSession(
  vehicleId: string,
  sessionId: string,
): Promise<void> {
  try {
    const map = await loadMap();
    if (!map[vehicleId]) map[vehicleId] = [];
    if (!map[vehicleId].includes(sessionId)) {
      map[vehicleId].push(sessionId);
    }
    await AsyncStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {
    // Non-fatal — garage filtering gracefully falls back
  }
}

/**
 * Filter `allSessions` to only those belonging to `vehicleId`.
 *
 * Special case: the default vehicle (`defaultVehicleId`) acts as a catch-all
 * and receives any session not explicitly assigned to a different vehicle.
 * This ensures old sessions (before this feature existed) still appear for
 * whoever the primary vehicle is.
 */
export async function getSessionsForVehicle(
  vehicleId: string,
  defaultVehicleId: string,
  allSessions: DriveSession[],
): Promise<DriveSession[]> {
  const map = await loadMap();

  // IDs claimed by any non-default vehicle
  const claimedByOthers = new Set<string>(
    Object.entries(map)
      .filter(([vid]) => vid !== defaultVehicleId)
      .flatMap(([, ids]) => ids),
  );

  if (vehicleId === defaultVehicleId) {
    // Default vehicle: everything not explicitly claimed by another vehicle
    return allSessions.filter(s => !claimedByOthers.has(s.id));
  }

  // Non-default: only explicitly assigned sessions
  const ownIds = new Set<string>(map[vehicleId] ?? []);
  return allSessions.filter(s => ownIds.has(s.id));
}
