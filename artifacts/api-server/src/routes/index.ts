import { Router, type IRouter } from "express";
import healthRouter from "./health";
import assessmentRouter from "./assessment";
import authRouter from "./auth";
import liveRouter from "./live-discovery";
import gatewayRouter from "./gateway";
import teamAuthRouter from "./team-auth";
import { teamPlatformGate } from "../lib/team-auth";
import featuresRouter from "./features";
import { featureGate } from "../lib/features";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(teamAuthRouter);
router.use("/v1",teamPlatformGate);
router.use(featuresRouter);
router.use(featureGate);
router.use(liveRouter);
router.use(gatewayRouter);
router.use(assessmentRouter);

export default router;
