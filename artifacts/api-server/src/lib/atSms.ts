/**
 * Africa's Talking SMS sender.
 *
 * Production notes:
 *   1. AT_USERNAME must match the account that generated AT_API_KEY.
 *      Log into account.africastalking.com → top-right shows your username.
 *   2. Without a registered Sender ID, AT can only reach Airtel Kenya numbers.
 *      Apply for a Sender ID at: https://account.africastalking.com/sms/sender-ids
 *      Until approved, use Twilio (see smsSender.ts) which reaches all networks.
 *
 * In development the sandbox endpoint is used automatically so no real credits
 * are consumed. Sandbox always requires username="sandbox".
 */

const AT_PROD_URL = "https://api.africastalking.com/version1/messaging";

export async function sendSmsAT(to: string, message: string): Promise<void> {
  const apiKey   = process.env.AT_API_KEY;
  const username = process.env.AT_USERNAME ?? "";
  const endpoint = AT_PROD_URL;

  if (!apiKey) throw new Error("AT_API_KEY not configured");
  if (!username) throw new Error("AT_USERNAME not configured");

  const body = new URLSearchParams({ username, to, message });

  const res = await fetch(endpoint, {
    method:  "POST",
    headers: {
      "apiKey":        apiKey,
      "Accept":        "application/json",
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const resText = await res.text();

  if (!res.ok) {
    throw new Error(`AT HTTP ${res.status}: ${resText}`);
  }

  let json: any;
  try { json = JSON.parse(resText); } catch {
    throw new Error(`AT unexpected response: ${resText}`);
  }

  const recipients: { status: string; number: string }[] =
    json?.SMSMessageData?.Recipients ?? [];

  if (recipients.length === 0) {
    throw new Error(`AT no recipients in response: ${resText}`);
  }

  const failed = recipients.filter((r) => r.status !== "Success");
  if (failed.length > 0) {
    throw new Error(`AT delivery failed for ${failed[0].number}: ${failed[0].status}`);
  }

  console.log(`[atSms] sent to ${to} — ${json?.SMSMessageData?.Message}`);
}
