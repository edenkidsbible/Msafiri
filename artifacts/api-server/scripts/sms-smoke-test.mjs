#!/usr/bin/env node
/**
 * SMS Carrier Smoke Test — end-to-end via /auth/send-otp
 * ────────────────────────────────────────────────────────
 * Exercises the full application OTP route (POST /auth/send-otp) with real
 * SMSLeopard credentials, targeting one number per Kenyan carrier.  Any
 * non-2xx or error response from the route — which in turn calls SMSLeopard —
 * is captured and printed in full detail.
 *
 * Usage
 * ─────
 *   # Start the API server first, then run:
 *   API_BASE_URL=http://localhost:8080 \
 *   SMOKE_SAFARICOM=+2547XXXXXXXX \
 *   SMOKE_AIRTEL=+2547XXXXXXXX \
 *   SMOKE_TELKOM=+2547XXXXXXXX \
 *   node artifacts/api-server/scripts/sms-smoke-test.mjs
 *
 *   # Or against the deployed API:
 *   API_BASE_URL=https://msafirikenya.com/api \
 *   SMOKE_SAFARICOM=+2547XXXXXXXX ...
 *
 * The "link" intent is used so no existing account backup is required.
 * SMOKE_DEVICE_ID can be set to a fixed string; defaults to "smoke-test-device".
 *
 * After the script exits you must confirm receipt manually on each handset and
 * that a valid code verifies via POST /auth/verify-otp.  Record results in
 * CARRIER_TEST_LOG.md (a blank template is printed on --init).
 *
 * Exit codes
 * ──────────
 *   0 — all tested carriers received { ok: true } from the route
 *   1 — one or more carriers failed, or no target numbers supplied
 *
 * Manual verification checklist
 * ─────────────────────────────
 * After a successful script run, for each carrier:
 *   [ ] SMS received on handset within 60 s
 *   [ ] Code in SMS matches devOtp in dev response (dev mode only)
 *   [ ] POST /auth/verify-otp with the received code returns { ok: true }
 *   [ ] POST /auth/verify-otp with a wrong code returns 401
 */

const CARRIERS = [
  { name: "Safaricom", env: "SMOKE_SAFARICOM" },
  { name: "Airtel",    env: "SMOKE_AIRTEL"    },
  { name: "Telkom",    env: "SMOKE_TELKOM"    },
];

// ── Carrier detection (mirrors smsleopard.ts) ─────────────────────────────────

function detectCarrier(number) {
  const local = number.replace(/^\+254/, "0").replace(/^254/, "0");
  if (/^0(7[012]\d|74[0-3]|79\d|11\d)/.test(local)) return "Safaricom";
  if (/^0(73\d|74[4-9]|75\d|78\d|10\d)/.test(local))  return "Airtel";
  if (/^07[67]\d/.test(local))                           return "Telkom";
  return "unknown carrier";
}

// ── POST /auth/send-otp via the real application route ────────────────────────

async function testCarrier(apiBase, phone, deviceId) {
  const carrier = detectCarrier(phone);
  const url     = `${apiBase}/auth/send-otp`;

  const body = JSON.stringify({ phone, intent: "link", deviceId });

  let httpStatus = null;
  let rawBody    = null;
  let json       = null;

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    httpStatus = res.status;
    rawBody    = await res.text();

    try { json = JSON.parse(rawBody); } catch { /* not JSON */ }

    if (!res.ok) {
      return {
        carrier,
        phone,
        passed:   false,
        error:    `HTTP ${httpStatus} from /auth/send-otp`,
        detail:   rawBody,
        json,
        devOtp:   json?.devOtp ?? null,
      };
    }

    if (!json?.ok) {
      return {
        carrier,
        phone,
        passed:   false,
        error:    `Route returned ok:false — ${json?.error ?? "(no error field)"}`,
        detail:   rawBody,
        json,
        devOtp:   json?.devOtp ?? null,
      };
    }

    return {
      carrier,
      phone,
      passed:   true,
      error:    null,
      detail:   "Route returned { ok: true }",
      json,
      devOtp:   json?.devOtp ?? null,
    };
  } catch (err) {
    return {
      carrier,
      phone,
      passed:   false,
      error:    `Network error reaching ${url}: ${err.message}`,
      detail:   rawBody ?? "(no body)",
      json:     null,
      devOtp:   null,
    };
  }
}

