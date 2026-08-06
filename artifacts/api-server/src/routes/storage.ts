import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response, type NextFunction } from 'express';
import { Readable } from 'stream';
import jwt from 'jsonwebtoken';

import type { AdminJwtPayload } from '../middleware/adminAuth.js';
import * as r2 from '../lib/r2Storage.js';
import {
  buildUploadKey,
  canAccessR2Object,
  normalizePrincipalId,
  objectPathToR2Key,
  r2KeyToObjectPath,
  ObjectPermission,
} from '../lib/r2ObjectAcl.js';
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage.js';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

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
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS (Replit Object Storage).
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
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

      // Owner-keyed ACL check (no I/O — resolved from key segments).
      // Normalize the principal ID to UUID format so it matches the owner
      // segment that was normalized the same way at upload time.
      const allowed = await canAccessR2Object({
        key: r2Key,
        userId: normalizePrincipalId(principal.id),
        requestedPermission: ObjectPermission.READ,
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

    // ── Legacy path: Replit Object Storage ────────────────────────────────────
    try {
      const objectFile =
        await objectStorageService.getObjectEntityFile(objectPath);

      const response = await objectStorageService.downloadObject(objectFile);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        req.log.warn({ err: error }, 'Object not found');
        res.status(404).json({ error: 'Object not found' });
        return;
      }
      req.log.error({ err: error }, 'Error serving legacy object');
      res.status(500).json({ error: 'Failed to serve object' });
    }
  },
);

export default router;
