import { z } from "zod";

/**
 * Request body for POST /storage/uploads/request-url
 */
export const RequestUploadUrlBody = z.object({
  name: z.string().min(1),
  size: z.number().int().positive(),
  contentType: z.string().min(1),
});
export type RequestUploadUrlBodyType = z.infer<typeof RequestUploadUrlBody>;

/**
 * Response shape for POST /storage/uploads/request-url
 */
export const RequestUploadUrlResponse = z.object({
  uploadURL: z.string().url(),
  objectPath: z.string().min(1),
  metadata: z.object({
    name: z.string(),
    size: z.number(),
    contentType: z.string(),
  }),
});
export type RequestUploadUrlResponseType = z.infer<typeof RequestUploadUrlResponse>;

/**
 * Request body for POST /storage/uploads/confirm
 *
 * Called by the client after a successful PUT to the presigned upload URL.
 * Writes ownership + visibility metadata to the R2 object so that the
 * GET /storage/objects/* ACL can enforce cross-admin sharing rules.
 */
export const ConfirmUploadBody = z.object({
  objectPath: z.string().min(1),
  visibility: z.enum(["public", "private"]).default("private"),
});
export type ConfirmUploadBodyType = z.infer<typeof ConfirmUploadBody>;

/**
 * Response shape for POST /storage/uploads/confirm
 *
 * `publicUrl` is included when visibility="public". It points to the
 * unauthenticated /storage/r2-public-objects/* route and may be embedded
 * directly in public pages (blog featured images, etc.) without requiring
 * admin credentials.
 */
export const ConfirmUploadResponse = z.object({
  success: z.literal(true),
  /** Unauthenticated public URL — only present when visibility="public". */
  publicUrl: z.string().optional(),
});
export type ConfirmUploadResponseType = z.infer<typeof ConfirmUploadResponse>;
