import { Router } from "express";
import { z } from "zod";
import { authenticate, type AuthenticatedRequest } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { AppError } from "../../shared/errors.js";
import { ensureReviewStateMigration } from "../reviews/review.service.js";
import { getDashboardStatistics } from "./statistics.service.js";

const querySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(7),
  timeZone: z.string().trim().min(1).max(80).default("UTC"),
});

export const statisticsRouter = Router();
statisticsRouter.use(authenticate);

statisticsRouter.get("/dashboard", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const { days, timeZone } = querySchema.parse(req.query);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new AppError(400, "INVALID_TIME_ZONE", "Choose a valid time zone.");
  }
  await ensureReviewStateMigration(req.userId!);
  const statistics = await getDashboardStatistics(req.userId!, timeZone, days);
  res.json({ success: true, data: statistics });
}));
