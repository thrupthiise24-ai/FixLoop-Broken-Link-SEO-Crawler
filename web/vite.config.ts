import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.FIXLOOP_API_PROXY ?? "http://127.0.0.1:3002";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3001,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/demo": { target: apiTarget, changeOrigin: true },
      "/robots.txt": { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
