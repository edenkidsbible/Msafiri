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

/**
 * Thrown when SMSLeopard rejects the send because of a carrier-level time
 * restriction on the sender ID. All carriers and sender IDs on this account
 * are subject to the 8 AM – 6 PM EAT send window.
 */
export class SmsRestrictedTimeError extends Error {
  constructor() {
    super("restricted_send_time");
    this.name = "SmsRestrictedTimeError";
  }
}

/**
 * Detect the Kenyan carrier from a phone number (E.164 +254… or local 07…/01…).
 * Ranges sourced from the Communications Authority of Kenya number allocations.
 *
 * Safaricom : 070x–072x, 0740–0743, 079x, 011x
 * Airtel    : 073x, 0744–075x, 078x, 010x
 * Telkom    : 076x, 077x
 *
 * Exported for unit-testing; not part of the public module API.
 */
export function detectCarrier(number: string): string {
  // Normalise to local 10-digit form regardless of whether +254 or 0 prefix is used.
  const local = number.replace(/^\+254/, "0").replace(/^254/, "0");
  // Safaricom: 070x, 071x, 072x, 0740–0743, 079x, 011x
  if (/^0(7[012]\d|74[0-3]|79\d|11\d)/.test(local)) return "Safaricom";
  // Airtel: 073x, 0744–0749, 075x, 078x, 010x
  if (/^0(73\d|74[4-9]|75\d|78\d|10\d)/.test(local)) return "Airtel";
  // Telkom: 076x, 077x
  if (/^07[67]\d/.test(local)) return "Telkom";
  return "unknown carrier";
}

export async function sendSms(to: string, message: string): Promise<boolean> {
  const apiKey    = process.env.SMSLEOPARD_API_KEY;
  const apiSecret = process.env.SMSLEOPARD_API_SECRET;
  const senderId  = process.env.SMSLEOPARD_SENDER_ID ?? "SMS_Leopard";
  const carrier   = detectCarrier(to);

  if (!apiKey || !apiSecret) {
    console.error(`[smsleopard] SMSLEOPARD_API_KEY / SMSLEOPARD_API_SECRET not configured in this environment — SMS not sent to ${to} (${carrier})`);
    return false;
  }

  if (!process.env.SMSLEOPARD_SENDER_ID) {
    console.warn("[smsleopard] SMSLEOPARD_SENDER_ID not set — falling back to 'SMS_Leopard' (dev/test only; set a custom approved sender ID for production)");
  }

  const token = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

  // SMSLeopard requires the number WITHOUT the leading '+'.
  // Passing '+254...' causes a "no valid recipients / status:failed" rejection
  // even though the number is structurally valid. Strip the '+' so the
  // destination is in the '254XXXXXXXXX' format the API actually accepts.
  const normalizedTo = to.replace(/^\+/, "");

  const body = {
    source:      senderId,
    message,
    destination: [{ number: normalizedTo }],
  };

  const res = await fetch(ENDPOINT, {
    method:  "POST",
    headers: {
      "Authorization": `Basic ${token}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const rawBody = await res.text();
    console.error(`[smsleopard] HTTP ${res.status} from API — body: ${rawBody} | senderId: ${senderId} | to: ${to} (${carrier})`);
    throw new Error(`SMSLeopard HTTP ${res.status}: ${rawBody.slice(0, 300)}`);
  }

  const json = await res.json() as {
    success: boolean;
    message: string;
    recipients: { id: string; cost: number; number: string; status: string }[];
  };

  if (!json.success) {
    const recipientStatus = json.recipients?.[0]?.status ?? "";
    console.error(`[smsleopard] send failed to ${to} (${carrier}) — HTTP ${res.status} | message: ${json.message} | recipient status: ${recipientStatus || "(none)"} | senderId: ${senderId}`);
    if (recipientStatus === "restricted_send_time") {
      throw new SmsRestrictedTimeError();
    }
    const detail = recipientStatus ? ` (${recipientStatus})` : "";
    throw new Error(`SMSLeopard: ${json.message}${detail}`);
  }

  const failed = json.recipients.filter((r) => r.status !== "queued" && r.status !== "sent");
  if (failed.length > 0) {
    const status = failed[0].status;
    console.error(`[smsleopard] delivery failed for ${failed[0].number} (${carrier}): ${status}`);
    if (status === "restricted_send_time") throw new SmsRestrictedTimeError();
    throw new Error(`SMSLeopard delivery failed for ${failed[0].number}: ${status}`);
  }

  console.log(`[smsleopard] sent to ${to} (${carrier}) — ${json.message}`);
  return true;
}
