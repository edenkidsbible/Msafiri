/**
 * backupSync — client-side helpers for the data backup & recovery feature.
 *
 * Responsibilities:
 *  • Ensure this device has a recovery code (call initBackup on first launch)
 *  • Upload a fresh vehicle + settings snapshot whenever data changes
 *  • Expose the recovery code for display in the Settings screen
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiGet, apiPost } from "@/utils/apiClient";
import { loadVehicles, type SavedVehicle } from "@/utils/savedVehicles";

// ── AsyncStorage keys ─────────────────────────────────────────────────────────

const RECOVERY_CODE_KEY = "msafiri_recovery_code_v1";
const LAST_SYNC_KEY     = "msafiri_backup_last_sync_v1";
const LINKED_PHONE_KEY  = "msafiri_linked_phone_v1";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SettingsSnapshot {
  driverName?: string;
  vehicleType?: string;
  themeOverride?: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called once at app start (from AppContext or _layout).
 * Creates a backup record on the server if one doesn't exist, then caches
 * the recovery code locally.
 * Returns the recovery code (or null on failure).
 */
export async function initBackup(deviceId: string): Promise<string | null> {
  try {
    // Fast path: code already cached locally
    const cached = await AsyncStorage.getItem(RECOVERY_CODE_KEY);
    if (cached) return cached;

    const data = await apiPost<{ recoveryCode: string }>("/backup/init", { deviceId });
    if (data?.recoveryCode) {
      await AsyncStorage.setItem(RECOVERY_CODE_KEY, data.recoveryCode);
      return data.recoveryCode;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns the cached recovery code without hitting the server.
 * Returns null if initBackup hasn't been called yet.
 */
export async function getLocalRecoveryCode(): Promise<string | null> {
  return AsyncStorage.getItem(RECOVERY_CODE_KEY).catch(() => null);
}

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

/**
 * Verifies the recovery code + plate and restores data.
 * Returns the backed-up vehicles and settings on success, throws on failure.
 * @deprecated Prefer restoreViaPhone() for new users.
 */
export async function verifyAndRestore(
  recoveryCode: string,
  plateNumber: string,
  newDeviceId: string,
): Promise<{ vehicles: SavedVehicle[]; settings: SettingsSnapshot }> {
  const result = await apiPost<{ vehicles: SavedVehicle[]; settings: SettingsSnapshot }>(
    "/backup/verify",
    {
      recoveryCode: recoveryCode.toUpperCase().trim(),
      plateNumber:  plateNumber.trim(),
      newDeviceId,
    },
  );
  // Cache the recovery code locally now that it's verified
  await AsyncStorage.setItem(RECOVERY_CODE_KEY, recoveryCode.toUpperCase().trim()).catch(() => {});
  return result;
}

// ── Phone-based OTP recovery ──────────────────────────────────────────────────

/**
 * Requests a 6-digit OTP be sent to the given Kenyan phone number.
 * Throws on network failure or if the number is invalid / recently sent.
 */
export async function sendOtp(phone: string): Promise<void> {
  await apiPost<{ ok: boolean }>("/auth/send-otp", { phone });
}

/**
 * Verifies the OTP and links the phone number to this device's backup record.
 * Saves the linked phone locally and returns the E.164 normalised number.
 * Throws with the server's error message on incorrect code or expired OTP.
 */
export async function verifyAndLinkPhone(
  phone: string,
  otp: string,
  deviceId: string,
): Promise<string> {
  const data = await apiPost<{ ok: boolean; phone: string }>(
    "/auth/verify-otp",
    { phone, otp, deviceId, intent: "link" },
  );
  await AsyncStorage.setItem(LINKED_PHONE_KEY, data.phone).catch(() => {});
  return data.phone;
}

/**
 * Verifies the OTP and restores data from the backup linked to that phone.
 * Also saves the phone locally for future reference.
 * Throws with the server's error message on failure.
 */
export async function restoreViaPhone(
  phone: string,
  otp: string,
  deviceId: string,
): Promise<{ vehicles: SavedVehicle[]; settings: SettingsSnapshot }> {
  const result = await apiPost<{
    ok: boolean;
    vehicles: SavedVehicle[];
    settings: SettingsSnapshot;
    phone: string;
  }>("/auth/verify-otp", { phone, otp, deviceId, intent: "restore" });
  if (result?.phone) {
    await AsyncStorage.setItem(LINKED_PHONE_KEY, result.phone).catch(() => {});
  }
  return { vehicles: result.vehicles, settings: result.settings };
}

/**
 * Returns the E.164 phone number linked to this device (cached locally).
 * Returns null if no phone has been linked yet.
 */
export async function getLinkedPhone(): Promise<string | null> {
  return AsyncStorage.getItem(LINKED_PHONE_KEY).catch(() => null);
}
