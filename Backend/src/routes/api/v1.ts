import express from "express";
import { validate } from "../../middlewares/validate.middleware";
import { loginSchema, registerSchema } from "../../validators/auth.validator";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { apiAuthController } from "../../controllers/api/v1/auth.controller";
import { apiUserController } from "../../controllers/api/v1/users.controller";
import {
  createUserSchema,
  updateUserSchema,
} from "../../validators/user.validator";
import { postsController } from "../../controllers/api/v1/posts.controller";
import { optionalAuthMiddleware } from "../../middlewares/optionalAuth.middleware";

const router = express.Router();

router.post("/auth/login", validate(loginSchema), apiAuthController.login);
router.post("/auth/register", validate(registerSchema), apiAuthController.register);
router.get("/auth/me", authMiddleware, apiAuthController.profile);
router.delete("/auth/logout", authMiddleware, apiAuthController.logout);
router.post("/auth/refresh-token", apiAuthController.refreshToken);

router.get("/users", apiUserController.index);
router.post("/users", validate(createUserSchema), apiUserController.create);
router.get("/users/:id", apiUserController.find);
router.patch(
  "/users/:id",
  validate(updateUserSchema),
  apiUserController.update,
);

router.delete("/users/:id", apiUserController.delete);
router.get("/posts", optionalAuthMiddleware, postsController.index);
router.post("/posts", authMiddleware, postsController.create);
router.put("/posts", postsController.update);

// Quizlet / English Study Module Routes
import studyController from "../../controllers/api/v1/study.controller";
import {
  createSetSchema,
  updateSetSchema,
  addCardsToSetSchema,
  generateQuizSchema,
  submitAnswerSchema,
  syncProgressSchema,
} from "../../validators/study.validator";

router.get("/sets", optionalAuthMiddleware, studyController.listSets);
router.post(
  "/sets",
  authMiddleware,
  validate(createSetSchema),
  studyController.createSet
);
router.get("/sets/:id", optionalAuthMiddleware, studyController.getSet);
router.put(
  "/sets/:id",
  authMiddleware,
  validate(updateSetSchema),
  studyController.updateSet
);
router.post(
  "/sets/:id/cards/bulk",
  authMiddleware,
  validate(addCardsToSetSchema),
  studyController.addCardsToSet
);
router.post(
  "/sets/:id/quiz",
  validate(generateQuizSchema),
  studyController.generateQuiz
);
router.post(
  "/study/submit-answer",
  authMiddleware,
  validate(submitAnswerSchema),
  studyController.submitAnswer
);
router.post(
  "/study/sync-progress",
  authMiddleware,
  validate(syncProgressSchema),
  studyController.syncProgress
);

export default router;

