/**
 * Kenya phone number normalisation — server-side copy.
 * Kept in sync with artifacts/mobile/utils/phoneUtils.ts.
 */
export function normalizeKenyaPhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s\-.()]/g, "");

  if (/^\+254\d{9}$/.test(s)) return s;
  if (/^254\d{9}$/.test(s)) return "+" + s;
  if (/^0\d{9}$/.test(s)) return "+254" + s.slice(1);
  if (/^\d{9}$/.test(s)) return "+254" + s;

  return null;
}
