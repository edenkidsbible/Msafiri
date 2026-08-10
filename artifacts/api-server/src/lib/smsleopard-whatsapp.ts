/**
 * SMSLeopard WhatsApp API sender (Beta).
 *
 * Same Basic auth credentials as the SMS API (API_KEY:API_SECRET).
 * Messages must use a pre-approved WhatsApp template.
 *
 * Template: smsleopard_verification_167
 *   Body component has one variable: {{1}} = the OTP code.
 *
 * Docs: https://developers.smsleopard.com/whatsapp-api
 *
 * Required env vars:
 *   SMSLEOPARD_API_KEY        — same key used for SMS
 *   SMSLEOPARD_API_SECRET     — same secret used for SMS
 *   SMSLEOPARD_WA_PHONE_ID    — numeric phone number ID from SMSLeopard dashboard
 *                               (the ID of the connected WhatsApp Business number,
 *                               NOT the E.164 phone number itself)
 */

const BASE = "https://api.smsleopard.com/v1/whatsapp";

function authHeader(): string {
  const key    = process.env.SMSLEOPARD_API_KEY    ?? "";
  const secret = process.env.SMSLEOPARD_API_SECRET ?? "";
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

/**
 * Resolve the phone number ID.
 * Uses SMSLEOPARD_WA_PHONE_ID if set; otherwise calls the phone-numbers
 * endpoint and picks the first connected number.
 */
let _cachedPhoneId: string | null = null;

async function resolvePhoneId(): Promise<string> {
  if (process.env.SMSLEOPARD_WA_PHONE_ID) return process.env.SMSLEOPARD_WA_PHONE_ID;
  if (_cachedPhoneId) return _cachedPhoneId;

  const res  = await fetch(`${BASE}/phone-numbers`, {
    headers: { Authorization: authHeader() },
  });
  const json = await res.json() as {
    success: boolean;
    data?: { id: string; phone_number: string; status: string }[];
  };

  if (!json.success || !json.data?.length) {
    throw new Error("SMSLeopard WA: no phone numbers found on account");
  }

  const connected = json.data.find((p) => p.status === "connected") ?? json.data[0];
  _cachedPhoneId = connected.id;
  console.log(`[smsleopard-wa] resolved phone number ID: ${_cachedPhoneId} (${connected.phone_number})`);
  return _cachedPhoneId;
}

/**
 * Send a WhatsApp OTP via SMSLeopard's template messaging API.
 *
 * @param to  E.164 recipient phone number (e.g. "+254721946853")
 * @param otp The 6-digit code to embed in the message
 */
export async function sendWhatsAppOtp(to: string, otp: string): Promise<void> {
  const apiKey    = process.env.SMSLEOPARD_API_KEY;
  const apiSecret = process.env.SMSLEOPARD_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("SMSLeopard WA: SMSLEOPARD_API_KEY / SMSLEOPARD_API_SECRET not set");
  }

  const phoneNumberId = await resolvePhoneId();

  const body = {
    phone_number_id: phoneNumberId,
    recipient:       to,
    template: {
      name:     "smsleopard_verification_167",
      language: { code: "en" },
      components: [
        {
          type:       "body",
          parameters: [{ type: "text", text: otp }],
        },
      ],
    },
  };

  const res     = await fetch(`${BASE}/messages`, {
    method:  "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  console.log(`[smsleopard-wa] HTTP ${res.status} — ${rawText.slice(0, 300)}`);

  let json: { success: boolean; message?: string };
  try { json = JSON.parse(rawText); } catch {
    throw new Error(`SMSLeopard WA: non-JSON response (${res.status}): ${rawText.slice(0, 200)}`);
  }

  if (!json.success) {
    throw new Error(`SMSLeopard WA: ${json.message ?? "unknown error"}`);
  }
}
