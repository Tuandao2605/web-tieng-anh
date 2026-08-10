import express from "express";
import { homeController } from "../controllers/home.controller";
import { authController } from "../controllers/auth.controller";

import { guestMiddleware } from "../middlewares/guest.middleware";
import { registerSchema } from "../validators/auth.validator";
import { validate } from "../middlewares/validate.middleware";
import { authMiddleware } from "../middlewares/auth.middleware";
import { optionalAuthMiddleware } from "../middlewares/optionalAuth.middleware";
const router = express.Router();

router.use(optionalAuthMiddleware);

router.get("/", homeController.index);

router.get("/auth/login", guestMiddleware, authController.login);
router.get("/auth/register", guestMiddleware, authController.register);

router.post("/auth/login", guestMiddleware, authController.handleLogin);
router.post(
  "/auth/register",
  guestMiddleware,
  validate(registerSchema),
  authController.handleRegister,
);

router.get("/auth/me", authMiddleware, authController.profile);
router.post("/auth/logout", authMiddleware, authController.logout);
router.get("/test-redis", homeController.testRedis);
router.get("/test-mq", homeController.testMq);
export default router;
