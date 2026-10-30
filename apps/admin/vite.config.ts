import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // apps/web already owns 5173.
    // 5174 clashes with storybook on my machine — am
    port: 5174,
    // Same as apps/web: same-origin /v1 requests proxied to apps/api, which
    // sends no CORS headers. See .env.development.
    proxy: {
      "/v1": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
});
