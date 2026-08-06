import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken  = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

/**
 * Sends an SMS via Twilio.
 * Returns false (and logs) if env vars are missing — useful for test builds
 * that want to call the endpoint without a real Twilio account yet.
 */
export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!accountSid || !authToken || !fromNumber) {
    console.warn("Twilio env vars not set — SMS not sent to", to);
    return false;
  }
  const client = twilio(accountSid, authToken);
  await client.messages.create({ to, from: fromNumber, body });
  return true;
}
