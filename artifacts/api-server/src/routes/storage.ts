import {
  ConfirmUploadBody,
  ConfirmUploadResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import type { AdminJwtPayload } from '../middleware/adminAuth.js';
import * as r2 from '../lib/r2Storage.js';
import {
  buildUploadKey,
  canAccessR2Object,
  getR2ObjectAclPolicy,
  normalizePrincipalId,
  objectPathToR2Key,
  parseUploadKeyOwner,
  r2KeyToObjectPath,
  setR2ObjectAclPolicy,
} from '../lib/r2ObjectAcl.js';

/**
 * MIME types allowed for public R2 uploads (blog images, press assets).
 *
 * Restricted to safe raster image formats so an attacker cannot upload
 * HTML/JS/SVG and exploit the unauthenticated public-objects endpoint as a
 * same-origin stored-XSS vector against other admin users.
 */
const PUBLIC_UPLOAD_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
]);

const router: IRouter = Router();

// ── Auth helpers ───────────────────────────────────────────────────────────────

/**
 * Normalised principal extracted from whichever auth mechanism is active.
 * Keeps the storage route independent of any single auth scheme.
 */
interface StoragePrincipal {
  id: string;
}

/**
 * Middleware that silently attempts to verify an admin JWT and, when valid,
 * attaches `req.adminUser` exactly as `adminAuthMiddleware` would.
 * Unlike `adminAuthMiddleware` it does NOT return 401 on failure — callers
 * that have a session-based identity still proceed.
 */
function optionalAdminAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      const secret = process.env.ADMIN_JWT_SECRET;
      if (secret) {
        const payload = jwt.verify(token, secret) as AdminJwtPayload;
        (req as any).adminUser = payload;
      }
    } catch {
      // Invalid / expired token — fall through to session check.
    }
  }
  next();
}

/**
 * Extract a stable owner ID from the request, trying mechanisms in order:
 *
 *  1. Admin JWT (attached by `optionalAdminAuth` above).
 *  2. Passport-style session (`req.isAuthenticated()` + `req.user.id`).
 *     Preserved for backward-compatibility with callers that use the
 *     application's session-based auth rather than an admin token.
 *
 * Returns null when no authenticated identity can be established.
 */
