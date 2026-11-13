import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, forward /api to the Node server (run `node server.js` in another terminal).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3000" } },
});
