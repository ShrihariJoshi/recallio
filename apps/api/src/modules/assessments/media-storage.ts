import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";

export type MediaStorageProvider = "filesystem" | "s3";
const localRoot = resolve(process.cwd(), env.MEDIA_STORAGE_DIR);
let client: S3Client | undefined;

export function mediaStorageProvider(): MediaStorageProvider { return env.MEDIA_STORAGE_PROVIDER; }

function getS3(): S3Client {
  if (!env.MEDIA_S3_ENDPOINT || !env.MEDIA_S3_BUCKET || !env.MEDIA_S3_ACCESS_KEY_ID || !env.MEDIA_S3_SECRET_ACCESS_KEY) {
    throw new Error("S3 media storage is missing required configuration.");
  }
  client ??= new S3Client({
    region: "auto",
    endpoint: env.MEDIA_S3_ENDPOINT,
    credentials: { accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID, secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY },
  });
  return client;
}

export async function putMedia(key: string, content: Buffer, contentType: string): Promise<void> {
  if (env.MEDIA_STORAGE_PROVIDER === "s3") {
    await getS3().send(new PutObjectCommand({ Bucket: env.MEDIA_S3_BUCKET!, Key: key, Body: content, ContentType: contentType }));
    return;
  }
  await mkdir(localRoot, { recursive: true });
  await writeFile(resolve(localRoot, key), content, { flag: "wx", mode: 0o600 });
}

export async function getMedia(key: string, provider: MediaStorageProvider): Promise<Buffer> {
  if (provider === "s3") {
    const result = await getS3().send(new GetObjectCommand({ Bucket: env.MEDIA_S3_BUCKET!, Key: key }));
    if (!result.Body) throw new Error("Stored image has no content.");
    return Buffer.from(await result.Body.transformToByteArray());
  }
  return readFile(resolve(localRoot, key));
}

export async function deleteMedia(key: string, provider: MediaStorageProvider): Promise<void> {
  if (provider === "s3") {
    await getS3().send(new DeleteObjectCommand({ Bucket: env.MEDIA_S3_BUCKET!, Key: key }));
    return;
  }
  await unlink(resolve(localRoot, key)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}
