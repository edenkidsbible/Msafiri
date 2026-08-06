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

import { S3Client, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "stream";

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
 *  upload directly to R2 without the API server acting as a proxy.
 *  When contentType is given, it becomes part of the signature and the client
 *  must send a matching Content-Type header; omit it to allow any type. */
export async function getPresignedUploadUrl(key: string, contentType?: string): Promise<string> {
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ...(contentType ? { ContentType: contentType } : {}),
  });
  return getSignedUrl(client, command, { expiresIn: 900 }); // 15 min
}

/** Server-side upload of a Buffer (generated PDFs, cached TTS audio, etc). */
export async function uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void> {
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
}

/** Existence check. Returns metadata when the object exists, null otherwise. */
export async function headObject(
  key: string,
): Promise<{ size: number; contentType?: string } | null> {
  const client = getClient();
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }));
    return { size: Number(res.ContentLength ?? 0), contentType: res.ContentType };
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey") {
      return null;
    }
    throw err;
  }
}

/** Streaming download, with optional HTTP Range (e.g. "bytes=0-1023"). */
export async function getObjectStream(
  key: string,
  range?: string,
): Promise<{ body: Readable; contentLength: number; contentType?: string; contentRange?: string }> {
  const client = getClient();
  const res = await client.send(new GetObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ...(range ? { Range: range } : {}),
  }));
  return {
    body: res.Body as Readable,
    contentLength: Number(res.ContentLength ?? 0),
    contentType: res.ContentType,
    contentRange: res.ContentRange,
  };
}

/** Download an object fully into a Buffer. */
export async function downloadAsBuffer(key: string): Promise<Buffer> {
  const { body } = await getObjectStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
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
