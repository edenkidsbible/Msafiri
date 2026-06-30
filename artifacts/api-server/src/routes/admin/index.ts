import { Router } from "express";
import { adminAuthMiddleware, adminOnlyMiddleware } from "../../middleware/adminAuth.js";
import authRouter from "./auth.js";
import reportsRouter from "./reports.js";
import usersRouter from "./users.js";
import statsRouter from "./stats.js";

const router = Router();

// Public: login (no auth required)
router.use(authRouter);

// All routes below require a valid admin JWT
router.use(adminAuthMiddleware);

router.use(reportsRouter);

// Stats and users management: admin role only
router.use(adminOnlyMiddleware, statsRouter);
router.use(adminOnlyMiddleware, usersRouter);

export default router;
