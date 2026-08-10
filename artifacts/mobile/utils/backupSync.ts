/**
 * backupSync — client-side helpers for the data backup & recovery feature.
 *
 * Responsibilities:
 *  • Upload a fresh vehicle + settings snapshot whenever data changes
 *  • OTP-based phone linking and restore
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiPost } from "@/utils/apiClient";
import { loadVehicles, type SavedVehicle } from "@/utils/savedVehicles";

// ── AsyncStorage keys ─────────────────────────────────────────────────────────

const LAST_SYNC_KEY    = "msafiri_backup_last_sync_v1";
const LINKED_PHONE_KEY = "msafiri_linked_phone_v1";

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

// ── Phone OTP helpers ─────────────────────────────────────────────────────────

/** Returns the OTP-verified recovery phone number, or null if not linked. */
export async function getLinkedPhone(): Promise<string | null> {
  return AsyncStorage.getItem(LINKED_PHONE_KEY).catch(() => null);
}

/**
 * Sends an OTP to the given E.164 phone number.
 * intent: "link"    → link this phone to the current device's backup.
 *                     deviceId is required: the OTP is bound to this device
 *                     so only the same device can verify it (prevents a code
 *                     intercepted on another Apple device from being used).
 *         "restore" → look up a backup by phone and send restore OTP
 */
export async function sendOtp(
  phone: string,
  intent: "link" | "restore",
  deviceId?: string,
  channel: "sms" | "whatsapp" = "sms",
): Promise<{ ok: boolean; devOtp?: string }> {
  return apiPost<{ ok: boolean; devOtp?: string }>("/auth/send-otp", {
    phone,
    intent,
    channel,
    ...(deviceId ? { deviceId } : {}),
  });
}

/**
 * Verifies an OTP and links the phone to this device's backup record.
 * Saves the phone locally on success.
 */
export async function verifyAndLinkPhone(
  phone: string,
  otp: string,
  deviceId: string,
): Promise<void> {
  await apiPost("/auth/verify-otp", { phone, otp, intent: "link", deviceId });
  await AsyncStorage.setItem(LINKED_PHONE_KEY, phone).catch(() => {});
}

/**
 * Verifies an OTP and restores backup data for the given phone number.
 * Returns vehicles and settings on success, throws on failure.
 */
export async function restoreViaPhone(
  phone: string,
  otp: string,
  newDeviceId: string,
): Promise<{ vehicles: SavedVehicle[]; settings: SettingsSnapshot }> {
  const result = await apiPost<{ vehicles: SavedVehicle[]; settings: SettingsSnapshot }>(
    "/auth/verify-otp",
    { phone, otp, intent: "restore", newDeviceId },
  );
  await AsyncStorage.setItem(LINKED_PHONE_KEY, phone).catch(() => {});
  return result;
}

