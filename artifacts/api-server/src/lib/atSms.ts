/**
 * atSms.ts — Africa's Talking SMS sender.
 *
 * Used for OTP delivery. Keep Twilio (sms.ts) for emergency-contact SMS
 * since it's already wired to those routes.
 *
 * Env vars required:
 *   AT_USERNAME — Africa's Talking account username
 *   AT_API_KEY  — Africa's Talking API key
 */

// Africa's Talking ships as CommonJS with no bundled types.
type ATSMSResult = {
  SMSMessageData: { Recipients: Array<{ status: string; number: string }> };
};
type ATClient = {
  SMS: {
    send(opts: { to: string[]; message: string; from?: string }): Promise<ATSMSResult>;
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AfricasTalking = require("africastalking") as (opts: {
  username: string;
  apiKey: string;
}) => ATClient;

const AT_USERNAME = process.env.AT_USERNAME;
const AT_API_KEY  = process.env.AT_API_KEY;

/**
 * Sends an SMS via Africa's Talking.
 * Returns true when the API call succeeded (delivery is async / carrier-side).
 * Logs a warning and returns false when credentials are missing.
 */
export async function sendAtSms(to: string, message: string): Promise<boolean> {
  if (!AT_USERNAME || !AT_API_KEY) {
    console.warn("[AT SMS] AT_USERNAME / AT_API_KEY not set — SMS not sent to", to);
    return false;
  }
  try {
    const client = AfricasTalking({ username: AT_USERNAME, apiKey: AT_API_KEY });
    await client.SMS.send({ to: [to], message });
    return true;
  } catch (err) {
    console.error("[AT SMS] Send failed:", err);
    return false;
  }
}
