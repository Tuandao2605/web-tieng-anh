import type { ApiAuthService } from "./api-auth.service";
import type { AuthService } from "./auth.service";

export const API_AUTH_SERVICE = Symbol("API_AUTH_SERVICE");
export const AUTH_SERVICE = Symbol("AUTH_SERVICE");
export const MAIL_SERVICE = Symbol("MAIL_SERVICE");

export type { ApiAuthService, AuthService };
