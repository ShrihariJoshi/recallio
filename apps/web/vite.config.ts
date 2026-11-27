import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envDir: "../../",
  server: { port: 5173 },
  build: { rollupOptions: { output: { manualChunks(id) { if (id.includes("/node_modules/dexie/")) return "storage"; if (id.includes("/node_modules/dompurify/")) return "sanitizer"; } } } },
});
