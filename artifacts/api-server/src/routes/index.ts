import { Router, type IRouter } from "express";
import healthRouter from "./health";
import reportsRouter from "./reports";
import speedZonesRouter from "./speedZones.js";
import pushRouter from "./push.js";
import appVersionRouter from "./appVersion.js";
import adminRouter from "./admin/index.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(reportsRouter);
router.use(speedZonesRouter);
router.use(pushRouter);
router.use(appVersionRouter);
router.use("/admin", adminRouter);

export default router;
