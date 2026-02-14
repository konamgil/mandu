# ATE Cheatsheet

빠른 참조용 명령어 및 API 요약

---

## Quick Commands

### Installation

```bash
bun add -d @mandujs/ate @playwright/test playwright
bunx playwright install chromium
```

---

## API Quick Reference

### ateExtract

```typescript
await ateExtract({
  repoRoot: process.cwd(),
  routeGlobs: ["app/**/page.tsx"],
  buildSalt: "dev",
});
```

**Output**: `.mandu/interaction-graph.json`

---

### ateGenerate

```typescript
ateGenerate({
  repoRoot: process.cwd(),
  oracleLevel: "L1",           // L0 | L1 | L2 | L3
  onlyRoutes: ["/", "/about"], // Optional
});
```

**Output**:
- `.mandu/scenarios.json`
- `tests/e2e/auto/*.spec.ts`
- `tests/e2e/playwright.config.ts`

---

### ateRun

```typescript
await ateRun({
  repoRoot: process.cwd(),
  baseURL: "http://localhost:3333",
  ci: false,
  headless: true,
});
```

**Returns**: `{ ok, runId, exitCode, reportDir, ... }`

---

### ateReport

```typescript
await ateReport({
  repoRoot: process.cwd(),
  runId: result.runId,
  startedAt: result.startedAt,
  finishedAt: result.finishedAt,
  exitCode: result.exitCode,
  oracleLevel: "L1",
});
```

**Output**: `.mandu/reports/run-XXX/summary.json`

---

### ateHeal

```typescript
ateHeal({
  repoRoot: process.cwd(),
  runId: "run-1234567890",
});
```

**Returns**: `{ suggestions: HealSuggestion[] }`

---

### ateImpact

```typescript
ateImpact({
  repoRoot: process.cwd(),
  base: "main",
  head: "HEAD",
});
```

**Returns**: `{ changedFiles, selectedRoutes }`

---

## Complete Pipeline

```typescript
import {
  ateExtract,
  ateGenerate,
  ateRun,
  ateReport,
  ateHeal,
} from "@mandujs/ate";

async function pipeline() {
  // 1. Extract
  await ateExtract({ repoRoot: process.cwd() });

  // 2. Generate
  ateGenerate({ repoRoot: process.cwd(), oracleLevel: "L1" });

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

  // 5. Heal (if failed)
  if (result.exitCode !== 0) {
    ateHeal({ repoRoot: process.cwd(), runId: result.runId });
  }

  process.exit(result.exitCode);
}

pipeline();
```

---

## Oracle Levels

| Level | Checks |
|-------|--------|
| **L0** | No console.error, exceptions, 5xx |
| **L1** | L0 + `<main>` exists |
| **L2** | L1 + Accessibility, Performance |
| **L3** | L2 + Visual regression, Domain logic |

---

## File Structure

```
.mandu/
├── interaction-graph.json
├── selector-map.json
├── scenarios.json
└── reports/
    └── run-XXX/
        ├── summary.json
        ├── playwright-html/
        ├── playwright-report.json
        └── junit.xml

tests/e2e/
├── playwright.config.ts
├── auto/          # Auto-generated
└── manual/        # User-written
```

---

## Troubleshooting

### No interaction graph found

```bash
bun run ate:extract
```

### Playwright not found

```bash
bun add -d @playwright/test playwright
bunx playwright install chromium
```

### Base URL not responding

```bash
# Start server first
bun run dev &
sleep 5
bun run ate:test
```

### Selector timeout

```typescript
// 1. Run healing
const healing = ateHeal({ repoRoot: process.cwd(), runId: "run-XXX" });

// 2. Review suggestions
healing.suggestions.forEach(s => console.log(s.diff));

// 3. Apply to selector-map.json
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: ATE Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run dev &
      - run: bun run ate:test
        env:
          BASE_URL: http://localhost:3333
          CI: true
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: .mandu/reports/latest/
```

---

## Performance Tips

### Subset Testing

```typescript
const impact = ateImpact({ repoRoot: process.cwd() });
ateGenerate({
  repoRoot: process.cwd(),
  onlyRoutes: impact.selectedRoutes,
});
```

### Parallel Workers

```typescript
// playwright.config.ts
export default defineConfig({
  workers: process.env.CI ? 2 : 4,
});
```

### Cache Interaction Graph

```bash
# Extract once
bun run ate:extract

# Generate/run multiple times
bun run ate:generate
bun run ate:run
```

---

## Advanced Usage

### Custom Oracle

```typescript
import { oracleTemplate } from "@mandujs/ate/codegen";

function customOracle(route: string): string {
  if (route === "/dashboard") {
    return `
      await expect(page.locator('[data-testid="user-info"]')).toBeVisible();
    `;
  }
  return "";
}
```

### Impact-Based CI

```typescript
const impact = ateImpact({ repoRoot: process.cwd(), base: "main" });

if (impact.selectedRoutes.length === 0) {
  console.log("No routes affected, skipping tests");
  process.exit(0);
}

ateGenerate({
  repoRoot: process.cwd(),
  onlyRoutes: impact.selectedRoutes,
});
```

### Auto-Healing

```typescript
function applyHealing(repoRoot: string, runId: string) {
  const healing = ateHeal({ repoRoot, runId });

  for (const s of healing.suggestions) {
    if (s.kind === "selector-map") {
      // Apply diff to .mandu/selector-map.json
      applySelectorMapDiff(s.diff);
    }
  }
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3333` | Test base URL |
| `CI` | `false` | CI mode (affects trace/video) |
| `MANDU_BUILD_SALT` | `dev` | Build ID for graph |
| `PWDEBUG` | - | Playwright debug mode |

---

## Common Patterns

### Extract Custom Routes

```typescript
await ateExtract({
  repoRoot: process.cwd(),
  routeGlobs: [
    "app/**/page.tsx",
    "routes/**/page.tsx",
    "src/pages/**/*.tsx",
  ],
});
```

### Run Specific Routes

```typescript
ateGenerate({
  repoRoot: process.cwd(),
  onlyRoutes: ["/", "/dashboard", "/settings"],
});
```

### Subset Testing in PR

```bash
# In CI
BASE_REF=$(git merge-base origin/main HEAD)
bun run ate:impact --base=$BASE_REF --head=HEAD
bun run ate:generate --only-routes-from-impact
bun run ate:run
```

---

## Debugging

### View Interaction Graph

```bash
cat .mandu/interaction-graph.json | jq .
```

### View Playwright Report

```bash
bunx playwright show-report .mandu/reports/latest/playwright-html
```

### Enable Debug Mode

```bash
PWDEBUG=1 bunx playwright test
```

### Inspect Trace

```bash
bunx playwright show-trace .mandu/reports/latest/playwright-html/trace.zip
```

---

## Links

- [README](../README.md)
- [Architecture](./architecture.md)
- [Playwright Docs](https://playwright.dev)

---

**Quick Start → Full Pipeline in 5 Commands**:

```bash
bun add -d @mandujs/ate @playwright/test playwright
bunx playwright install chromium
bun run ate:extract
bun run ate:generate
bun run ate:test
```
