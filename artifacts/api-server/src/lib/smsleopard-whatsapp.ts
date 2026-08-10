/**
 * SMSLeopard WhatsApp API sender.
 *
 * Send endpoint:   https://whatsapp.smsleopard.com/v1/whatsapp/send
 * Templates:       https://whatsapp.smsleopard.com/v1/phone_number_ids/{id}/templates
 * Phone numbers:   https://api.smsleopard.com/v1/whatsapp/phone-numbers
 *
 * Auth: HTTP Basic  (API_KEY:API_SECRET), same credentials as SMS.
 *
 * Required env vars:
 *   SMSLEOPARD_API_KEY        — same key used for SMS
 *   SMSLEOPARD_API_SECRET     — same secret used for SMS
 *   SMSLEOPARD_WA_PHONE_ID    — numeric phone number ID (from SMSLeopard dashboard)
 *   SMSLEOPARD_WA_TEMPLATE_ID — (optional) template ID; resolved dynamically if not set
 */

const API_BASE      = "https://api.smsleopard.com";
const WA_BASE       = "https://whatsapp.smsleopard.com";
const TEMPLATE_NAME = "smsleopard_verification_167";

function authHeader(): string {
  const key    = process.env.SMSLEOPARD_API_KEY    ?? "";
  const secret = process.env.SMSLEOPARD_API_SECRET ?? "";
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

// --- phone number ID ---------------------------------------------------------

let _cachedPhoneId: string | null = null;

async function resolvePhoneId(): Promise<string> {
  if (process.env.SMSLEOPARD_WA_PHONE_ID) return process.env.SMSLEOPARD_WA_PHONE_ID;
  if (_cachedPhoneId) return _cachedPhoneId;

  const res  = await fetch(`${API_BASE}/v1/whatsapp/phone-numbers`, {
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
  _cachedPhoneId  = connected.id;
  console.log(`[smsleopard-wa] resolved phone number ID: ${_cachedPhoneId} (${connected.phone_number})`);
  return _cachedPhoneId;
}

// --- template ID -------------------------------------------------------------

let _cachedTemplateId: string | null = null;

async function resolveTemplateId(phoneId: string): Promise<string> {
  if (process.env.SMSLEOPARD_WA_TEMPLATE_ID) return process.env.SMSLEOPARD_WA_TEMPLATE_ID;
  if (_cachedTemplateId) return _cachedTemplateId;

  const res  = await fetch(`${WA_BASE}/v1/phone_number_ids/${phoneId}/templates`, {
    headers: { Authorization: authHeader() },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SMSLeopard WA: templates fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const templates = await res.json() as { id: string; name: string; status: string }[];

  const tpl = templates.find((t) => t.name === TEMPLATE_NAME && t.status === "APPROVED")
           ?? templates.find((t) => t.name === TEMPLATE_NAME)
           ?? templates.find((t) => t.status === "APPROVED");

  if (!tpl) {
    const names = templates.map((t) => t.name).join(", ");
    throw new Error(`SMSLeopard WA: no usable template found (available: ${names || "none"})`);
  }

  if (tpl.name !== TEMPLATE_NAME) {
    console.warn(`[smsleopard-wa] template "${TEMPLATE_NAME}" not found — falling back to "${tpl.name}"`);
  }

  _cachedTemplateId = tpl.id;
  console.log(`[smsleopard-wa] resolved template ID: ${_cachedTemplateId} (${tpl.name})`);
  return _cachedTemplateId;
}

// --- send --------------------------------------------------------------------

/**
 * Send a WhatsApp OTP via SMSLeopard's template messaging API.
 *
 * @param to  E.164 or local recipient phone number (e.g. "+254721946853" or "0721946853")
 * @param otp The 6-digit code to embed in the template body
 */
export async function sendWhatsAppOtp(to: string, otp: string): Promise<void> {
  const apiKey    = process.env.SMSLEOPARD_API_KEY;
  const apiSecret = process.env.SMSLEOPARD_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("SMSLeopard WA: SMSLEOPARD_API_KEY / SMSLEOPARD_API_SECRET not set");
  }

  const phoneNumberId = await resolvePhoneId();
  const templateId    = await resolveTemplateId(phoneNumberId);

  const body = {
    destination:     to,
    template_id:     templateId,
    phone_number_id: phoneNumberId,
    component_list: {
      components: [
        {
          component_type: "BODY",
          fields: [{ name: "1", value: otp }],
        },
      ],
    },
  };

  const res = await fetch(`${WA_BASE}/v1/whatsapp/send`, {
    method:  "POST",
    headers: {
      Authorization:  authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  console.log(`[smsleopard-wa] HTTP ${res.status} — ${rawText.slice(0, 300)}`);

  let json: { success?: boolean; message?: string; error_message?: string };
  try { json = JSON.parse(rawText); } catch {
    throw new Error(`SMSLeopard WA: non-JSON response (${res.status}): ${rawText.slice(0, 200)}`);
  }

  if (!json.success) {
    const msg = json.message ?? json.error_message ?? "unknown error";
    throw new Error(`SMSLeopard WA: ${msg}`);
  }
}
