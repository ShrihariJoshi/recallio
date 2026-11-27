import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router, type Response } from "express";
import jwt from "jsonwebtoken";
import { loginSchema, profileUpdateSchema, registerSchema } from "@recallio/contracts";
import { env, isProduction } from "../../config/env.js";
import { authenticate, type AuthenticatedRequest } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { AppError } from "../../shared/errors.js";
import { User } from "./user.model.js";

export const authRouter = Router();
const sessionCookie = "recallio_session";
const csrfCookie = "recallio_csrf";
const cookieOptions = { secure: isProduction, sameSite: "strict" as const, path: "/" };

function publicUser(user: { _id: { toString(): string }; name: string; email: string }) {
  return { id: user._id.toString(), name: user.name, email: user.email };
}

function issueSession(res: Response, userId: string): void {
  const token = jwt.sign({}, env.JWT_SECRET, { subject: userId, expiresIn: "7d", issuer: "recallio" });
  res.cookie(sessionCookie, token, { ...cookieOptions, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.cookie(csrfCookie, randomBytes(32).toString("hex"), { ...cookieOptions, httpOnly: false, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

authRouter.get("/csrf", (_req, res) => {
  const token = randomBytes(32).toString("hex");
  res.cookie(csrfCookie, token, { ...cookieOptions, httpOnly: false });
  res.json({ success: true, data: { csrfToken: token } });
});

authRouter.post("/register", asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const user = await User.create({ name: input.name, email: input.email, passwordHash });
    issueSession(res, user._id.toString());
    res.status(201).json({ success: true, data: { user: publicUser(user) }, message: "Your account is ready." });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      throw new AppError(409, "EMAIL_IN_USE", "An account with this email already exists.");
    }
    throw error;
  }
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await User.findOne({ email: input.email }).select("+passwordHash");
  const valid = user?.passwordHash ? await bcrypt.compare(input.password, user.passwordHash) : false;
  if (!user || !valid) throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  issueSession(res, user._id.toString());
  res.json({ success: true, data: { user: publicUser(user) }, message: "Welcome back." });
}));

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(sessionCookie, { ...cookieOptions, httpOnly: true });
  res.clearCookie(csrfCookie, cookieOptions);
  res.json({ success: true, message: "You’re signed out." });
});

authRouter.get("/me", authenticate, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const user = await User.findById(req.userId);
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  res.json({ success: true, data: { user: publicUser(user) } });
}));

authRouter.patch("/profile", authenticate, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const input = profileUpdateSchema.parse(req.body);
  try {
    const user = await User.findByIdAndUpdate(req.userId, { $set: input }, { new: true, runValidators: true });
    if (!user) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
    res.json({ success: true, data: { user: publicUser(user) }, message: "Your profile has been updated." });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      throw new AppError(409, "EMAIL_IN_USE", "An account with this email already exists.");
    }
    throw error;
  }
}));
