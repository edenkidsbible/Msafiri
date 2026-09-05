/**
 * backupSync — client-side helpers for the data backup & recovery feature.
 *
 * Responsibilities:
 *  • Upload a fresh vehicle + settings snapshot whenever data changes
 *  • OTP-based email linking and restore
 *
 * SMS is NOT used here. SMS is exclusively for emergency/SOS contacts.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiPost } from "@/utils/apiClient";
import { loadVehicles, type SavedVehicle } from "@/utils/savedVehicles";

// ── AsyncStorage keys ─────────────────────────────────────────────────────────

const LAST_SYNC_KEY    = "msafiri_backup_last_sync_v1";
const LINKED_EMAIL_KEY = "msafiri_linked_email_v1";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SettingsSnapshot {
  driverName?: string;
  vehicleType?: string;
  themeOverride?: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Uploads the current vehicle list and selected settings to the server.
 * Debounced: skips if the last sync was within the last 5 minutes.
 */
export async function syncBackup(
  deviceId: string,
  settings: SettingsSnapshot,
  force = false,
): Promise<void> {
  try {
    if (!force) {
      const lastStr = await AsyncStorage.getItem(LAST_SYNC_KEY).catch(() => null);
      if (lastStr) {
        const elapsed = Date.now() - parseInt(lastStr, 10);
        if (elapsed < 5 * 60 * 1000) return; // skip if <5 min ago
      }
    }

    const vehicles = await loadVehicles();
    await apiPost("/backup/sync", { deviceId, vehicles, settings });
    await AsyncStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  } catch {
    // Best-effort — never block the user for a backup failure
  }
}

// ── Email OTP helpers ─────────────────────────────────────────────────────────

/** Returns the OTP-verified recovery email address, or null if not linked. */
export async function getLinkedEmail(): Promise<string | null> {
  return AsyncStorage.getItem(LINKED_EMAIL_KEY).catch(() => null);
}

/**
 * Sends an OTP to the given email address.
 * intent: "link"    → link this email to the current device's backup.
 *                     deviceId is required: the OTP is bound to this device.
 *         "restore" → look up a backup by email and send restore OTP.
 */
export async function sendOtp(
  email: string,
  intent: "link" | "restore",
  deviceId?: string,
): Promise<{ ok: boolean; devOtp?: string }> {
  return apiPost<{ ok: boolean; devOtp?: string }>("/auth/send-otp", {
    email,
    intent,
    ...(deviceId ? { deviceId } : {}),
  });
}

/**
 * Verifies an OTP and links the email to this device's backup record.
 * Saves the email locally on success.
 */
export async function verifyAndLinkEmail(
  email: string,
  otp: string,
  deviceId: string,
  settings: SettingsSnapshot,
): Promise<void> {
  const vehicles = await loadVehicles();
  await apiPost("/auth/verify-otp", {
    email,
    otp,
    intent: "link",
    deviceId,
    vehicles,
    settings,
  });
  await AsyncStorage.setItem(LINKED_EMAIL_KEY, email).catch(() => {});
}

/**
 * Verifies an OTP and restores backup data for the given email address.
 * Returns vehicles and settings on success, throws on failure.
 */
export async function restoreViaEmail(
  email: string,
  otp: string,
  newDeviceId: string,
): Promise<{ vehicles: SavedVehicle[]; settings: SettingsSnapshot; partial?: boolean }> {
  const result = await apiPost<{ vehicles: SavedVehicle[]; settings: SettingsSnapshot; partial?: boolean }>(
    "/auth/verify-otp",
    { email, otp, intent: "restore", newDeviceId },
  );
  if (!result || !Array.isArray(result.vehicles)) {
    throw new Error("Recovery returned an invalid backup payload. Please try again.");
  }
  await AsyncStorage.setItem(LINKED_EMAIL_KEY, email).catch(() => {});
  return result;
}

/**
 * Plate-based recovery for accounts that have no recovery email on file.
 *
 * The user supplies their plate + vehicle details; the server verifies them
 * against the stored backup and returns {vehicles, settings} if they match.
 *
 * After a successful restore the caller MUST prompt the user to link a
 * recovery email (via sendOtp + verifyAndLinkEmail) to prevent future lockout.
 */
export async function restoreByPlate(
  plateNumber:  string,
  vehicleType:  string,
  fuelType:     string | undefined,
  transmission: string | undefined,
  newDeviceId:  string,
): Promise<{ vehicles: SavedVehicle[]; settings: SettingsSnapshot }> {
  return apiPost<{ vehicles: SavedVehicle[]; settings: SettingsSnapshot }>(
    "/backup/restore-by-plate",
    { plateNumber, vehicleType, fuelType, transmission, newDeviceId },
  );
}

// ── Legacy compat — getLinkedPhone was used by several screens; keep an alias
// so any file not yet updated continues to compile. Remove once all callers
// have been migrated to getLinkedEmail.
/** @deprecated Use getLinkedEmail instead */
export const getLinkedPhone = getLinkedEmail;
