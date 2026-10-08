import type { apiAuthService } from "../../services/apiAuth.service";
import type { authService } from "../../services/auth.service";

export const API_AUTH_SERVICE = Symbol("API_AUTH_SERVICE");
export const AUTH_SERVICE = Symbol("AUTH_SERVICE");

export type ApiAuthService = typeof apiAuthService;
export type AuthService = typeof authService;
