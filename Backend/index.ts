declare module "http" {
  interface IncomingMessage {
    user?: {
      id: string;
      name: string | null;
      email: string;
      status?: boolean;
    };
  }
}
