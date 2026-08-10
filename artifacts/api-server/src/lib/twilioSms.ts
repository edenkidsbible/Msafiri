/**
 * Twilio SMS sender — used as the OTP delivery channel until Africa's Talking
 * Sender ID is registered and approved for all Kenyan networks.
 *
 * Env vars required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 */

export async function sendSmsTwilio(to: string, message: string): Promise<void> {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER not configured");
  }

  const url  = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const body = new URLSearchParams({ From: from, To: to, Body: message });
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  const res  = await fetch(url, {
    method:  "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio SMS failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { status?: string; error_message?: string };
  if (json.error_message) {
    throw new Error(`Twilio SMS error: ${json.error_message}`);
  }
}
