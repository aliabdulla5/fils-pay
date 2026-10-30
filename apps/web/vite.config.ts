import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // apps/api sends no CORS headers, so in dev the browser talks to this
  // origin and Vite forwards /v1 to the api. .env.development blanks
  // VITE_API_BASE_URL so client.ts issues same-origin requests.
  // API_PROXY_TARGET overrides the target when the api runs on another PORT.
  server: {
    port: 5173,
    proxy: {
      "/v1": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
});