function extractStoragePrincipal(req: Request): StoragePrincipal | null {
  // 1. Admin JWT.
  const adminUser = (req as any).adminUser as AdminJwtPayload | undefined;
  if (adminUser?.id) return { id: adminUser.id };

  // 2. Passport/session-based auth (preserved for non-admin callers).
  if (
    'isAuthenticated' in req &&
    typeof req.isAuthenticated === 'function' &&
    req.isAuthenticated()
  ) {
    const sessionUser = (req as any).user as { id?: string } | undefined;
    if (sessionUser?.id) return { id: sessionUser.id };
  }

  return null;
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned R2 URL for a direct client-to-R2 file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned PUT URL.
 *
 * Authentication: accepts an admin JWT Bearer token OR an application
 * session-based principal (Passport-compatible).  The authenticated principal's
 * stable ID is encoded in the R2 key so that the GET /storage/objects/*
 * endpoint can enforce per-object owner-keyed access control (equivalent to
 * objectAcl.ts on GCS).
 *
 * Key format:  uploads/<principalId-UUID>/<object-UUID>
 * objectPath:  /objects/uploads/<principalId-UUID>/<object-UUID>
 */
router.post(
  '/storage/uploads/request-url',
  optionalAdminAuth,
  async (req: Request, res: Response) => {
    const principal = extractStoragePrincipal(req);
    if (!principal) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!r2.isR2Configured()) {
      res.status(503).json({ error: 'Object storage not configured' });
      return;
    }

    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;

      // Build an owner-keyed R2 key that encodes the uploader's identity.
      const key = buildUploadKey(principal.id);
      const uploadURL = await r2.getPresignedUploadUrl(key, contentType);
      const objectPath = r2KeyToObjectPath(key);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating R2 upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * POST /storage/uploads/confirm
 *
 * Called by the client after a successful PUT to the presigned R2 URL.
 * Writes ownership + visibility metadata onto the R2 object so that:
 *  - The GET /storage/objects/* ACL can serve the file to its owner.
 *  - Public objects can be served unauthenticated via /storage/r2-public-objects/*.
 *
 * Only the key-path owner may call this endpoint.  No role-based overrides
 * are provided — admins are ordinary users with respect to object storage.
 */
router.post(
  '/storage/uploads/confirm',
  optionalAdminAuth,
  async (req: Request, res: Response) => {
    const principal = extractStoragePrincipal(req);
    if (!principal) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!r2.isR2Configured()) {
      res.status(503).json({ error: 'Object storage not configured' });
      return;
    }

    const parsed = ConfirmUploadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid fields' });
      return;
    }

    const { objectPath, visibility } = parsed.data;
    const r2Key = objectPathToR2Key(objectPath);
    if (!r2Key) {
      res.status(400).json({ error: 'Invalid objectPath — must be a new-format R2 path' });
      return;
    }

    // Only the key-path owner may confirm their own object.
    const keyOwner = parseUploadKeyOwner(r2Key);
    const normalizedCallerId = normalizePrincipalId(principal.id);
    if (keyOwner !== normalizedCallerId) {
      res.status(403).json({ error: 'Forbidden — you are not the owner of this object' });
      return;
    }

    // For public uploads: server-side MIME allowlist check via HeadObject.
    // Prevents an attacker from requesting a public URL for HTML/JS/SVG and
    // using the unauthenticated endpoint as a same-origin stored XSS vector.
    if (visibility === 'public') {
      let objectMeta: { size: number; contentType?: string } | null;
      try {
        objectMeta = await r2.headObject(r2Key);
      } catch {
        res.status(500).json({ error: 'Could not read uploaded object' });
        return;
      }
      if (!objectMeta) {
        res.status(404).json({ error: 'Object not found — upload may not have completed' });
        return;
      }
      const mimeType = (objectMeta.contentType ?? '').toLowerCase().split(';')[0].trim();
      if (!PUBLIC_UPLOAD_ALLOWED_MIME.has(mimeType)) {
        res.status(415).json({
          error: `Public uploads must be a supported image format. Received: ${mimeType || 'unknown'}`,
        });
        return;
      }
    }

    try {
      await setR2ObjectAclPolicy(r2Key, {
        owner: normalizedCallerId,
        visibility,
      });

      // For public objects return the unauthenticated URL so callers can embed
      // it directly in public pages without routing through the auth proxy.
      const publicUrl =
        visibility === 'public'
          ? `/api/storage/r2-public-objects/${r2Key}`
          : undefined;

      res.json(ConfirmUploadResponse.parse({ success: true, publicUrl }));
    } catch (error) {
      req.log.error({ err: error }, 'Error setting R2 ACL policy');
      res.status(500).json({ error: 'Failed to confirm upload' });
    }
  },
);

/**
 * GET /storage/r2-public-objects/*
 *
 * Unauthenticated endpoint for R2 objects that were confirmed with
 * visibility="public".  Reads the object's metadata ACL and only serves
 * the file when the stored visibility is "public".  Private objects return
 * 403 so an attacker cannot enumerate objects by guessing keys.
 *
 * This endpoint is intentionally unauthenticated so public blog images,
 * press assets, etc. can be embedded in marketing pages without requiring
 * admin credentials.
 */
