/**
 * TOTP helpers — wraps otplib v13 functional API.
 *
 * Algorithm : SHA-1 (Google Authenticator default)
 * Digits    : 6
 * Period    : 30 s
 * Tolerance : ±30 s — absorbs one-step clock skew
 *
 * otplib v13 ships NobleCryptoPlugin + ScureBase32Plugin as built-in defaults,
 * so we call the functional exports directly with no manual plugin wiring.
 */
import {
  generateSecret as _generateSecret,
  generateURI,
  verifySync,
} from "otplib/functional";
import QRCode from "qrcode";

const APP_NAME = "Msafiri Ops";

/** Generate a fresh base32 secret ready to be stored in the DB. */
export function generateTotpSecret(): string {
  return _generateSecret();
}

/**
 * Build the otpauth:// URI that authenticator apps scan.
 * @param email  The admin user's email — shown as the account label.
 * @param secret The base32 secret stored in the DB.
 */
export function buildOtpAuthUrl(email: string, secret: string): string {
  return generateURI({
    label: email,
    issuer: APP_NAME,
    secret,
    algorithm: "sha1",
    digits: 6,
    period: 30,
  });
}

/**
 * Render an otpauth:// URI as a base64 PNG data URL for embedding in <img>.
 */
export async function buildQrCodeDataUrl(otpAuthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUrl, { errorCorrectionLevel: "M", margin: 2 });
}

/**
 * Verify a 6-digit TOTP code against a stored secret.
 * Returns true when the code is valid within ±30 s of the current step.
 */
export function verifyTotpCode(code: string, secret: string): boolean {
  try {
    const result = verifySync({
      token: code.trim(),
      secret,
      algorithm: "sha1",
      digits: 6,
      period: 30,
      epochTolerance: 30,
    });
    return result.valid;
  } catch {
    return false;
  }
}
