/**
 * pgDump.ts — pg_dump → Cloudflare R2 backup utility.
 *
 * Runs pg_dump against DATABASE_URL (the same database the server is
 * connected to) and uploads the result to R2 under the `db-backups/`
 * prefix.  Each file is an independent, self-contained binary dump
 * (custom format) that can be restored with pg_restore.
 *
 * Key: db-backups/YYYY-MM-DD_HH-mm-ss.dump
 *
 * Usage:
 *   const key = await dumpToR2();   // throws on pg_dump or upload failure
 *
 * Requires: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *           DATABASE_URL (always set by Replit for the managed PG database)
 */

import { spawn } from "child_process";
import { uploadBuffer, isR2Configured } from "./r2Storage.js";
import { logger } from "./logger.js";

// ── Internal helpers ──────────────────────────────────────────────────────────

/** ISO-style filename-safe timestamp: "2026-08-15_23-05-12" */
function timestampTag(): string {
  const now = new Date();
  return now.toISOString()
    .replace("T", "_")
    .replace(/:/g, "-")
    .slice(0, 19);  // "YYYY-MM-DD_HH-mm-ss"
}

/**
 * Runs pg_dump --format=custom against the given connection URL and collects
 * its stdout into a Buffer.  Rejects if pg_dump exits with a non-zero code.
 */
function runPgDump(databaseUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    // --no-password   — never prompt; rely on URL-embedded credentials
    // --format=custom — compressed binary format; allows selective restore
    // --no-privileges — skip GRANT/REVOKE (managed DB handles permissions)
    // --no-owner      — skip SET OWNER statements (not portable across envs)
    const proc = spawn("pg_dump", [
      "--no-password",
      "--format=custom",
      "--no-privileges",
      "--no-owner",
      databaseUrl,
    ]);

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

    proc.stderr.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      // pg_dump writes connection info to stderr even on success; only warn on
      // lines that look like errors (contain "error" or "fatal" case-insensitive).
      if (/error|fatal/i.test(line)) {
        logger.warn({ line }, "[pgDump] pg_dump stderr warning");
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`pg_dump exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn pg_dump: ${err.message}`));
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DumpResult {
  /** R2 object key for the uploaded dump, e.g. "db-backups/2026-08-15_23-05-12.dump" */
  key:       string;
  /** Size of the dump in bytes */
  sizeBytes: number;
  /** Wall-clock time taken in ms */
  durationMs: number;
}

/**
 * Runs pg_dump and uploads the result to R2.
 * Returns metadata about the uploaded dump.
 * Throws if R2 is not configured, pg_dump fails, or the upload fails.
 */
export async function dumpToR2(): Promise<DumpResult> {
  if (!isR2Configured()) {
    throw new Error("R2 credentials not configured — cannot upload database dump");
  }

  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not set — cannot run pg_dump");
  }

  const tag   = timestampTag();
  const key   = `db-backups/${tag}.dump`;
  const start = Date.now();

  logger.info({ key }, "[pgDump] Starting pg_dump…");

  const buffer = await runPgDump(databaseUrl);
  const sizeBytes = buffer.length;

  logger.info({ key, sizeBytes }, "[pgDump] pg_dump complete, uploading to R2…");

  await uploadBuffer(key, buffer, "application/octet-stream");

  const durationMs = Date.now() - start;
  logger.info({ key, sizeBytes, durationMs }, "[pgDump] Upload complete");

  return { key, sizeBytes, durationMs };
}

/**
 * Best-effort wrapper: runs dumpToR2() but never throws.
 * Returns the result on success, null on failure.
 * Use this in scheduled jobs where a backup failure must not crash the server.
 */
export async function tryDumpToR2(): Promise<DumpResult | null> {
  try {
    return await dumpToR2();
  } catch (err) {
    logger.error({ err }, "[pgDump] Dump or upload failed — skipping");
    return null;
  }
}
