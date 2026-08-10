/**
 * Africa's Talking SMS sender.
 * Cheaper and more reliable for Kenya than Twilio (~6-10× lower cost,
 * direct Safaricom interconnect).
 *
 * Env vars required: AT_USERNAME, AT_API_KEY
 *
 * In development (NODE_ENV !== "production") the sandbox endpoint is used
 * automatically so you don't burn real SMS credits during testing.
 * The sandbox always requires username="sandbox" — production uses AT_USERNAME.
 */

const AT_PROD_URL    = "https://api.africastalking.com/version1/messaging";
const AT_SANDBOX_URL = "https://api.sandbox.africastalking.com/version1/messaging";

const isDev = process.env.NODE_ENV !== "production";

export async function sendSmsAT(to: string, message: string): Promise<void> {
  const apiKey   = process.env.AT_API_KEY;
  const username = isDev ? "sandbox" : (process.env.AT_USERNAME ?? "");
  const endpoint = isDev ? AT_SANDBOX_URL : AT_PROD_URL;

  if (!apiKey) throw new Error("AT_API_KEY not configured");
  if (!isDev && !username) throw new Error("AT_USERNAME not configured");

  const body = new URLSearchParams({ username, to, message });

  let resText = "";
  let status  = 0;
  try {
    const res = await fetch(endpoint, {
      method:  "POST",
      headers: {
        "apiKey":        apiKey,
        "Accept":        "application/json",
        "Content-Type":  "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    status  = res.status;
    resText = await res.text();
    if (!res.ok) {
      throw new Error(`AT HTTP ${status}: ${resText}`);
    }
  } catch (err: any) {
    // Re-throw with a clear message that contains the AT response
    throw new Error(`AT SMS failed (${status}): ${err?.message ?? resText}`);
  }

  // Parse delivery report
  let json: any;
  try { json = JSON.parse(resText); } catch {
    throw new Error(`AT SMS: unexpected response body: ${resText}`);
  }

  const recipients: { status: string; number: string }[] =
    json?.SMSMessageData?.Recipients ?? [];

  if (recipients.length === 0) {
    throw new Error(`AT SMS: no recipients in response: ${resText}`);
  }

  const failed = recipients.filter((r) => r.status !== "Success");
  if (failed.length > 0) {
    throw new Error(`AT SMS delivery failed for ${failed[0].number}: ${failed[0].status}`);
  }

  // Success — log in dev so we can confirm during testing
  if (isDev) {
    console.log(`[atSms] SANDBOX: sent to ${to} — ${json?.SMSMessageData?.Message}`);
  }
}
