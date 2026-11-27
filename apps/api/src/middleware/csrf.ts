import type { NextFunction, Request, Response } from "express";
import { AppError } from "../shared/errors.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (safeMethods.has(req.method)) return next();
  const cookieToken = req.cookies?.recallio_csrf;
  const headerToken = req.get("x-csrf-token");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(new AppError(403, "CSRF_REJECTED", "Refresh the page and try again."));
  }
  next();
}
