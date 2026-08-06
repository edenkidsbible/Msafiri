/**
 * r2ObjectAcl.ts — Owner-keyed ACL for R2 upload objects.
 *
 * Equivalent to objectAcl.ts (which stores ACL in GCS object custom metadata),
 * but for R2 objects. Ownership is encoded directly in the key path so that
 * no extra metadata round-trip is needed during a presigned-URL upload flow:
 *
 *   R2 key format:  uploads/<ownerId>/<uuid>
 *   objectPath:    /objects/uploads/<ownerId>/<uuid>
 *
 * Access control semantics mirror objectAcl.ts:
 *   - Public objects are readable by anyone.
 *   - Private objects are readable/writable only by the owner (ownerId match).
 *   - ACL rules (group-based access) can be added in the future.
 *
 * Visibility metadata is stored as S3 object metadata on the R2 object after
 * the client upload completes, using a server-side HeadObject + CopyObject
 * trick (setR2ObjectAclPolicy). For the common private-upload case this step
 * is optional because the owner check is sufficient.
 */

import { createHash, randomUUID } from 'crypto';
import {
  S3Client,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';

// RFC 4122 UUID (lowercase hex with dashes).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Re-export the same ObjectPermission enum so callers don't need two imports ──
export enum ObjectPermission {
  READ = 'read',
  WRITE = 'write',
}

export interface R2AclPolicy {
  owner: string;
  visibility: 'public' | 'private';
}

// ── Key helpers ────────────────────────────────────────────────────────────────

/**
 * Normalise any principal identifier to a deterministic UUID so the R2 key
 * always has UUID-formatted segments (required for parseUploadKeyOwner to
 * accept the key and for objectPathToR2Key to classify it as R2).
 *
 * - If `id` is already an RFC-4122 UUID it is returned lowercased unchanged.
 * - Otherwise a stable UUID is derived from a SHA-256 hash of the id.  The
 *   same principal always produces the same UUID, so upload and download
 *   checks remain consistent even when the session identity is not a UUID.
 *
 * This must be applied to the principal ID in BOTH the upload path (when
 * building the key) and the access-check path (when comparing to the owner
 * segment from the key).
 */
export function normalizePrincipalId(id: string): string {
  if (UUID_RE.test(id)) return id.toLowerCase();
  // Derive a deterministic UUID v4-shaped value from SHA-256(id).
  const h = createHash('sha256').update(id).digest('hex');
  return (
    `${h.slice(0, 8)}-${h.slice(8, 12)}-` +
    `4${h.slice(13, 16)}-` +
    `${(['8', '9', 'a', 'b'] as const)[parseInt(h[16], 16) & 3]}${h.slice(17, 20)}-` +
    `${h.slice(20, 32)}`
  );
}

/** Build a fresh R2 key for an upload owned by `ownerId`.
 *  The ownerId is normalised to UUID format so the key is always parseable. */
export function buildUploadKey(ownerId: string): string {
  return `uploads/${normalizePrincipalId(ownerId)}/${randomUUID()}`;
}

/**
 * Extract the ownerId encoded in a new-format R2 upload key.
 *
 * Valid key:  uploads/<ownerId-UUID>/<object-UUID>   (exactly 3 segments)
 * Legacy GCS: uploads/<object-UUID>                  (2 segments) → returns null
 *
 * Both UUID segments must match RFC 4122 format so that a legacy
 * two-segment key like "uploads/<uuid>" is never mistaken for R2.
 */
export function parseUploadKeyOwner(key: string): string | null {
  const parts = key.split('/');
  // Must be exactly ["uploads", "<ownerId>", "<uuid>"]
  if (parts.length !== 3 || parts[0] !== 'uploads') return null;
  if (!UUID_RE.test(parts[1]) || !UUID_RE.test(parts[2])) return null;
  return parts[1];
}

/**
 * Return true when the key is an R2 upload key in the new three-segment format:
 *   uploads/<ownerId-UUID>/<object-UUID>
 * Legacy GCS-backed keys (uploads/<uuid>) return false.
 */
export function isNewR2UploadKey(key: string): boolean {
  return parseUploadKeyOwner(key) !== null;
}

/** Convert a server-relative objectPath → R2 key, or null if unrecognised.
 *  Only returns the key for new R2 paths so legacy GCS paths fall through.
 *  "/objects/uploads/<ownerId>/<uuid>" → "uploads/<ownerId>/<uuid>"
 *  "/objects/uploads/<uuid>"           → null  (legacy, route to GCS) */
export function objectPathToR2Key(objectPath: string): string | null {
  if (!objectPath.startsWith('/objects/')) return null;
  const candidate = objectPath.slice('/objects/'.length);
  return isNewR2UploadKey(candidate) ? candidate : null;
}

/** Convert an R2 key → server-relative objectPath.
 *  "uploads/<ownerId>/<uuid>" → "/objects/uploads/<ownerId>/<uuid>" */
export function r2KeyToObjectPath(key: string): string {
  return `/objects/${key}`;
}

// ── ACL policy (stored as R2 object metadata) ─────────────────────────────────

const META_VISIBILITY = 'x-amz-meta-visibility';
const META_OWNER = 'x-amz-meta-owner';

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID!;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const BUCKET = () => process.env.R2_BUCKET_NAME!;

/**
 * Set (or update) the ACL policy on an R2 object.
 *
 * R2/S3 does not support updating object metadata in-place; the only way is a
 * server-side copy from the object onto itself with the new metadata.
 */
export async function setR2ObjectAclPolicy(
  key: string,
  policy: R2AclPolicy,
): Promise<void> {
  const client = getR2Client();
  const bucket = BUCKET();

  // Read existing metadata so we preserve ContentType etc.
  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  );

  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: key,
      CopySource: `${bucket}/${key}`,
      MetadataDirective: 'REPLACE',
      ContentType: head.ContentType ?? 'application/octet-stream',
      Metadata: {
        ...(head.Metadata ?? {}),
        owner: policy.owner,
        visibility: policy.visibility,
      },
    }),
  );
}

