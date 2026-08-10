/**
 * Africa's Talking SMS sender.
 * Cheaper and more reliable for Kenya than Twilio (~6-10× lower cost,
 * direct Safaricom interconnect).
 *
 * Env vars required: AT_USERNAME, AT_API_KEY
 */

const AT_BASE = "https://api.africastalking.com/version1/messaging";

export async function sendSmsAT(to: string, message: string): Promise<void> {
  const username = process.env.AT_USERNAME;
  const apiKey   = process.env.AT_API_KEY;

  if (!username || !apiKey) {
    throw new Error("AT_USERNAME / AT_API_KEY not configured");
  }

  const body = new URLSearchParams({
    username,
    to,
    message,
  });

  const res = await fetch(AT_BASE, {
    method:  "POST",
    headers: {
      "ApiKey":       apiKey,
      "Accept":       "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Africa's Talking SMS failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { SMSMessageData?: { Recipients?: { status: string }[] } };
  const recipients = json?.SMSMessageData?.Recipients ?? [];
  const failed = recipients.filter((r) => r.status !== "Success");
  if (failed.length > 0 && recipients.length > 0) {
    throw new Error(`AT SMS delivery issue: ${JSON.stringify(failed[0])}`);
  }
}
