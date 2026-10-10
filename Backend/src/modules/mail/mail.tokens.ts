import type { MailService } from "./mail.service";

export const MAIL_SERVICE = Symbol("MAIL_SERVICE");
export type MailProvider = MailService;
