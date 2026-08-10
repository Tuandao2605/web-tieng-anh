import { Request, Response } from "express";
import { postsService } from "../../../services/posts.service";
import { errorResponse, successResponse } from "../../../utils/response";

export const postsController = {
  index: async (req: Request, res: Response) => {
    const posts = await postsService.getPost(req);

    if (!posts) {
      return errorResponse(res, "Get list post failed", {});
    }
    return successResponse(res, posts, "Get list posts success");
  },
  create: async (req: Request, res: Response) => {
    const user = req.user;
    const post = await postsService.createPost({
      ...req.body,
      user,
    });
    if (!post) {
      return errorResponse(res, "Create post failed", {});
    }
    return successResponse(res, post, "Create post success", 201);
  },
  update: (req: Request, res: Response) => {
    return res.json({});
  },
};
