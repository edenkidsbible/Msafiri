/**
 * SMSLeopard SMS sender.
 *
 * Auth: Basic auth using API_KEY:API_SECRET (access token from dashboard).
 * Docs: https://developers.smsleopard.com/sms-api/how-to-send-sms/send-single-sms
 *
 * Sender ID setup:
 *   Go to your SMSLeopard dashboard → Sender IDs → apply for a custom ID
 *   (e.g. "MSAFIRI"). Set SMSLEOPARD_SENDER_ID env var to the approved ID.
 *   Until approved, use "SMS_Leopard" for dev/test (development accounts only).
 */

const ENDPOINT = "https://api.smsleopard.com/v1/sms/send";

export async function sendSms(to: string, message: string): Promise<boolean> {
  const apiKey    = process.env.SMSLEOPARD_API_KEY;
  const apiSecret = process.env.SMSLEOPARD_API_SECRET;
  const senderId  = process.env.SMSLEOPARD_SENDER_ID ?? "SMS_Leopard";

  if (!apiKey || !apiSecret) {
    console.warn("[smsleopard] SMSLEOPARD_API_KEY / SMSLEOPARD_API_SECRET not set — SMS not sent to", to);
    return false;
  }

  const token = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

  const body = {
    source:      senderId,
    message,
    destination: [{ number: to }],
  };

  const res = await fetch(ENDPOINT, {
    method:  "POST",
    headers: {
      "Authorization": `Basic ${token}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  console.log(`[smsleopard] HTTP ${res.status} — raw response: ${rawText}`);

  let json: { success: boolean; message: string; recipients: { id: string; cost: number; number: string; status: string }[] };
  try { json = JSON.parse(rawText); } catch { throw new Error(`SMSLeopard: non-JSON response (${res.status}): ${rawText.slice(0, 200)}`); }

  if (!json.success) {
    throw new Error(`SMSLeopard: ${json.message}`);
  }

  const failed = json.recipients.filter((r) => r.status !== "queued" && r.status !== "sent");
  if (failed.length > 0) {
    throw new Error(`SMSLeopard delivery failed for ${failed[0].number}: ${failed[0].status}`);
  }

  console.log(`[smsleopard] sent to ${to} — ${json.message}`);
  return true;
}
