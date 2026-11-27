import { createHash, randomUUID } from "node:crypto";
import multer from "multer";
import { Router } from "express";
import { authenticate, type AuthenticatedRequest } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { AppError } from "../../shared/errors.js";
import { MediaAsset } from "./assessment.models.js";
import { deleteMedia, getMedia, mediaStorageProvider, putMedia } from "./media-storage.js";

export const mediaRouter = Router();
mediaRouter.use(authenticate);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

function imageType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return "image/gif";
  return null;
}

mediaRouter.post("/", upload.single("file"), asyncHandler(async (req: AuthenticatedRequest, res) => {
  const file = req.file;
  if (!file) throw new AppError(400, "IMAGE_REQUIRED", "Choose an image to upload.");
  const mimeType = imageType(file.buffer);
  if (!mimeType) throw new AppError(400, "UNSUPPORTED_IMAGE", "Use a JPEG, PNG, WebP, or GIF image.");
  const storageKey = `${randomUUID()}.${mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1]}`;
  const storageProvider = mediaStorageProvider();
  await putMedia(storageKey, file.buffer, mimeType);
  try {
    const asset = await MediaAsset.create({
      userId: req.userId,
      storageKey,
      storageProvider,
      mimeType,
      sizeBytes: file.size,
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
      originalName: file.originalname.slice(0, 180),
    });
    res.status(201).json({ success: true, data: { asset: { id: String(asset._id), mimeType, sizeBytes: file.size, url: `/api/v1/media/${asset._id}` } } });
  } catch (error) {
    await deleteMedia(storageKey, storageProvider).catch(() => undefined);
    throw error;
  }
}));

mediaRouter.get("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const assetId = req.params.id;
  if (typeof assetId !== "string" || !/^[a-f\d]{24}$/i.test(assetId)) throw new AppError(404, "MEDIA_NOT_FOUND", "This image could not be found.");
  const asset = await MediaAsset.findOne({ _id: assetId, userId: req.userId }).lean();
  if (!asset) throw new AppError(404, "MEDIA_NOT_FOUND", "This image could not be found.");
  try {
    const content = await getMedia(asset.storageKey, asset.storageProvider ?? "filesystem");
    res.set({ "Content-Type": asset.mimeType, "Content-Length": String(content.byteLength), "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" });
    res.end(content);
  } catch {
    throw new AppError(404, "MEDIA_NOT_FOUND", "This image could not be found.");
  }
}));
