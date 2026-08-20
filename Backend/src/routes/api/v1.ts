import express from "express";
import { validate } from "../../middlewares/validate.middleware";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "../../validators/auth.validator";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { optionalAuthMiddleware } from "../../middlewares/optionalAuth.middleware";
import { apiAuthController } from "../../controllers/api/v1/auth.controller";
import { apiUserController } from "../../controllers/api/v1/users.controller";
import { updateUserSchema } from "../../validators/user.validator";
import { requireSelfUserMiddleware } from "../../middlewares/userAuthorization.middleware";
import { postsController } from "../../controllers/api/v1/posts.controller";
import studyController from "../../controllers/api/v1/study.controller";
import {
  heavyRateLimitMiddleware,
  sensitiveAuthRateLimitMiddleware,
} from "../../middlewares/rateLimit.middleware";
import {
  createSetSchema,
  updateSetSchema,
  addCardsToSetSchema,
  generateQuizSchema,
  submitAnswerSchema,
  submitAnswersSchema,
  syncProgressSchema,
} from "../../validators/study.validator";

const router = express.Router();

// ─── Auth ─────────────────────────────────────────────────────────────────────

router.post(
  "/auth/login",
  sensitiveAuthRateLimitMiddleware,
  validate(loginSchema),
  apiAuthController.login,
);
router.post(
  "/auth/register",
  sensitiveAuthRateLimitMiddleware,
  validate(registerSchema),
  apiAuthController.register,
);
router.post(
  "/auth/forgot-password",
  sensitiveAuthRateLimitMiddleware,
  validate(forgotPasswordSchema),
  apiAuthController.forgotPassword,
);
router.post(
  "/auth/reset-password",
  sensitiveAuthRateLimitMiddleware,
  validate(resetPasswordSchema),
  apiAuthController.resetPassword,
);
router.get("/auth/me", authMiddleware, apiAuthController.profile);
router.delete("/auth/logout", authMiddleware, apiAuthController.logout);
router.post(
  "/auth/refresh-token",
  sensitiveAuthRateLimitMiddleware,
  apiAuthController.refreshToken,
);

// ─── Users ────────────────────────────────────────────────────────────────────

router.get(
  "/users/:id",
  authMiddleware,
  requireSelfUserMiddleware,
  apiUserController.find,
);
router.patch(
  "/users/:id",
  authMiddleware,
  requireSelfUserMiddleware,
  validate(updateUserSchema),
  apiUserController.update,
);
router.delete(
  "/users/:id",
  authMiddleware,
  requireSelfUserMiddleware,
  apiUserController.delete,
);

// ─── Posts ────────────────────────────────────────────────────────────────────

router.get("/posts", optionalAuthMiddleware, postsController.index);
router.post("/posts", authMiddleware, postsController.create);
router.put("/posts", postsController.update);

// ─── Study / Flashcard Sets ───────────────────────────────────────────────────

router.get("/sets", optionalAuthMiddleware, studyController.listSets);
router.post(
  "/sets",
  authMiddleware,
  validate(createSetSchema),
  studyController.createSet,
);
router.get("/sets/:id", optionalAuthMiddleware, studyController.getSet);
router.put(
  "/sets/:id",
  authMiddleware,
  validate(updateSetSchema),
  studyController.updateSet,
);
router.post(
  "/sets/:id/cards/bulk",
  authMiddleware,
  heavyRateLimitMiddleware,
  validate(addCardsToSetSchema),
  studyController.addCardsToSet,
);
router.post(
  "/sets/:id/quiz",
  optionalAuthMiddleware,
  heavyRateLimitMiddleware,
  validate(generateQuizSchema),
  studyController.generateQuiz,
);

// ─── Study Sessions ───────────────────────────────────────────────────────────

router.post(
  "/study/submit-answer",
  authMiddleware,
  validate(submitAnswerSchema),
  studyController.submitAnswer,
);
router.post(
  "/study/submit-answers",
  authMiddleware,
  validate(submitAnswersSchema),
  studyController.submitAnswers,
);
router.post(
  "/study/sync-progress",
  authMiddleware,
  validate(syncProgressSchema),
  studyController.syncProgress,
);

export default router;
