/**
 * Unified SMS sender for OTP delivery.
 * Always uses Africa's Talking production endpoint.
 */
import { sendSmsAT } from "./atSms.js";

export async function sendOtpSms(to: string, message: string): Promise<void> {
  return sendSmsAT(to, message);
}
