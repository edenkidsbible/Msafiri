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
import shareRouter from "./share.js";
import courseRouter from "./course.js";
import publicSettingsRouter from "./settings.js";
import storageRouter from "./storage.js";
import placesRouter from "./places.js";
import adminMobileRouter from "./admin-mobile.js";
import ttsRouter from "./tts.js";

const router: IRouter = Router();

router.use(placesRouter);
router.use(healthRouter);
router.use(reportsRouter);
router.use(speedZonesRouter);
router.use(pushRouter);
router.use(appVersionRouter);
router.use(blogRouter);
router.use(tripsRouter);
router.use(creatorsRouter);
router.use("/admin", adminRouter);
router.use(shareRouter);
router.use(courseRouter);
router.use(publicSettingsRouter);
router.use(storageRouter);
router.use(adminMobileRouter);
router.use(ttsRouter);

export default router;
