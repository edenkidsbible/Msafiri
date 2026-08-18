import { Router } from "express";
import weeksRouter from "./weeks";
import transactionsRouter from "./transactions";
import tasksRouter from "./tasks";
import contentRouter from "./content";
import fieldRouter from "./field";
import subscriptionsRouter from "./subscriptions";
import teamRouter from "./team";
import settingsRouter from "./settings";
import importsRouter from "./imports";
import invitationsRouter from "./invitations";
import dashboardRouter from "./dashboard";
import chatRouter from "./chat";

const router = Router();

router.use(weeksRouter);
router.use(transactionsRouter);
router.use(tasksRouter);
router.use(contentRouter);
router.use(fieldRouter);
router.use(subscriptionsRouter);
router.use(teamRouter);
router.use(settingsRouter);
router.use(importsRouter);
router.use(invitationsRouter);
router.use(dashboardRouter);
router.use(chatRouter);

export default router;
