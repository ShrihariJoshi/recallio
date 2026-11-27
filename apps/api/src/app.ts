import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { csrfProtection } from "./middleware/csrf.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { deckRouter } from "./modules/decks/deck.routes.js";
import { noteRouter } from "./modules/notes/note.routes.js";
import { cardRouter } from "./modules/cards/card.routes.js";
import { reviewRouter } from "./modules/reviews/review.routes.js";
import { importRouter } from "./modules/imports/import.routes.js";
import { statisticsRouter } from "./modules/statistics/statistics.routes.js";
import { syncRouter } from "./modules/sync/sync.routes.js";
import { assessmentRouter } from "./modules/assessments/assessment.routes.js";
import { mediaRouter } from "./modules/assessments/media.routes.js";
import { AppError } from "./shared/errors.js";

export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(csrfProtection);
app.get("/api/v1/health", (_req, res) => res.json({ success: true, data: { status: "ok" } }));
app.use("/api/v1/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }), authRouter);
app.use("/api/v1/decks", deckRouter);
app.use("/api/v1/notes", noteRouter);
app.use("/api/v1/cards", cardRouter);
app.use("/api/v1/reviews", reviewRouter);
app.use("/api/v1/imports", importRouter);
app.use("/api/v1/statistics", statisticsRouter);
app.use("/api/v1/sync", syncRouter);
app.use("/api/v1/media", mediaRouter);
app.use("/api/v1/assessments", assessmentRouter);
app.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND", "This route does not exist.")));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    const fields = Object.fromEntries(error.issues.map((issue) => [issue.path.join("."), issue.message]));
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Check the highlighted fields.", fields } });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
    return;
  }
  console.error(error);
  res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
});
