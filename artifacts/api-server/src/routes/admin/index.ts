import { Router } from "express";
import { adminAuthMiddleware, adminOnlyMiddleware, adminOrModeratorMiddleware } from "../../middleware/adminAuth.js";
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

const router = Router();

// Public: login (no auth required)
router.use(authRouter);

// All routes below require a valid admin JWT
router.use(adminAuthMiddleware);

// Staff, moderator, and admin: reports and speed zones
router.use(reportsRouter);
router.use(speedZonesRouter);

// Moderator and admin: bulk/export, notifications, subscribers, audit logs, push campaigns, blog, creators
router.use(adminOrModeratorMiddleware, notificationsRouter);
router.use(adminOrModeratorMiddleware, subscribersRouter);
router.use(adminOrModeratorMiddleware, auditLogsRouter);
router.use(adminOrModeratorMiddleware, pushCampaignsRouter);
router.use(adminOrModeratorMiddleware, releasesRouter);
router.use("/blog", adminOrModeratorMiddleware, blogRouter);
router.use(adminOrModeratorMiddleware, creatorsRouter);

// Admin only: stats and user management
router.use(adminOnlyMiddleware, statsRouter);
router.use(adminOnlyMiddleware, usersRouter);

export default router;
