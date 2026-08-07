/**
 * R2 upload utility for the admin UI.
 *
 * Three-step flow:
 *  1. POST /api/storage/uploads/request-url  → presigned PUT URL + objectPath
 *  2. PUT  <presigned URL>                   → file bytes directly to R2
 *  3. POST /api/storage/uploads/confirm      → write ACL metadata to the object
 *
 * The confirm step stores owner + visibility metadata on the R2 object.
 * For public objects the server also returns a `publicUrl` pointing to the
 * unauthenticated /api/storage/r2-public-objects/* route — use that URL
 * wherever the file must be accessible without admin credentials (e.g. blog
 * featured images shown to marketing site visitors).
 */

import { getToken } from "@/lib/auth";

const API_BASE = "/api";

interface UploadResult {
  /** Server-relative objectPath for internal references. */
  objectPath: string;
  /**
   * Unauthenticated public URL — only present when visibility="public".
   * Embed this in public pages (blog, marketing) instead of downloadUrl.
   */
  publicUrl?: string;
  /**
   * Authenticated proxy URL (requires admin JWT).
   * Only for private files viewed within the admin panel.
   */
  downloadUrl: string;
}

interface UploadOptions {
  /** Defaults to "private". */
  visibility?: "public" | "private";
  /** Called with a 0–1 progress value during the PUT (best-effort). */
  onProgress?: (progress: number) => void;
}

/**
 * Upload a File to R2 through the three-step presigned-URL flow and return
 * the objectPath (for storage) and a download URL (for immediate display).
 *
 * Throws on any step failure with a human-readable message.
 */
export async function uploadToR2(
  file: File,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const { visibility = "private", onProgress } = options;
  const token = getToken();
  const authHeaders = { Authorization: `Bearer ${token}` };

  // ── Step 1: Request presigned PUT URL ──────────────────────────────────────
  const requestRes = await fetch(`${API_BASE}/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!requestRes.ok) {
    const err = await requestRes.json().catch(() => ({}));
    throw new Error((err as any).error ?? `Failed to get upload URL (${requestRes.status})`);
  }
  const { uploadURL, objectPath } = (await requestRes.json()) as {
    uploadURL: string;
    objectPath: string;
  };

  // ── Step 2: PUT file directly to R2 ───────────────────────────────────────
  // Use XMLHttpRequest when an onProgress callback is provided so we can
  // report upload progress. Otherwise use a plain fetch.
  if (onProgress) {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadURL);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`R2 PUT failed (${xhr.status})`)));
      xhr.onerror = () => reject(new Error("R2 PUT network error"));
      xhr.send(file);
    });
  } else {
    const putRes = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!putRes.ok) throw new Error(`R2 PUT failed (${putRes.status})`);
  }
  onProgress?.(1);

  // ── Step 3: Confirm upload — writes ACL metadata to the R2 object ─────────
  const confirmRes = await fetch(`${API_BASE}/storage/uploads/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ objectPath, visibility }),
  });
  if (!confirmRes.ok) {
    const err = await confirmRes.json().catch(() => ({}));
    throw new Error((err as any).error ?? `Failed to confirm upload (${confirmRes.status})`);
  }
  const confirmData = (await confirmRes.json()) as { success: boolean; publicUrl?: string };

  // Derive the authenticated proxy URL (admin-only, for previewing private uploads).
  const strippedPath = objectPath.startsWith("/objects")
    ? objectPath.slice("/objects".length)
    : objectPath;
  const downloadUrl = `${API_BASE}/storage/objects${strippedPath}`;

  return {
    objectPath,
    publicUrl: confirmData.publicUrl,
    downloadUrl,
  };
}
