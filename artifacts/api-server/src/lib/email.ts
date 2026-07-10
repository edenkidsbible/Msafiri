import nodemailer from "nodemailer";
import { logger } from "./logger.js";

function getTransporter() {
  const host = process.env["SMTP_HOST"];
  const port = Number(process.env["SMTP_PORT"] ?? "587");
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

const FROM = process.env["SMTP_FROM"] ?? "Msafiri Kenya <noreply@msafirikenya.com>";

export async function sendCreatorPromoCode(opts: {
  toEmail: string;
  toName:  string | null;
  code:    string;
  platform: "ios" | "android";
}): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    logger.warn("SMTP not configured — skipping creator promo code email");
    return false;
  }

  const greeting = opts.toName ? `Hi ${opts.toName},` : "Hi there,";

  const redeemUrl =
    opts.platform === "ios"
      ? "https://apps.apple.com/redeem"
      : "https://play.google.com/redeem";

  const platformLabel = opts.platform === "ios" ? "Apple App Store" : "Google Play";

  const html = `
<!DOCTYPE html>
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
    Or open the Msafiri app, go to <strong>Settings → Msafiri Creator Program</strong> and tap <em>Redeem Promo Code</em>.
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0;"/>
  <p style="color:#666;font-size:13px;">
    Thank you for helping keep Kenya's roads safer.<br/>
    — The Msafiri Team
  </p>
</body>
</html>`;

  const text = `${greeting}\n\nYour Msafiri Creator application has been approved!\n\nYour promo code: ${opts.code}\n\nRedeem at: ${redeemUrl}\n\nThank you,\nThe Msafiri Team`;

  try {
    await transporter.sendMail({
      from: FROM,
      to:   opts.toEmail,
      subject: "You're a Msafiri Creator — here's your free month",
      html,
      text,
    });
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send creator promo code email");
    return false;
  }
}
