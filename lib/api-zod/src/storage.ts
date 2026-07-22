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
