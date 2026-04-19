import { defineConfig } from "@playwright/test";

/**
 * Phase 7.2 Agent B — dedicated Playwright config for Fast Refresh /
 * HDR tests.
 *
 * Unlike `playwright.config.ts` (which auto-starts `mandu start`),
 * this config does NOT spawn a webServer — `fast-refresh.spec.ts`
 * owns the dev-server lifecycle per-test-suite so the spec can:
 *   - pick an ephemeral port per run (no collision with auth-flow)
 *   - capture stdout/stderr for diagnostic output on failure
 *   - kill + restart between suites if needed
 */
export default defineConfig({
  testDir: ".",
  testMatch: /fast-refresh\.spec\.ts$/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: {
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../.mandu/reports/latest/playwright-fast-refresh-html", open: "never" }],
    ["json", { outputFile: "../../.mandu/reports/latest/playwright-fast-refresh.json" }],
  ],
});
