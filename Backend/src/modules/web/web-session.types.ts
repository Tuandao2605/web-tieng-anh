import type { IncomingMessage } from "node:http";

export type WebSessionUser = {
  id: string;
  name: string | null;
  email: string;
};

export type WebSessionData = {
  user?: WebSessionUser;
  csrfToken?: string;
  _flash?: Record<string, string[]>;
};

export type WebSession = WebSessionData & {
  regenerate(callback: (error?: Error) => void): void;
  save(callback: (error?: Error) => void): void;
  destroy(callback: (error?: Error) => void): void;
};

export type WebFlash = {
  (type: string): string[];
  (type: string, message: string): number;
};

export type WebIncomingMessage = IncomingMessage & {
  session: WebSession;
  flash: WebFlash;
};
