import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: process.env.PW_CHANNEL || "chrome",
    headless: false,
    viewport: { width: 1440, height: 960 },
  },
  workers: 1,
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
});
