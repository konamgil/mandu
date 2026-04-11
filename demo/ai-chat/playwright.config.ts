import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:3333",
    headless: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
