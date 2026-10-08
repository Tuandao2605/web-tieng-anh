import type { postsService } from "../../services/posts.service";

export const POSTS_SERVICE = Symbol("POSTS_SERVICE");
export type PostsService = typeof postsService;
