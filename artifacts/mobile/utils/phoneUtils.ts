/**
 * Kenya phone number normalisation.
 *
 * Accepts any of the common formats Kenyan users type:
 *   0712 345 678   →  +254712345678
 *   0112 345 678   →  +254112345678
 *   712 345 678    →  +254712345678
 *   254712345678   →  +254712345678
 *   +254712345678  →  +254712345678  (already valid, returned as-is)
 *
 * Returns null when the input cannot be mapped to a valid +254 number.
 */
export function normalizeKenyaPhone(raw: string): string | null {
  // Strip whitespace, dashes, dots, parentheses
  const s = raw.trim().replace(/[\s\-.()]/g, "");

  // Already valid E.164 for Kenya
  if (/^\+254\d{9}$/.test(s)) return s;

  // 254XXXXXXXXX (12 digits, no leading +)
  if (/^254\d{9}$/.test(s)) return "+" + s;

  // 0XXXXXXXXX  — 10 digits, leading 0 (e.g. 0712345678 or 0112345678)
  if (/^0\d{9}$/.test(s)) return "+254" + s.slice(1);

  // XXXXXXXXX — 9 digits, assume Kenya (e.g. 712345678)
  if (/^\d{9}$/.test(s)) return "+254" + s;

  return null;
}

/**
 * Returns a human-friendly display format for a +254 number.
 * e.g. "+254712345678" → "0712 345 678"
 */
export function displayKenyaPhone(e164: string): string {
  if (!e164.startsWith("+254")) return e164;
  const local = "0" + e164.slice(4); // strip +254, add leading 0
  // Format as 07XX XXX XXX
  return local.replace(/^(0\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
}
