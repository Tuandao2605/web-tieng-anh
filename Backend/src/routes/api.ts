import express from "express";

import routerV1 from "./api/v1";
import { rateLimitMiddleware } from "../middlewares/rateLimit.middleware";
const router = express.Router();

router.use(rateLimitMiddleware);
router.use("/v1", routerV1);

export default router;
