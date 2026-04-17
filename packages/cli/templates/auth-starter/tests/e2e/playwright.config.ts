import { defineConfig } from "@playwright/test";

// Dedicated port for this demo's e2e runs so it doesn't collide with other
// Mandu demos (todo-app also uses 3333). Override via `BASE_URL` to point
// the tests at a dev instance you've started yourself.
const E2E_PORT = Number(process.env.AUTH_STARTER_PORT ?? "4773");
const E2E_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  // Spec files live next to this config.
  testDir: ".",
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL ?? E2E_URL,
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
  },
  // Auto-start the production server unless BASE_URL is pre-set (e.g. by
  // a developer pointing at a running dev instance).
  webServer: process.env.BASE_URL
    ? undefined
    : {
        // `bun run start` requires a previous `bun run build` — run
        // `bun run build && bun run test:e2e` (or rely on the package
        // script chain) to exercise the full flow.
        command: `bun run start`,
        env: { PORT: String(E2E_PORT) },
        url: E2E_URL,
        timeout: 60_000,
        reuseExistingServer: !process.env.CI,
        stdout: "pipe",
        stderr: "pipe",
      },
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../.mandu/reports/latest/playwright-html", open: "never" }],
    ["json", { outputFile: "../../.mandu/reports/latest/playwright-report.json" }],
    ["junit", { outputFile: "../../.mandu/reports/latest/junit.xml" }],
  ],
});
