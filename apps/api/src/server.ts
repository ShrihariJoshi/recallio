import { app } from "./app.js";
import { connectDatabase } from "./config/database.js";
import { env } from "./config/env.js";

await connectDatabase();
const server = app.listen(env.API_PORT, () => console.info(`Recallio API listening on :${env.API_PORT}`));

async function shutdown(): Promise<void> {
  server.close();
  const mongoose = await import("mongoose");
  await mongoose.default.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
