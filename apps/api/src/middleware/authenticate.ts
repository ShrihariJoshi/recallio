import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../shared/errors.js";

declare global {
  namespace Express { interface Request { userId?: string } }
}
export type AuthenticatedRequest = Request;

export function authenticate(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const token = req.cookies?.recallio_session;
  if (!token) return next(new AppError(401, "UNAUTHENTICATED", "Please sign in to continue."));
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === "string" || typeof payload.sub !== "string") throw new Error("Invalid session");
    req.userId = payload.sub;
    next();
  } catch {
    next(new AppError(401, "UNAUTHENTICATED", "Your session has expired. Please sign in again."));
  }
}
