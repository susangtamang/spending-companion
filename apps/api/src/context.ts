import type { Identity } from "./ports.js";

declare global {
  namespace Express {
    interface Request {
      identity?: Identity;
      userId?: string;
      requestId?: string;
    }
  }
}

export {};
