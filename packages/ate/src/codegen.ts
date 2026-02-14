import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { getAtePaths, ensureDir, readJson, writeJson } from "./fs";
import type { ScenarioBundle } from "./scenario";
import type { OracleLevel } from "./types";

function specHeader(): string {
  return `import { test, expect } from "@playwright/test";\n\n`;
}

function oracleTemplate(level: OracleLevel): string {
  const lines: string[] = [];
  // L0 baseline always
  lines.push(`// L0: no console.error / uncaught exception / 5xx`);
  lines.push(`const errors: string[] = [];`);
  lines.push(`page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });`);
  lines.push(`page.on("pageerror", (err) => errors.push(String(err)));`);

  if (level === "L1" || level === "L2" || level === "L3") {
    lines.push(`// L1: structure signals`);
    lines.push(`await expect(page.locator("main")).toHaveCount(1);`);
  }
  if (level === "L2" || level === "L3") {
    lines.push(`// L2: behavior signals (placeholder - extend per app)`);
    lines.push(`await expect(page).toHaveURL(/.*/);`);
  }
  if (level === "L3") {
    lines.push(`// L3: domain hints (placeholder)`);
  }

  lines.push(`expect(errors, "console/page errors").toEqual([]);`);
  return lines.join("\n");
}

export function generatePlaywrightSpecs(repoRoot: string, opts?: { onlyRoutes?: string[] }): { files: string[] } {
  const paths = getAtePaths(repoRoot);
  const bundle = readJson<ScenarioBundle>(paths.scenariosPath);

  ensureDir(paths.autoE2eDir);

  const files: string[] = [];
  for (const s of bundle.scenarios) {
    if (opts?.onlyRoutes?.length && !opts.onlyRoutes.includes(s.route)) continue;

    const safeId = s.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = join(paths.autoE2eDir, `${safeId}.spec.ts`);

    const code = [
      specHeader(),
      `test.describe(${JSON.stringify(s.id)}, () => {`,
      `  test(${JSON.stringify(`smoke ${s.route}`)}, async ({ page, baseURL }) => {`,
      `    const url = (baseURL ?? "http://127.0.0.1:3333") + ${JSON.stringify(s.route === "/" ? "/" : s.route)};`,
      `    await page.goto(url);`,
      `    ${oracleTemplate(s.oracleLevel).split("\n").join("\n    ")}`,
      `  });`,
      `});`,
      "",
    ].join("\n");

    Bun.write(filePath, code);
    files.push(filePath);
  }

  // ensure playwright config exists (minimal)
  const configPath = join(repoRoot, "tests", "e2e", "playwright.config.ts");
  ensureDir(join(repoRoot, "tests", "e2e"));
  const desiredConfig = `import { defineConfig } from "@playwright/test";\n\nexport default defineConfig({\n  // NOTE: resolved relative to this config file (tests/e2e).\n  testDir: ".",\n  timeout: 60_000,\n  use: {\n    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3333",\n    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",\n    video: process.env.CI ? "retain-on-failure" : "off",\n    screenshot: "only-on-failure",\n  },\n  reporter: [\n    ["html", { outputFolder: "../../.mandu/reports/latest/playwright-html", open: "never" }],\n    ["json", { outputFile: "../../.mandu/reports/latest/playwright-report.json" }],\n    ["junit", { outputFile: "../../.mandu/reports/latest/junit.xml" }],\n  ],\n});\n`;

  if (!existsSync(configPath)) {
    Bun.write(configPath, desiredConfig);
  } else {
    // migrate older auto-generated config that used testDir: "tests/e2e" (breaks because config is already under tests/e2e)
    const current = readFileSync(configPath, "utf8");
    if (current.includes('testDir: "tests/e2e"')) {
      Bun.write(configPath, desiredConfig);
    }
  }

  return { files };
}
