import { Router, type IRouter } from "express";
import healthRouter from "./health";
import reportsRouter from "./reports";
import speedZonesRouter from "./speedZones.js";
import pushRouter from "./push.js";
import appVersionRouter from "./appVersion.js";
import blogRouter from "./blog.js";
import tripsRouter from "./trips.js";
import creatorsRouter from "./creators.js";
import adminRouter from "./admin/index.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(reportsRouter);
router.use(speedZonesRouter);
router.use(pushRouter);
router.use(appVersionRouter);
router.use(blogRouter);
router.use(tripsRouter);
router.use(creatorsRouter);
router.use("/admin", adminRouter);

export default router;
