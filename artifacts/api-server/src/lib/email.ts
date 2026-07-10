import { Resend } from "resend";
import { logger } from "./logger.js";

function getClient(): Resend | null {
  const key = process.env["RESEND_API_KEY"];
  if (!key) {
    logger.warn("RESEND_API_KEY not set — email sending disabled");
    return null;
  }
  return new Resend(key);
}

const FROM = process.env["RESEND_FROM"] ?? "Msafiri Kenya <noreply@msafirikenya.com>";

export async function sendCreatorPromoCode(opts: {
  toEmail:  string;
  toName:   string | null;
  code:     string;
  platform: "ios" | "android";
}): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  const greeting = opts.toName ? `Hi ${opts.toName},` : "Hi there,";

  const redeemUrl =
    opts.platform === "ios"
      ? "https://apps.apple.com/redeem"
      : "https://play.google.com/redeem";

  const platformLabel =
    opts.platform === "ios" ? "Apple App Store" : "Google Play";

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#111;max-width:520px;margin:0 auto;padding:24px;">
  <p style="font-size:22px;font-weight:700;margin-bottom:4px;">You're a Msafiri Creator! 🎉</p>
  <p>${greeting}</p>
  <p>
    Your application to the <strong>Msafiri Creator Program</strong> has been approved.
    Here is your promo code for <strong>1 month of free Msafiri Access</strong>:
  </p>
  <div style="background:#f4f4f4;border-radius:10px;padding:18px 24px;margin:20px 0;text-align:center;">
    <span style="font-size:26px;font-weight:700;letter-spacing:3px;">${opts.code}</span>
  </div>
  <p>
    To redeem it, open the ${platformLabel} on your device and go to:<br/>
    <a href="${redeemUrl}" style="color:#0070f3;">${redeemUrl}</a>
  </p>
  <p>
    Or open the Msafiri app, go to <strong>Settings → Msafiri Creator Program</strong>
    and tap <em>Redeem Promo Code</em>.
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0;"/>
  <p style="color:#666;font-size:13px;">
    Thank you for helping keep Kenya's roads safer.<br/>
    — The Msafiri Team
  </p>
</body>
</html>`;

  const text = [
    greeting,
    "",
    "Your Msafiri Creator application has been approved!",
    "",
    `Your promo code: ${opts.code}`,
    "",
    `Redeem at: ${redeemUrl}`,
    "",
    "Thank you,",
    "The Msafiri Team",
  ].join("\n");

  try {
    const { error } = await client.emails.send({
      from:    FROM,
      to:      opts.toEmail,
      subject: "You're a Msafiri Creator — here's your free month",
      html,
      text,
    });

    if (error) {
      logger.error({ error }, "Resend returned an error sending creator promo code email");
      return false;
    }

    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send creator promo code email via Resend");
    return false;
  }
}