/**
 * Read the ACL policy stored in R2 object metadata.
 * Returns null when the object has no ACL metadata set.
 */
export async function getR2ObjectAclPolicy(
  key: string,
): Promise<R2AclPolicy | null> {
  const client = getR2Client();
  const head = await client.send(
    new HeadObjectCommand({ Bucket: BUCKET(), Key: key }),
  );

  const owner = head.Metadata?.[META_OWNER] ?? head.Metadata?.['owner'];
  const visibility =
    head.Metadata?.[META_VISIBILITY] ?? head.Metadata?.['visibility'];

  if (!owner) return null;

  return {
    owner,
    visibility: visibility === 'public' ? 'public' : 'private',
  };
}

// ── Access control ─────────────────────────────────────────────────────────────

/**
 * Determine whether `userId` may perform `requestedPermission` on an R2 upload
 * object.
 *
 * Primary check: owner encoded in the key path (cheap, no network call).
 * If the key has no encoded owner, falls back to the object metadata policy.
 *
 * Matches objectAcl.ts semantics:
 *  - Public objects → READ allowed for everyone.
 *  - Owner → all permissions allowed.
 *  - Otherwise → denied.
 */
export async function canAccessR2Object({
  key,
  userId,
  requestedPermission,
  policy,
}: {
  key: string;
  userId?: string;
  requestedPermission: ObjectPermission;
  /** Pass a pre-fetched policy to avoid a second HeadObject call. */
  policy?: R2AclPolicy | null;
}): Promise<boolean> {
  // 1. Key-path ownership check (no I/O).
  //    New R2 keys encode the owner as the second path segment.
  //    When a valid owner IS encoded:
  //      - Owner match → allow immediately.
  //      - Owner mismatch → deny immediately (no metadata fallback).
  //    This avoids a spurious HeadObject call on every rejected access.
  const keyOwner = parseUploadKeyOwner(key);
  if (keyOwner !== null) {
    return userId !== undefined && keyOwner === userId;
  }

  // 2. Metadata policy fallback — for objects without an owner in the key
  //    (e.g. objects written by setR2ObjectAclPolicy after the fact).
  const resolvedPolicy =
    policy !== undefined ? policy : await getR2ObjectAclPolicy(key);
  if (!resolvedPolicy) return false;

  if (
    resolvedPolicy.visibility === 'public' &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) return false;
  return resolvedPolicy.owner === userId;
}
