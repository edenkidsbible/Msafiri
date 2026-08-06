/**
 * r2Storage.ts — Cloudflare R2 storage client (S3-compatible).
 *
 * Used exclusively for dashcam clip uploads. Separate from the existing
 * Replit-sidecar GCS objectStorage.ts so the two systems are independent.
 *
 * R2 credentials required:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *
 * If credentials are missing, isConfigured() returns false and callers should
 * return 503 rather than crash.
 */

import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

function getClient(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID!;
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const BUCKET = () => process.env.R2_BUCKET_NAME!;

/** Generate a presigned PUT URL valid for 15 minutes so the mobile client can
 *  upload directly to R2 without the API server acting as a proxy. */
export async function getPresignedUploadUrl(key: string): Promise<string> {
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ContentType: "video/mp4",
  });
  return getSignedUrl(client, command, { expiresIn: 900 }); // 15 min
}

/** Generate a presigned GET URL valid for 1 hour so the mobile client can
 *  stream or download a locked clip for sharing / playback. */
export async function getPresignedDownloadUrl(key: string): Promise<string> {
  const client = getClient();
  const command = new GetObjectCommand({
    Bucket: BUCKET(),
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: 3600 }); // 1 hour
}

/** Delete an object from R2 (e.g. when the user deletes a locked clip). */
export async function deleteObject(key: string): Promise<void> {
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
}

/** Build the canonical R2 key for a dashcam clip. */
export function clipKey(deviceId: string, clipId: string): string {
  return `dashcam/${deviceId}/${clipId}.mp4`;
}
