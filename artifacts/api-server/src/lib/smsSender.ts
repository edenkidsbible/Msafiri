/**
 * Unified SMS sender for OTP delivery.
 *
 * Routing:
 *   development  → Africa's Talking sandbox (free, no real SMS)
 *   production   → Twilio (reaches all Kenyan networks including Safaricom)
 *
 * Switch to AT production once:
 *   1. AT_USERNAME matches the account that owns AT_API_KEY
 *   2. Sender ID is approved at account.africastalking.com/sms/sender-ids
 * Then swap sendSmsTwilio → sendSmsAT in the production branch below.
 */
import { sendSmsAT }     from "./atSms.js";
import { sendSmsTwilio } from "./twilioSms.js";

const isDev = process.env.NODE_ENV !== "production";

export async function sendOtpSms(to: string, message: string): Promise<void> {
  if (isDev) {
    // AT sandbox — free, simulates delivery, logs the OTP in the console
    return sendSmsAT(to, message);
  }
  // Production: Twilio reaches Safaricom, Airtel, and Telkom
  return sendSmsTwilio(to, message);
}
