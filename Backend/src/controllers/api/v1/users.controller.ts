import { Request, Response } from "express";
import { usersService } from "../../../services/users.service";
import { errorResponse, successResponse } from "../../../utils/response";

export const apiUserController = {
  index: async (req: Request, res: Response) => {
    const data = await usersService.getUsers(req);
    if (data) {
      const { users, count, page } = data;
      return successResponse(res, users, "Get List Users Success", 200, {
        total: count,
        currentPage: page,
      });
    }
  },
  find: async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = await usersService.getUser(id as string, req);
    if (!user) {
      return errorResponse(res, "User not found", {}, 404);
    }
    return successResponse(res, user, "Get User Detail Success");
  },
  create: async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const user = await usersService.createUser(body);

      return successResponse(res, user, "Create User Success");
    } catch (error: any) {
      if (error.message === "Email already exists") {
        return errorResponse(res, error.message, {}, 409);
      }

      return errorResponse(res, "Server Error", {}, 500);
    }
  },
  update: async (req: Request, res: Response) => {
    const body = req.body;
    const { id } = req.params;
    if (!id) {
      return errorResponse(res, "User id is required", {}, 400);
    }
    if (id.length < 24 || id.length > 24) {
      return errorResponse(res, "Invalid user id", {}, 400);
    }
    const user = await usersService.updateUser(body, id as string);
    return successResponse(res, user, "Update User Success");
  },
  delete: async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = await usersService.deleteUser(id as string);
    return successResponse(res, user, "Delete User Success");
  },
};
