import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getAtePaths, ensureDir, readJson, writeJson } from "./fs";
import type { ScenarioBundle } from "./scenario";
import type { OracleLevel } from "./types";
import { readSelectorMap, buildPlaywrightLocatorChain } from "./selector-map";
import { generateL1Assertions } from "./oracle";
import { detectDomain } from "./domain-detector";

function specHeader(): string {
  return `import { test, expect } from "@playwright/test";\n\n`;
}

function oracleTemplate(level: OracleLevel, routePath: string): { setup: string; assertions: string } {
  const setup: string[] = [];
  const assertions: string[] = [];

  // L0 baseline always
  setup.push(`// L0: no console.error / uncaught exception / 5xx`);
  setup.push(`const errors: string[] = [];`);
  setup.push(`page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });`);
  setup.push(`page.on("pageerror", (err) => errors.push(String(err)));`);

  if (level === "L1" || level === "L2" || level === "L3") {
    // Use domain-aware L1 assertions
    const domain = detectDomain(routePath).domain;
    const l1Assertions = generateL1Assertions(domain, routePath);
    assertions.push(...l1Assertions);
  }
  if (level === "L2" || level === "L3") {
    assertions.push(`// L2: behavior signals (placeholder - extend per app)`);
    assertions.push(`await expect(page).toHaveURL(/.*/);`);
  }
  if (level === "L3") {
    assertions.push(`// L3: domain hints (placeholder)`);
  }

  assertions.push(`expect(errors, "console/page errors").toEqual([]);`);

  return { setup: setup.join("\n"), assertions: assertions.join("\n") };
}

export function generatePlaywrightSpecs(repoRoot: string, opts?: { onlyRoutes?: string[] }): { files: string[]; warnings: string[] } {
  const paths = getAtePaths(repoRoot);
  const warnings: string[] = [];

  let bundle: ScenarioBundle;
  try {
    bundle = readJson<ScenarioBundle>(paths.scenariosPath);
  } catch (err: any) {
    throw new Error(`시나리오 번들 읽기 실패: ${err.message}`);
  }

  if (!bundle.scenarios || bundle.scenarios.length === 0) {
    warnings.push("경고: 생성할 시나리오가 없습니다");
    return { files: [], warnings };
  }

  let selectorMap;
  try {
    selectorMap = readSelectorMap(repoRoot);
  } catch (err: any) {
    // Selector map is optional
    warnings.push(`Selector map 읽기 실패 (무시): ${err.message}`);
  }

  try {
    ensureDir(paths.autoE2eDir);
  } catch (err: any) {
    throw new Error(`E2E 디렉토리 생성 실패: ${err.message}`);
  }

  const files: string[] = [];
  for (const s of bundle.scenarios) {
    if (opts?.onlyRoutes?.length && !opts.onlyRoutes.includes(s.route)) continue;

    try {
      const safeId = s.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      const filePath = join(paths.autoE2eDir, `${safeId}.spec.ts`);

      let code: string;

      if (s.kind === "api-smoke") {
        // API route: fetch-based test
        const methods = s.methods ?? ["GET"];
        const testCases = methods.map((method) => {
          return [
            `  test(${JSON.stringify(`${method} ${s.route}`)}, async ({ baseURL }) => {`,
            `    const url = (baseURL ?? "http://localhost:3333") + ${JSON.stringify(s.route)};`,
            `    const res = await fetch(url, { method: ${JSON.stringify(method)} });`,
            `    expect(res.status).toBeLessThan(500);`,
            `    expect(res.headers.get("content-type")).toBeTruthy();`,
            method === "GET" ? `    const body = await res.text();\n    expect(body.length).toBeGreaterThan(0);` : "",
            `  });`,
          ].filter(Boolean).join("\n");
        });

        code = [
          specHeader(),
          `test.describe(${JSON.stringify(s.id)}, () => {`,
          ...testCases,
          `});`,
          "",
        ].join("\n");
      } else {
        // Page route: browser-based test
        const oracle = oracleTemplate(s.oracleLevel, s.route);

        // Generate selector examples if selector map exists
        let selectorExamples = "";
        if (selectorMap && selectorMap.entries.length > 0) {
          const exampleEntry = selectorMap.entries[0];
          const locatorChain = buildPlaywrightLocatorChain(exampleEntry);
          selectorExamples = `    // Example: Selector with fallback chain\n    // const loginBtn = ${locatorChain};\n`;
        }

        code = [
          specHeader(),
          `test.describe(${JSON.stringify(s.id)}, () => {`,
          `  test(${JSON.stringify(`smoke ${s.route}`)}, async ({ page, baseURL }) => {`,
          `    const url = (baseURL ?? "http://localhost:3333") + ${JSON.stringify(s.route === "/" ? "/" : s.route)};`,
          `    ${oracle.setup.split("\n").join("\n    ")}`,
          `    await page.goto(url);`,
          selectorExamples,
          `    ${oracle.assertions.split("\n").join("\n    ")}`,
          `  });`,
          `});`,
          "",
        ].join("\n");
      }

      try {
        writeFileSync(filePath, code, "utf8");
        files.push(filePath);
      } catch (err: any) {
        warnings.push(`Spec 파일 쓰기 실패 (${filePath}): ${err.message}`);
        console.error(`[ATE] Spec 생성 실패: ${filePath} - ${err.message}`);
      }
    } catch (err: any) {
      warnings.push(`Spec 생성 실패 (${s.id}): ${err.message}`);
      console.error(`[ATE] Spec 생성 에러: ${s.id} - ${err.message}`);
      // Continue with next scenario
    }
  }

  // ensure playwright config exists (minimal)
  try {
    const configPath = join(repoRoot, "tests", "e2e", "playwright.config.ts");
    ensureDir(join(repoRoot, "tests", "e2e"));
    const desiredConfig = `import { defineConfig } from "@playwright/test";\n\nexport default defineConfig({\n  // NOTE: resolved relative to this config file (tests/e2e).\n  testDir: ".",\n  timeout: 60_000,\n  use: {\n    baseURL: process.env.BASE_URL ?? "http://localhost:3333",\n    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",\n    video: process.env.CI ? "retain-on-failure" : "off",\n    screenshot: "only-on-failure",\n  },\n  reporter: [\n    ["html", { outputFolder: "../../.mandu/reports/latest/playwright-html", open: "never" }],\n    ["json", { outputFile: "../../.mandu/reports/latest/playwright-report.json" }],\n    ["junit", { outputFile: "../../.mandu/reports/latest/junit.xml" }],\n  ],\n});\n`;

    if (!existsSync(configPath)) {
      Bun.write(configPath, desiredConfig);
    } else {
      // migrate older auto-generated config that used testDir: "tests/e2e" (breaks because config is already under tests/e2e)
      const current = readFileSync(configPath, "utf8");
      if (current.includes('testDir: "tests/e2e"')) {
        Bun.write(configPath, desiredConfig);
      }
    }
  } catch (err: any) {
    warnings.push(`Playwright config 생성 실패: ${err.message}`);
    console.warn(`[ATE] Playwright config 생성 실패: ${err.message}`);
  }

  return { files, warnings };
}
