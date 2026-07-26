/**
 * apns.ts — Minimal APNs HTTP/2 client for Live Activity remote push updates.
 *
 * Live Activity pushes are NOT routable through the Expo Push Service;
 * they must be sent directly to APNs using apns-push-type: liveactivity.
 *
 * Required environment variables:
 *   APNS_KEY_ID   — 10-character Key ID from the Apple Developer Portal
 *   APNS_TEAM_ID  — 10-character Team ID from the Apple Developer Portal
 *   APNS_AUTH_KEY — PEM-encoded ES256 private key content of the .p8 file
 *                   (newlines can be replaced with \n literals)
 *
 * If any of these variables are absent the module logs a warning and
 * silently skips the push — so the rest of the ping flow continues.
 */

import { createSign, createPrivateKey } from "crypto";
import { connect as http2Connect } from "http2";
import { logger } from "./logger.js";

const BUNDLE_ID  = "com.msafirikenya.app";
const APNS_HOST  = "api.push.apple.com";
/** Live Activity APNs topic — must match the app's bundle ID */
const APNS_TOPIC = `${BUNDLE_ID}.push-type.liveactivity`;

// ── JWT cache ─────────────────────────────────────────────────────────────────
// APNs JWTs expire after 60 minutes.  We cache and reuse the token to avoid
// signing overhead on every ping (drivers ping every 8 seconds).
let _jwtCache: { token: string; expiresAt: number } | null = null;

function buildJwt(keyId: string, teamId: string, authKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);

  // Reuse if still valid for at least another 5 minutes
  if (_jwtCache && _jwtCache.expiresAt > now + 300) {
    return _jwtCache.token;
  }

  const header  = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = b64url(JSON.stringify({ iss: teamId, iat: now }));
  const data    = `${header}.${payload}`;

  const key = createPrivateKey({ key: authKeyPem, format: "pem" });
  const signer = createSign("SHA256");
  signer.update(data);
  // APNs expects the P-1363 raw r||s signature, not DER
  const sig = signer.sign({ dsaEncoding: "ieee-p1363", key } as Parameters<typeof signer.sign>[0]);
  const jwt = `${data}.${sig.toString("base64url")}`;

  // Cache for 55 minutes (APNs accepts up to 60)
  _jwtCache = { token: jwt, expiresAt: now + 55 * 60 };
  return jwt;
}

function b64url(str: string): string {
  return Buffer.from(str).toString("base64url");
}

// ── Live Activity ContentState payload ────────────────────────────────────────

export interface LiveActivityContentState {
  speedKmh:        number;
  speedLimitKmh:   number | null;
  nextInstruction: string | null;
  distToNextM:     number | null;
  destinationName: string | null;
  isSharingTrip:   boolean;
  /** Unix timestamp (seconds) — widget shows stale indicator when >15 s old */
  lastUpdatedAt:   number;
}

// ── Main push function ────────────────────────────────────────────────────────

/**
 * Send a Live Activity remote update to the given APNs push token.
 * Fire-and-forget — awaits completion internally but never throws; errors
 * are logged so they don't bubble up into the ping response.
 */
export async function pushLiveActivityUpdate(
  pushTokenHex: string,
  contentState: LiveActivityContentState
): Promise<void> {
  const keyId      = process.env.APNS_KEY_ID;
  const teamId     = process.env.APNS_TEAM_ID;
  const authKeyRaw = process.env.APNS_AUTH_KEY;

  if (!keyId || !teamId || !authKeyRaw) {
    // Credentials not yet configured — log once at debug level and bail.
    logger.debug("Live Activity push skipped: APNS_KEY_ID / APNS_TEAM_ID / APNS_AUTH_KEY not set");
    return;
  }

  // Support both real newlines and escaped \n in the env var value
  const authKeyPem = authKeyRaw.replace(/\\n/g, "\n");

  let jwt: string;
  try {
    jwt = buildJwt(keyId, teamId, authKeyPem);
  } catch (err) {
    logger.error({ err }, "Failed to build APNs JWT — check APNS_AUTH_KEY format");
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const apnsPayload = JSON.stringify({
    aps: {
      timestamp:       nowSeconds,
      event:           "update",
      "content-state": {
        speedKmh:        contentState.speedKmh,
        speedLimitKmh:   contentState.speedLimitKmh ?? null,
        nextInstruction: contentState.nextInstruction ?? null,
        distToNextM:     contentState.distToNextM ?? null,
        destinationName: contentState.destinationName ?? null,
        isSharingTrip:   contentState.isSharingTrip,
        lastUpdatedAt:   contentState.lastUpdatedAt,
      },
    },
  });

  try {
    await sendHttp2Push({
      host:    APNS_HOST,
      path:    `/3/device/${pushTokenHex}`,
      jwt,
      topic:   APNS_TOPIC,
      payload: apnsPayload,
    });
  } catch (err) {
    logger.warn({ err, pushTokenHex: pushTokenHex.slice(0, 8) + "…" }, "APNs Live Activity push failed");
  }
}

// ── HTTP/2 transport ──────────────────────────────────────────────────────────

interface PushOptions {
  host:    string;
  path:    string;
  jwt:     string;
  topic:   string;
  payload: string;
}

function sendHttp2Push(opts: PushOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = http2Connect(`https://${opts.host}`, {
      // Each push opens a fresh connection; keep-alive is not critical
      // for the low-frequency (8 s) ping rate in this app.
    });

    client.on("error", (err) => {
      client.close();
      reject(err);
    });

    const body = Buffer.from(opts.payload, "utf8");

    const req = client.request({
      ":method":          "POST",
      ":path":            opts.path,
      ":scheme":          "https",
      ":authority":       opts.host,
      "authorization":    `bearer ${opts.jwt}`,
      "apns-push-type":   "liveactivity",
      "apns-topic":       opts.topic,
      "apns-priority":    "10",
      "content-type":     "application/json",
      "content-length":   body.length.toString(),
    });

    req.write(body);
    req.end();

    let statusCode = 0;
    let responseBody = "";

    req.on("response", (headers) => {
      statusCode = Number(headers[":status"] ?? 0);
    });

    req.setEncoding("utf8");
    req.on("data", (chunk: string) => { responseBody += chunk; });

    req.on("end", () => {
      client.close();
      if (statusCode === 200) {
        resolve();
      } else {
        reject(new Error(`APNs responded ${statusCode}: ${responseBody.slice(0, 200)}`));
      }
    });

    req.on("error", (err) => {
      client.close();
      reject(err);
    });
  });
}
