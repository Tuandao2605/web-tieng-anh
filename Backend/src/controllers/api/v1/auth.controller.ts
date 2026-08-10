import { Request, Response } from "express";
import { apiAuthService } from "../../../services/apiAuth.service";
import { authService } from "../../../services/auth.service";
import { errorResponse, successResponse } from "../../../utils/response";

export const apiAuthController = {
  register: async (req: Request, res: Response) => {
    try {
      const user = await authService.register(req.body);
      const safeUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
      return successResponse(res, safeUser, "Register Success", 201);
    } catch (error: any) {
      if (error?.code === "P2002") {
        return errorResponse(res, "Email already exists", {}, 409);
      }
      return errorResponse(res, error?.message || "Register failed", {}, 500);
    }
  },
  login: async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const token = await apiAuthService.login({
      email,
      password,
    });

    if (!token) {
      return errorResponse(res, "Email hoac mat khau khong chinh xac", {}, 400);
    }
    return successResponse(res, token, "Login Success");
  },

  profile: (req: Request, res: Response) => {
    return successResponse(res, req.user, "Get user profile success");
  },

  logout: async (req: Request, res: Response) => {
    try {
      const token = req.token as string;
      const userId = req.user?.id as string;

      // Validate dữ liệu
      if (!token || !userId) {
        return res.status(400).json({
          status: "error",
          message: "Thiếu thông tin token",
        });
      }

      // Gọi service để blacklist token
      await apiAuthService.logout(token, userId);

      return successResponse(res, {}, "Logout success");
    } catch {
      return res.status(500).json({
        status: "error",
        message: "Lỗi server khi đăng xuất",
      });
    }
  },
  refreshToken: async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return errorResponse(res, "Provide refresh Token", {}, 400);
    }
    const newToken = await apiAuthService.refreshToken(refreshToken);
    if (!newToken) {
      return errorResponse(res, "Invalid or expired refresh token", {}, 401);
    }
    return successResponse(res, newToken, "Get new token success");
  },
};
