# @mandujs/ate - Automation Test Engine

**자동화 테스트 엔진**: Extract → Generate → Run → Report → Heal → Impact 전체 파이프라인을 하나의 패키지로 제공합니다.

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL_2.0-blue.svg)](https://opensource.org/licenses/MPL-2.0)
[![Bun](https://img.shields.io/badge/Bun-≥1.0.0-orange)](https://bun.sh)
[![Playwright](https://img.shields.io/badge/Playwright-≥1.40.0-green)](https://playwright.dev)

---

## 📖 Table of Contents

- [Quick Start](#-quick-start)
- [Architecture](#-architecture)
- [API Reference](#-api-reference)
- [Examples](#-examples)
- [Oracle Levels](#-oracle-levels)
- [Roadmap](#-roadmap)
- [Troubleshooting](#-troubleshooting)

---

## 🚀 Quick Start

### Installation

```bash
bun add -d @mandujs/ate @playwright/test playwright
```

### First Test in 5 Minutes

**1. Extract Interaction Graph**

ATE는 코드베이스를 정적 분석하여 라우트, 네비게이션, 모달, 액션 관계를 추출합니다.

```typescript
import { ateExtract } from "@mandujs/ate";

await ateExtract({
  repoRoot: process.cwd(),
  routeGlobs: ["app/**/page.tsx"],
  buildSalt: "dev",
});

// Output: .mandu/interaction-graph.json
// {
//   "nodes": [{ kind: "route", id: "/", file: "app/page.tsx", path: "/" }],
//   "edges": [{ kind: "navigate", from: "/", to: "/about", ... }]
// }
```

**2. Generate Test Scenarios**

```typescript
import { ateGenerate } from "@mandujs/ate";

ateGenerate({
  repoRoot: process.cwd(),
  oracleLevel: "L1", // L0 | L1 | L2 | L3
});

// Output:
// - .mandu/scenarios.json
// - tests/e2e/auto/*.spec.ts (Playwright test files)
// - tests/e2e/playwright.config.ts
```

**3. Run Tests**

```typescript
import { ateRun } from "@mandujs/ate";

const result = await ateRun({
  repoRoot: process.cwd(),
  baseURL: "http://localhost:3333",
  ci: false,
});

console.log(result.exitCode); // 0 = pass, 1 = fail
```

**4. Generate Report**

```typescript
import { ateReport } from "@mandujs/ate";

const report = await ateReport({
  repoRoot: process.cwd(),
  runId: result.runId,
  startedAt: result.startedAt,
  finishedAt: result.finishedAt,
  exitCode: result.exitCode,
  oracleLevel: "L1",
});

console.log(report.summaryPath);
// .mandu/reports/run-1234567890/summary.json
```

**5. Heal Failed Tests (Optional)**

테스트가 실패하면 ATE가 자동으로 대체 셀렉터를 제안합니다.

```typescript
import { ateHeal } from "@mandujs/ate";

const healing = ateHeal({
  repoRoot: process.cwd(),
  runId: result.runId,
});

healing.suggestions.forEach((s) => {
  console.log(s.title);
  console.log(s.diff); // unified diff format
});
```

---

## 🏗️ Architecture

ATE는 6개의 핵심 모듈로 구성되어 있습니다.

```
┌──────────────┐
│   Extractor  │  Static analysis (ts-morph) → Interaction Graph
└──────┬───────┘
       ↓
┌──────────────┐
│  Generator   │  Graph → Scenarios → Playwright Specs (codegen)
└──────┬───────┘
       ↓
┌──────────────┐
│   Runner     │  Execute Playwright tests (bunx playwright test)
└──────┬───────┘
       ↓
┌──────────────┐
│   Reporter   │  Compose summary.json (oracle results + metadata)
└──────┬───────┘
       ↓
┌──────────────┐
│   Healer     │  Parse failures → Generate selector alternatives
└──────────────┘

┌──────────────┐
│   Impact     │  git diff → Affected routes (subset testing)
└──────────────┘
```

### Module Responsibilities

| Module | Input | Output | Purpose |
|--------|-------|--------|---------|
| **Extractor** | Route files (.tsx) | interaction-graph.json | 정적 분석으로 네비게이션 관계 추출 |
| **Generator** | Interaction graph | Playwright specs | 테스트 시나리오 및 코드 생성 |
| **Runner** | Playwright config | Test results | Playwright 실행 래퍼 |
| **Reporter** | Run metadata | summary.json | Oracle 결과 및 메타데이터 집계 |
| **Healer** | Failed test traces | Selector suggestions | 실패한 테스트 복구 제안 |
| **Impact** | git diff | Affected routes | 변경 영향 분석 (subset test) |

### File Structure

```
.mandu/
├── interaction-graph.json    # Extracted navigation graph
├── selector-map.json          # Stable selectors + fallbacks
├── scenarios.json             # Generated test scenarios
└── reports/
    ├── latest/                # Symlink to most recent run
    │   ├── playwright-html/
    │   ├── playwright-report.json
    │   └── junit.xml
    └── run-1234567890/
        ├── summary.json       # ATE summary (oracle + metadata)
        └── run.json           # Run metadata

tests/e2e/
├── playwright.config.ts
├── auto/                      # Auto-generated specs
│   ├── route___.spec.ts
│   └── route__about.spec.ts
└── manual/                    # User-written specs
    └── custom.spec.ts
```

---

## 📚 API Reference

### `ateExtract(input: ExtractInput)`

코드베이스를 정적 분석하여 인터랙션 그래프를 추출합니다.

**Parameters:**

```typescript
interface ExtractInput {
  repoRoot: string;           // 프로젝트 루트 경로
  tsconfigPath?: string;      // tsconfig.json 경로 (선택)
  routeGlobs?: string[];      // 라우트 파일 glob 패턴 (기본: ["app/**/page.tsx"])
  buildSalt?: string;         // Build ID (기본: "dev")
}
```

**Returns:**

```typescript
Promise<{
  ok: true;
  graphPath: string;          // .mandu/interaction-graph.json
  summary: {
    nodes: number;            // 추출된 노드 수 (route, modal, action)
    edges: number;            // 추출된 엣지 수 (navigate, openModal, runAction)
  };
}>
```

**Example:**

```typescript
const result = await ateExtract({
  repoRoot: "/path/to/project",
  routeGlobs: ["app/**/page.tsx", "routes/**/page.tsx"],
});

console.log(`Extracted ${result.summary.nodes} nodes, ${result.summary.edges} edges`);
```

**Supported Patterns:**

- `<Link href="/path">` (Next.js Link)
- `<ManduLink to="/path">` (Mandu Link)
- `mandu.navigate("/path")`
- `mandu.modal.open("modalName")`
- `mandu.action.run("actionName")`

---

### `ateGenerate(input: GenerateInput)`

인터랙션 그래프로부터 테스트 시나리오와 Playwright 스펙을 생성합니다.

**Parameters:**

```typescript
interface GenerateInput {
  repoRoot: string;
  oracleLevel?: OracleLevel;  // "L0" | "L1" | "L2" | "L3" (기본: "L1")
  onlyRoutes?: string[];      // 특정 라우트만 생성 (선택)
}
```

**Returns:**

```typescript
{
  ok: true;
  scenariosPath: string;       // .mandu/scenarios.json
  generatedSpecs: string[];    // tests/e2e/auto/*.spec.ts
}
```

**Example:**

```typescript
const result = ateGenerate({
  repoRoot: process.cwd(),
  oracleLevel: "L1",
  onlyRoutes: ["/", "/about"], // Optional: 특정 라우트만
});

console.log(`Generated ${result.generatedSpecs.length} test specs`);
```

**Generated Test Example (L1 Oracle):**

```typescript
// tests/e2e/auto/route___.spec.ts
import { test, expect } from "@playwright/test";

test.describe("route:/", () => {
  test("smoke /", async ({ page, baseURL }) => {
    const url = (baseURL ?? "http://localhost:3333") + "/";

    // L0: no console.error / uncaught exception / 5xx
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("pageerror", (err) => errors.push(String(err)));

    await page.goto(url);

    // L1: structure signals
    await expect(page.locator("main")).toHaveCount(1);
    expect(errors, "console/page errors").toEqual([]);
  });
});
```

---

### `ateRun(input: RunInput)`

생성된 Playwright 테스트를 실행합니다.

**Parameters:**

```typescript
interface RunInput {
  repoRoot: string;
  baseURL?: string;           // 기본: "http://localhost:3333"
  ci?: boolean;               // CI 모드 (trace, video 설정)
  headless?: boolean;         // Headless 브라우저 (기본: true)
  browsers?: Array<"chromium" | "firefox" | "webkit">;
}
```

**Returns:**

```typescript
Promise<{
  ok: boolean;                // exitCode === 0
  runId: string;              // run-1234567890
  reportDir: string;          // .mandu/reports/run-1234567890
  exitCode: number;           // 0 = pass, 1 = fail
  jsonReportPath?: string;
  junitPath?: string;
  startedAt: string;          // ISO 8601
  finishedAt: string;
}>
```

**Example:**

```typescript
const result = await ateRun({
  repoRoot: process.cwd(),
  baseURL: "http://localhost:3000",
  ci: process.env.CI === "true",
});

if (result.exitCode !== 0) {
  console.error("Tests failed!");
  process.exit(1);
}
```

---

### `ateReport(params)`

테스트 실행 결과를 요약하여 리포트를 생성합니다.

**Parameters:**

```typescript
{
  repoRoot: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  oracleLevel: OracleLevel;
  impact?: {
    changedFiles: string[];
    selectedRoutes: string[];
    mode: "full" | "subset";
  };
}
```

**Returns:**

```typescript
Promise<{
  ok: true;
  summaryPath: string;        // .mandu/reports/run-XXX/summary.json
  summary: SummaryJson;
}>
```

**Example:**

```typescript
const report = await ateReport({
  repoRoot: process.cwd(),
  runId: result.runId,
  startedAt: result.startedAt,
  finishedAt: result.finishedAt,
  exitCode: result.exitCode,
  oracleLevel: "L1",
});

console.log(report.summary.ok ? "✅ All tests passed" : "❌ Tests failed");
```

---

### `ateHeal(input: HealInput)`

실패한 테스트의 trace를 분석하여 대체 셀렉터를 제안합니다.

**Parameters:**

```typescript
interface HealInput {
  repoRoot: string;
  runId: string;              // ateRun의 runId
}
```

**Returns:**

```typescript
{
  ok: true;
  attempted: true;
  suggestions: HealSuggestion[];
}

interface HealSuggestion {
  kind: "selector-map" | "test-code" | "note";
  title: string;
  diff: string;               // Unified diff format
  metadata?: {
    selector?: string;
    alternatives?: string[];
    testFile?: string;
  };
}
```

**Example:**

```typescript
const healing = ateHeal({
  repoRoot: process.cwd(),
  runId: "run-1234567890",
});

healing.suggestions.forEach((s) => {
  console.log(`[${s.kind}] ${s.title}`);
  console.log(s.diff);
});
```

**Sample Output:**

```diff
[selector-map] Update selector-map for: button.submit
--- a/.mandu/selector-map.json
+++ b/.mandu/selector-map.json
@@ -1,3 +1,8 @@
 {
+  "button.submit": {
+    "fallbacks": [
+      "button[type='submit']",
+      "[data-testid='submit-button']"
+    ]
+  },
   "version": "1.0.0"
 }
```

---

### `ateImpact(input: ImpactInput)`

git diff를 분석하여 영향받는 라우트를 계산합니다. (Subset Testing)

**Parameters:**

```typescript
interface ImpactInput {
  repoRoot: string;
  base?: string;              // git base ref (기본: "HEAD~1")
  head?: string;              // git head ref (기본: "HEAD")
}
```

**Returns:**

```typescript
{
  ok: true;
  changedFiles: string[];     // 변경된 파일 목록
  selectedRoutes: string[];   // 영향받는 라우트 ID
}
```

**Example:**

```typescript
const impact = ateImpact({
  repoRoot: process.cwd(),
  base: "main",
  head: "feature-branch",
});

console.log(`Changed files: ${impact.changedFiles.length}`);
console.log(`Affected routes: ${impact.selectedRoutes.join(", ")}`);

// 영향받는 라우트만 테스트
ateGenerate({
  repoRoot: process.cwd(),
  onlyRoutes: impact.selectedRoutes,
});
```

---

## 💡 Examples

### Example 1: Basic Pipeline

```typescript
import { ateExtract, ateGenerate, ateRun, ateReport } from "@mandujs/ate";

async function runFullPipeline() {
  // 1. Extract
  await ateExtract({
    repoRoot: process.cwd(),
  });

  // 2. Generate
  ateGenerate({
    repoRoot: process.cwd(),
    oracleLevel: "L1",
  });

  // 3. Run
  const result = await ateRun({
    repoRoot: process.cwd(),
    baseURL: "http://localhost:3000",
  });

  // 4. Report
  await ateReport({
    repoRoot: process.cwd(),
    runId: result.runId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    exitCode: result.exitCode,
    oracleLevel: "L1",
  });
}

runFullPipeline();
```

---

### Example 2: CI/CD Integration

```typescript
// ci-test.ts
import { ateExtract, ateGenerate, ateRun, ateReport, ateHeal } from "@mandujs/ate";

async function ciPipeline() {
  const repoRoot = process.cwd();
  const oracleLevel = "L1";

  // Extract & Generate
  await ateExtract({ repoRoot });
  ateGenerate({ repoRoot, oracleLevel });

  // Run in CI mode
  const result = await ateRun({
    repoRoot,
    baseURL: process.env.BASE_URL ?? "http://localhost:3333",
    ci: true,
    headless: true,
  });

  // Report
  const report = await ateReport({
    repoRoot,
    runId: result.runId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    exitCode: result.exitCode,
    oracleLevel,
  });

  // Heal if failed
  if (result.exitCode !== 0) {
    const healing = ateHeal({ repoRoot, runId: result.runId });
    console.log("Healing suggestions:", healing.suggestions);
  }

  process.exit(result.exitCode);
}

ciPipeline();
```

**GitHub Actions:**

```yaml
name: ATE Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Start server
        run: bun run dev &
        env:
          PORT: 3333

      - name: Run ATE tests
        run: bun run ci-test.ts
        env:
          BASE_URL: http://localhost:3333
          CI: true

      - name: Upload Playwright Report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: .mandu/reports/latest/
```

---

### Example 3: Custom Oracle

기본 Oracle L0-L1 외에 프로젝트별 assertion을 추가할 수 있습니다.

```typescript
// custom-oracle.ts
import { generatePlaywrightSpecs } from "@mandujs/ate/codegen";
import { getAtePaths, readJson, writeFile } from "@mandujs/ate/fs";
import type { ScenarioBundle } from "@mandujs/ate/scenario";

function customOracleAssertions(route: string): string {
  // 프로젝트별 도메인 로직
  if (route === "/dashboard") {
    return `
      // Custom: Dashboard must have user info
      await expect(page.locator('[data-testid="user-name"]')).toBeVisible();
    `;
  }

  if (route.startsWith("/admin")) {
    return `
      // Custom: Admin pages must have sidebar
      await expect(page.locator('aside.sidebar')).toBeVisible();
    `;
  }

  return "";
}

function generateWithCustomOracle(repoRoot: string) {
  const paths = getAtePaths(repoRoot);
  const bundle = readJson<ScenarioBundle>(paths.scenariosPath);

  for (const scenario of bundle.scenarios) {
    const customAssertions = customOracleAssertions(scenario.route);

    const code = `
import { test, expect } from "@playwright/test";

test.describe("${scenario.id}", () => {
  test("smoke ${scenario.route}", async ({ page, baseURL }) => {
    const url = (baseURL ?? "http://localhost:3333") + "${scenario.route}";

    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    page.on("pageerror", (err) => errors.push(String(err)));

    await page.goto(url);

    // L1 baseline
    await expect(page.locator("main")).toHaveCount(1);

    ${customAssertions}

    expect(errors, "console/page errors").toEqual([]);
  });
});
    `;

    writeFile(`${paths.autoE2eDir}/${scenario.id.replace(/:/g, "_")}.spec.ts`, code);
  }
}

generateWithCustomOracle(process.cwd());
```

---

### Example 4: Impact-Based Subset Testing

```typescript
// subset-test.ts
import { ateImpact, ateGenerate, ateRun } from "@mandujs/ate";

async function subsetTest() {
  const repoRoot = process.cwd();

  // 1. Compute impact
  const impact = ateImpact({
    repoRoot,
    base: "main",
    head: "HEAD",
  });

  console.log(`Changed files: ${impact.changedFiles.length}`);
  console.log(`Affected routes: ${impact.selectedRoutes.join(", ")}`);

  if (impact.selectedRoutes.length === 0) {
    console.log("No routes affected, skipping tests");
    return;
  }

  // 2. Generate tests for affected routes only
  ateGenerate({
    repoRoot,
    oracleLevel: "L1",
    onlyRoutes: impact.selectedRoutes,
  });

  // 3. Run subset tests
  const result = await ateRun({ repoRoot });

  if (result.exitCode !== 0) {
    process.exit(1);
  }
}

subsetTest();
```

---

### Example 5: Programmatic Test Healing

```typescript
// auto-heal.ts
import { ateHeal } from "@mandujs/ate";
import { readFileSync, writeFileSync } from "node:fs";

function applyHealingSuggestions(repoRoot: string, runId: string) {
  const healing = ateHeal({ repoRoot, runId });

  for (const suggestion of healing.suggestions) {
    if (suggestion.kind === "selector-map") {
      console.log(`Applying: ${suggestion.title}`);

      // Parse diff and apply (simplified example)
      const selectorMapPath = `${repoRoot}/.mandu/selector-map.json`;
      const current = JSON.parse(readFileSync(selectorMapPath, "utf8"));

      if (suggestion.metadata?.selector && suggestion.metadata?.alternatives) {
        current[suggestion.metadata.selector] = {
          fallbacks: suggestion.metadata.alternatives,
        };
      }

      writeFileSync(selectorMapPath, JSON.stringify(current, null, 2));
      console.log(`✅ Updated ${selectorMapPath}`);
    }
  }
}

applyHealingSuggestions(process.cwd(), "run-1234567890");
```

---

## 🎯 Oracle Levels

ATE는 4단계 Oracle Level을 지원합니다. 레벨이 높을수록 더 많은 assertion을 수행합니다.

| Level | Description | Assertions |
|-------|-------------|------------|
| **L0** | Baseline | ✅ No `console.error`<br>✅ No uncaught exceptions<br>✅ No 5xx responses |
| **L1** | Structure | L0 + ✅ `<main>` element exists |
| **L2** | Behavior | L1 + ✅ URL matches expected pattern<br>✅ (Placeholder for custom assertions) |
| **L3** | Domain | L2 + ✅ (Placeholder for domain-specific assertions) |

### Choosing Oracle Level

- **L0**: 빠른 스모크 테스트, CI에서 모든 PR 실행
- **L1**: 기본 구조 검증, 대부분의 프로젝트 권장
- **L2**: 행동 검증, 중요 페이지에 사용
- **L3**: 도메인 로직 검증, 수동 assertion 추가 필요

### Future Enhancements (L2-L3)

```typescript
// L2 예정: Accessibility, Performance
await expect(page).toPassAxe(); // Accessibility violations
expect(await page.metrics().FCP).toBeLessThan(2000); // First Contentful Paint

// L3 예정: Visual Regression
await expect(page).toHaveScreenshot("homepage.png", { maxDiffPixels: 100 });
```

---

## 🗺️ Roadmap

### Current (v0.1.0)

- ✅ L0-L1 Oracle
- ✅ Route smoke tests
- ✅ Interaction graph extraction
- ✅ Playwright spec generation
- ✅ Basic healing (selector suggestions)
- ✅ Impact analysis (git diff)

### Near Future (v0.2.0)

- 🔄 L2 Oracle: Accessibility (axe-core), Performance (Web Vitals)
- 🔄 Selector stability scoring
- 🔄 Parallel test execution optimization
- 🔄 Enhanced healing with DOM snapshot analysis

### Long Term (v0.3.0+)

- 🔮 L3 Oracle: Visual regression (Playwright screenshots)
- 🔮 Modal/Action interaction tests
- 🔮 Cross-browser compatibility matrix
- 🔮 AI-powered test generation (LLM integration)
- 🔮 Real user monitoring (RUM) integration

---

## 🛠️ Troubleshooting

### Common Errors

#### 1. `No interaction graph found`

**Problem:** `ateGenerate` 또는 `ateRun`을 실행했지만 `interaction-graph.json`이 없습니다.

**Solution:**

```typescript
// 먼저 extract 실행
await ateExtract({ repoRoot: process.cwd() });
```

---

#### 2. `Playwright not found`

**Problem:** `bunx playwright test` 실행 시 Playwright가 설치되지 않았습니다.

**Solution:**

```bash
bun add -d @playwright/test playwright
bunx playwright install chromium
```

---

#### 3. `Base URL not responding`

**Problem:** 테스트 실행 시 서버가 실행되지 않아 `ERR_CONNECTION_REFUSED`가 발생합니다.

**Solution:**

```bash
# 서버를 먼저 실행
bun run dev &

# 서버가 준비될 때까지 대기
sleep 5

# 테스트 실행
bun run ate:test
```

또는 `wait-on` 사용:

```json
{
  "scripts": {
    "ate:test": "wait-on http://localhost:3333 && bun run ci-test.ts"
  }
}
```

---

#### 4. `Tests fail with selector timeout`

**Problem:** 생성된 셀렉터가 변경되어 테스트가 실패합니다.

**Solution:**

```typescript
// 1. Healing 실행
const healing = ateHeal({ repoRoot: process.cwd(), runId: "run-XXX" });

// 2. 제안 확인
healing.suggestions.forEach((s) => {
  console.log(s.diff);
});

// 3. 수동으로 selector-map.json 업데이트
// 또는 자동 적용 스크립트 사용 (Example 5 참고)
```

---

#### 5. `Empty interaction graph`

**Problem:** `routeGlobs`가 파일을 찾지 못했습니다.

**Solution:**

```typescript
// glob 패턴 확인
await ateExtract({
  repoRoot: process.cwd(),
  routeGlobs: [
    "app/**/page.tsx",      // Next.js App Router
    "routes/**/page.tsx",   // Custom routes
    "src/pages/**/*.tsx",   // Pages directory
  ],
});
```

---

### Performance Tips

#### 1. Subset Testing for Large Projects

```typescript
// 전체 테스트 대신 변경된 라우트만 실행
const impact = ateImpact({ repoRoot: process.cwd() });
ateGenerate({ repoRoot: process.cwd(), onlyRoutes: impact.selectedRoutes });
```

#### 2. Parallel Execution

```typescript
// playwright.config.ts
export default defineConfig({
  workers: process.env.CI ? 2 : 4, // CI에서는 2개, 로컬에서는 4개 worker
});
```

#### 3. Headless Mode

```typescript
await ateRun({
  repoRoot: process.cwd(),
  headless: true, // 브라우저 UI 없이 실행 (빠름)
});
```

#### 4. Cache Interaction Graph

```bash
# Extract는 한 번만 실행, generate/run은 반복 가능
bun run ate:extract  # 한 번만
bun run ate:generate # 여러 번
bun run ate:run      # 여러 번
```

---

### Debugging Tips

#### 1. Enable Playwright Debug Mode

```bash
PWDEBUG=1 bunx playwright test
```

#### 2. View Playwright HTML Report

```bash
bunx playwright show-report .mandu/reports/latest/playwright-html
```

#### 3. Inspect Interaction Graph

```bash
cat .mandu/interaction-graph.json | jq .
```

#### 4. Verbose Logging

```typescript
import { ateExtract } from "@mandujs/ate";

const result = await ateExtract({ repoRoot: process.cwd() });
console.log(JSON.stringify(result, null, 2));
```

---

---

## 📊 HTML Reports

ATE는 테스트 결과를 시각화하는 HTML 대시보드를 자동으로 생성합니다.

### 사용법

```typescript
import { generateHtmlReport, generateReport } from "@mandujs/ate";

// 단독 HTML 생성
const result = await generateHtmlReport({
  repoRoot: process.cwd(),
  runId: "run-2026-02-15-04-30-00",
  includeScreenshots: true,
  includeTraces: true,
});

console.log(`HTML report: ${result.path}`);

// JSON + HTML 동시 생성
const reports = await generateReport({
  repoRoot: process.cwd(),
  runId: "run-2026-02-15-04-30-00",
  format: "both", // 'json' | 'html' | 'both'
});

console.log(`JSON: ${reports.json}`);
console.log(`HTML: ${reports.html}`);
```

### MCP 도구

```typescript
// MCP를 통한 리포트 생성
await mcp.callTool("mandu.ate.report", {
  repoRoot: process.cwd(),
  runId: "run-xxx",
  startedAt: "2026-02-15T04:00:00.000Z",
  finishedAt: "2026-02-15T04:00:10.000Z",
  exitCode: 0,
  format: "both", // HTML + JSON 생성
});
```

### 리포트 구성

HTML 리포트는 다음을 포함합니다:

- **테스트 결과 요약**: Pass/Fail/Skip 카드
- **Oracle 검증**: L0~L3 레벨별 상세 결과
- **Impact Analysis**: 변경된 파일 및 영향받은 라우트
- **Heal 제안**: 자동 복구 제안 및 diff
- **스크린샷 갤러리**: 테스트 스크린샷 (선택)
- **Playwright 링크**: 상세 리포트 및 trace 연결

### 예제

예제 리포트를 생성하려면:

```bash
bun run packages/ate/examples/generate-sample-report.ts
```

생성된 `packages/ate/examples/sample-report.html`을 브라우저에서 열어보세요.

---

## 📄 License

[MPL-2.0](https://opensource.org/licenses/MPL-2.0)

수정한 ATE 소스 코드는 공개 필수, ATE를 import하여 만든 테스트는 자유롭게 사용 가능합니다.

---

## 🤝 Contributing

Issues and PRs welcome at [github.com/mandujs/mandu](https://github.com/mandujs/mandu)

---

## 📚 Related Documentation

- [Mandu Framework Guide](../../README.md)
- [Playwright Documentation](https://playwright.dev)
- [Interaction Graph Schema](./docs/interaction-graph.md) (TBD)
- [Oracle Levels Spec](./docs/oracle-levels.md) (TBD)

---

**Built with ❤️ by the Mandu team**
