import type { usersService } from "../../services/users.service";

export const USERS_SERVICE = Symbol("USERS_SERVICE");
export type UsersService = typeof usersService;
