/**
 * Unified SMS sender — all outbound SMS goes through SMSLeopard.
 * Used by OTP routes and emergency alerts.
 */
export { sendSms } from "./smsleopard.js";

/** Alias used by the OTP route */
export async function sendOtpSms(to: string, message: string): Promise<void> {
  const { sendSms } = await import("./smsleopard.js");
  const ok = await sendSms(to, message);
  if (!ok) throw new Error("SMS not sent — check SMSLEOPARD_API_KEY / SMSLEOPARD_API_SECRET");
}
