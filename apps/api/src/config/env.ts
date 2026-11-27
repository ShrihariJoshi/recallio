import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: resolve(workspaceRoot, ".env") });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  MEDIA_STORAGE_DIR: z.string().default("./storage/media"),
  MEDIA_STORAGE_PROVIDER: z.enum(["filesystem", "s3"]).default("filesystem"),
  MEDIA_S3_ENDPOINT: z.string().url().optional(),
  MEDIA_S3_BUCKET: z.string().min(1).optional(),
  MEDIA_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  MEDIA_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.MEDIA_STORAGE_PROVIDER === "s3") {
    for (const key of ["MEDIA_S3_ENDPOINT", "MEDIA_S3_BUCKET", "MEDIA_S3_ACCESS_KEY_ID", "MEDIA_S3_SECRET_ACCESS_KEY"] as const) {
      if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: "Required when MEDIA_STORAGE_PROVIDER=s3." });
    }
  }
});

export const env = schema.parse(process.env);
export const isProduction = env.NODE_ENV === "production";