router.get(
  '/storage/r2-public-objects/*path',
  async (req: Request, res: Response) => {
    if (!r2.isR2Configured()) {
      res.status(503).json({ error: 'Object storage not configured' });
      return;
    }

    const raw = req.params.path;
    const r2Key = Array.isArray(raw) ? raw.join('/') : raw;

    // Only serve objects with a server-confirmed public ACL.
    let policy;
    try {
      policy = await getR2ObjectAclPolicy(r2Key);
    } catch {
      res.status(404).json({ error: 'Object not found' });
      return;
    }

    if (!policy || policy.visibility !== 'public') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    try {
      const { body, contentLength, contentType } = await r2.getObjectStream(r2Key);

      // Security headers — always set before streaming.
      // nosniff: prevent browsers from MIME-sniffing away from the declared type.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Public objects can be cached aggressively by CDN / browser.
      res.setHeader('Cache-Control', 'public, max-age=86400');

      // Only serve allowed image MIME types.  The confirm endpoint already
      // enforces the allowlist at write time; this re-check defends against
      // objects that bypassed the confirm step (e.g. pre-existing uploads).
      const mime = (contentType ?? '').toLowerCase().split(';')[0].trim();
      if (!PUBLIC_UPLOAD_ALLOWED_MIME.has(mime)) {
        // Force download with a generic safe type so the browser never renders it.
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment');
        if (contentLength) res.setHeader('Content-Length', String(contentLength));
        body.pipe(res);
        return;
      }

      if (contentType) res.setHeader('Content-Type', contentType);
      if (contentLength) res.setHeader('Content-Length', String(contentLength));
      // Safe image — serve inline so browsers display it without a download prompt.
      res.setHeader('Content-Disposition', 'inline');

      body.pipe(res);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to serve object' });
      }
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve private object entities.  Authentication accepts an admin JWT Bearer
 * token OR an application session-based principal (Passport-compatible).
 *
 * New objects (uploaded via the R2 presigned-URL flow above) are stored in R2
 * under keys of the form "uploads/<principalId-UUID>/<object-UUID>".  The
 * objectPath stored client-side is "/objects/uploads/<principalId-UUID>/<uuid>".
 * This endpoint:
 *   1. Requires an authenticated principal (admin JWT or session).
 *   2. Enforces per-object owner ACL: only the principal whose UUID is encoded
 *      in the key may download (equivalent to objectAcl.ts owner check on GCS).
 *
 * Legacy objects (two-segment key "uploads/<uuid>", normalised by the old
 * `normalizeObjectEntityPath`) are routed to Replit Object Storage so existing
 * references remain valid during the transition period.
 */
router.get(
  '/storage/objects/*path',
  optionalAdminAuth,
  async (req: Request, res: Response) => {
    const principal = extractStoragePrincipal(req);
    if (!principal) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // ── R2 path: /objects/uploads/<principalId-UUID>/<object-UUID> ────────────
    // objectPathToR2Key returns non-null ONLY for the new three-segment format.
    // Two-segment legacy GCS paths (uploads/<uuid>) return null and fall
    // through to Replit Object Storage below.
    const r2Key = objectPathToR2Key(objectPath);
    if (r2Key !== null) {
      if (!r2.isR2Configured()) {
        res.status(503).json({ error: 'Object storage not configured' });
        return;
      }

      // Strict key-path ownership check (synchronous, no I/O).
      // Only the encoded key-path owner may access the file here.
      // Public objects must use the unauthenticated /storage/r2-public-objects/*
      // route — key-path mismatch is an unconditional deny even if the object
      // has visibility="public" metadata, preventing non-owner bypass via the
      // public-visibility flag.
      const allowed = canAccessR2Object({
        key: r2Key,
        userId: normalizePrincipalId(principal.id),
      });
      if (!allowed) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      // Existence check before streaming; headObject returns null on 404.
      let meta: { size: number; contentType?: string } | null;
      try {
        meta = await r2.headObject(r2Key);
      } catch (error) {
        req.log.error({ err: error }, 'Error checking R2 object existence');
        res.status(500).json({ error: 'Failed to serve object' });
        return;
      }

      if (!meta) {
        res.status(404).json({ error: 'Object not found' });
        return;
      }

      try {
        const { body, contentLength, contentType } =
          await r2.getObjectStream(r2Key);

        if (contentType) res.setHeader('Content-Type', contentType);
        if (contentLength) res.setHeader('Content-Length', String(contentLength));
        res.setHeader('Cache-Control', 'private, max-age=3600');

        body.pipe(res);
      } catch (error) {
        req.log.error({ err: error }, 'Error streaming R2 object');
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to serve object' });
        }
      }
      return;
    }

    // No legacy GCS fallback — Replit Object Storage has been retired.
    // All objects were migrated to R2; unknown paths return 404.
    res.status(404).json({ error: 'Object not found' });
  },
);

export default router;