// ── Print a blank CARRIER_TEST_LOG.md template ────────────────────────────────

function printLogTemplate(date) {
  console.log(`
# Carrier Test Log — ${date}

| Carrier   | Number         | API ok | SMS received | Code verified |
|-----------|----------------|--------|--------------|---------------|
| Safaricom | +2547XXXXXXXX  | [ ]    | [ ]          | [ ]           |
| Airtel    | +2547XXXXXXXX  | [ ]    | [ ]          | [ ]           |
| Telkom    | +2547XXXXXXXX  | [ ]    | [ ]          | [ ]           |

## Notes
-
`.trim());
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes("--init")) {
    printLogTemplate(new Date().toISOString().slice(0, 10));
    return;
  }

  const apiBase  = (process.env.API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const deviceId = process.env.SMOKE_DEVICE_ID ?? "smoke-test-device";

  const targets = CARRIERS
    .map((c) => ({ ...c, phone: process.env[c.env] }))
    .filter((c) => c.phone);

  if (targets.length === 0) {
    console.error(
      "✗ No target phone numbers supplied.\n" +
      "  Set at least one of: SMOKE_SAFARICOM, SMOKE_AIRTEL, SMOKE_TELKOM"
    );
    process.exit(1);
  }

  const date = new Date().toISOString();
  console.log(`\nMsafiri Kenya — OTP SMS carrier smoke test`);
  console.log(`  API base    : ${apiBase}`);
  console.log(`  Device ID   : ${deviceId}`);
  console.log(`  Carriers    : ${targets.map((t) => t.name).join(", ")}`);
  console.log(`  Time (UTC)  : ${date}`);
  console.log("─".repeat(60));

  const results = await Promise.all(
    targets.map(({ phone }) => testCarrier(apiBase, phone, deviceId))
  );

  let anyFailed = false;

  for (const r of results) {
    if (r.passed) {
      const devNote = r.devOtp ? `  [DEV OTP: ${r.devOtp}]` : "";
      console.log(`✓  ${r.carrier.padEnd(10)} ${r.phone}  →  ${r.detail}${devNote}`);
    } else {
      anyFailed = true;
      console.error(`✗  ${r.carrier.padEnd(10)} ${r.phone}  →  ${r.error}`);
      console.error(`   Detail  : ${r.detail}`);
      if (r.json) {
        console.error(`   Full response:`);
        console.error("   " + JSON.stringify(r.json, null, 2).replace(/\n/g, "\n   "));
      }
    }
  }

  console.log("─".repeat(60));
  const passed = results.filter((r) => r.passed).length;
  console.log(`Route result: ${passed}/${results.length} carrier(s) returned { ok: true }\n`);

  if (anyFailed) {
    console.error("One or more carriers failed at the route/SMSLeopard layer.\n");
    process.exit(1);
  }

  // Print manual-receipt checklist
  console.log("Next: confirm handset receipt and code verification for each carrier.");
  console.log("Run with --init to generate a CARRIER_TEST_LOG.md template.\n");
  console.log("Checklist (complete manually for each carrier):");
  for (const r of results) {
    const devNote = r.devOtp ? ` (dev OTP: ${r.devOtp})` : "";
    console.log(`  ${r.carrier.padEnd(10)} ${r.phone}${devNote}`);
    console.log(`    [ ] SMS received on handset within 60 s`);
    console.log(`    [ ] POST /auth/verify-otp with received code → { ok: true }`);
    console.log(`    [ ] POST /auth/verify-otp with wrong code   → 401`);
  }
  console.log();
}

main();
