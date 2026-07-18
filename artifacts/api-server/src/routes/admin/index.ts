import { Router, type Request, type Response, type NextFunction } from "express";
import { adminAuthMiddleware, loadAdminPermissionsMiddleware, requireFeature } from "../../middleware/adminAuth.js";
import type { FeatureKey } from "@workspace/permissions";
import authRouter from "./auth.js";
import reportsRouter from "./reports.js";
import usersRouter from "./users.js";
import statsRouter from "./stats.js";
import speedZonesRouter from "./speedZones.js";
import auditLogsRouter from "./audit-logs.js";
import notificationsRouter from "./notifications.js";
import subscribersRouter from "./subscribers.js";
import pushCampaignsRouter from "./push-campaigns.js";
import releasesRouter from "./releases.js";
import blogRouter from "./blog.js";
import creatorsRouter from "./creators.js";
import searchRouter from "./search.js";
import settingsRouter from "./settings.js";

const router = Router();

// `router.use(mw, subRouter)` with no path prefix runs `mw` for EVERY
// request that reaches this point in the chain, not just requests that
// subRouter will actually handle — even if subRouter itself is scoped to a
// specific path internally (e.g. speedZonesRouter's routes are all
// "/speed-zones/..."). Without this guard, a request to /admin/audit-logs
// would 403 on the *previous* router's feature check (e.g. "speed_zones")
// before ever reaching auditLogsRouter's own "audit_log" check. Scoping the
// feature check to the same path prefix the sub-router owns makes it a
// no-op for unrelated paths so the chain falls through correctly.
function scopedFeature(pathPrefix: string, feature: FeatureKey) {
  const check = requireFeature(feature);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith(pathPrefix)) return next();
    return check(req, res, next);
  };
}

// Public: login (no auth required)
router.use(authRouter);

// All routes below require a valid admin JWT
router.use(adminAuthMiddleware);

// Re-reads the caller's role + custom permission grants from the database on
// every request and attaches the resolved feature-key set to req.adminUser.
// This is what makes a permission edit in the Team Members page take effect
// immediately, without the affected user needing to log in again.
router.use(loadAdminPermissionsMiddleware);

// Admin endpoints must never be served from the browser's HTTP cache —
// a stale 304 response would hide changes made by mobile users.
// This middleware forces a fresh round-trip on every admin API request.
router.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// Global search: open to every authenticated role, but it checks
// req.adminUser.effectivePermissions itself per section so it never leaks
// results from a section the caller can't view.
router.use(searchRouter);

// Each route group is gated on the feature key it represents. Reports has
// three internal feature keys (reports / reports_bulk / reports_export)
// checked per-route inside reports.ts, so it isn't gated here.
router.use(reportsRouter);
router.use(scopedFeature("/speed-zones", "speed_zones"), speedZonesRouter);
router.use(scopedFeature("/notifications", "notifications"), notificationsRouter);
router.use(scopedFeature("/subscribers", "subscribers"), subscribersRouter);
router.use(scopedFeature("/audit-logs", "audit_log"), auditLogsRouter);
router.use(scopedFeature("/push", "push_campaigns"), pushCampaignsRouter);
router.use(scopedFeature("/releases", "releases"), releasesRouter);
router.use("/blog", requireFeature("blog"), blogRouter);
router.use(scopedFeature("/creators", "creators"), creatorsRouter);
router.use(scopedFeature("/stats", "dashboard"), statsRouter);
router.use(scopedFeature("/users", "team"), usersRouter);
router.use(scopedFeature("/settings", "app_settings"), settingsRouter);

export default router;
