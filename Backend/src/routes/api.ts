import express from "express";

import routerV1 from "./api/v1";
import { rateLimitMiddleware } from "../middlewares/rateLimit.middleware";
import { validate } from "../middlewares/validate.middleware";
import { searchPublicDecksSchema } from "../validators/study.validator";
import studyController from "../controllers/api/v1/study.controller";
const router = express.Router();

router.use(rateLimitMiddleware);
router.get(
  "/decks/public/search",
  validate(searchPublicDecksSchema),
  studyController.searchPublicDecks,
);
router.use("/v1", routerV1);

export default router;
