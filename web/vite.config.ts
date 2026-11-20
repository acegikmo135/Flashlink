import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 5173,
    // `npm run dev` proxies API/OAuth calls to a local `wrangler dev` (port 8787)
    proxy: { "/api": "http://127.0.0.1:8787", "/oauth": "http://127.0.0.1:8787", "/mcp": "http://127.0.0.1:8787", "/.well-known": "http://127.0.0.1:8787" },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
