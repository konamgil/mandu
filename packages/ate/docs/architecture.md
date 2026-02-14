# ATE Architecture

**@mandujs/ate** 내부 아키텍처 및 핵심 설계 원리

---

## Table of Contents

- [Overview](#overview)
- [Interaction Graph](#interaction-graph)
- [Stable Selectors](#stable-selectors)
- [Oracle Levels](#oracle-levels)
- [Healing Algorithm](#healing-algorithm)
- [Impact Analysis](#impact-analysis)
- [Extension Points](#extension-points)

---

## Overview

ATE는 **정적 분석 → 테스트 생성 → 실행 → 리포팅 → 자가 복구**의 전체 파이프라인을 자동화합니다.

### Core Principles

1. **Zero Configuration**: 프로젝트 구조를 자동 감지, 설정 파일 불필요
2. **Code-Driven**: 주석이나 데코레이터 대신 실제 코드를 분석
3. **Self-Healing**: 실패한 테스트를 자동으로 복구 제안
4. **Impact-Aware**: 변경된 코드만 테스트하여 CI 시간 단축

### Data Flow

```
┌─────────────┐
│ Source Code │ (*.tsx files)
└──────┬──────┘
       │ ts-morph static analysis
       ↓
┌─────────────┐
│  AST Parse  │ → Extract navigation patterns
└──────┬──────┘
       │
       ↓
┌──────────────────┐
│ Interaction Graph│ (nodes + edges)
└──────┬───────────┘
       │ scenario generation
       ↓
┌─────────────┐
│  Scenarios  │ (JSON)
└──────┬──────┘
       │ codegen (ts-morph)
       ↓
┌──────────────────┐
│ Playwright Specs │ (*.spec.ts)
└──────┬───────────┘
       │ bunx playwright test
       ↓
┌─────────────┐
│ Test Results│ (JSON report)
└──────┬──────┘
       │ parse failures
       ↓
┌─────────────┐
│  Healing    │ (selector alternatives)
└─────────────┘
```

---

## Interaction Graph

**목적**: 애플리케이션의 라우트, 모달, 액션 간 관계를 그래프로 표현

### Schema

```typescript
interface InteractionGraph {
  schemaVersion: 1;
  generatedAt: string;       // ISO 8601
  buildSalt: string;         // "dev" | "staging" | "prod"
  nodes: InteractionNode[];
  edges: InteractionEdge[];
  stats: {
    routes: number;
    navigations: number;
    modals: number;
    actions: number;
  };
}
```

### Node Types

#### 1. Route Node

```typescript
{
  kind: "route";
  id: "/dashboard";          // Unique route path
  file: "app/dashboard/page.tsx";
  path: "/dashboard";
}
```

**추출 소스**:
- `app/**/page.tsx` (Next.js App Router)
- `routes/**/page.tsx` (Custom routing)

**ID 정규화**:
```typescript
"app/dashboard/page.tsx" → "/dashboard"
"app/page.tsx"           → "/"
"routes/admin/page.tsx"  → "/admin"
```

#### 2. Modal Node

```typescript
{
  kind: "modal";
  id: "confirm-delete";
  file: "components/modals/ConfirmDelete.tsx";
  name: "confirm-delete";
}
```

**추출 소스**:
- `mandu.modal.register("confirm-delete", ...)`

#### 3. Action Node

```typescript
{
  kind: "action";
  id: "user.login";
  file: "actions/user.ts";
  name: "user.login";
}
```

**추출 소스**:
- `mandu.action.register("user.login", ...)`

---

### Edge Types

#### 1. Navigate Edge

```typescript
{
  kind: "navigate";
  from: "/";                 // Source route (optional for global nav)
  to: "/about";              // Target route
  file: "app/page.tsx";
  source: "<Link href>";     // "<jsx href>" | "mandu.navigate"
}
```

**추출 패턴**:
```tsx
// Pattern 1: Next.js Link
<Link href="/about">About</Link>

// Pattern 2: Mandu Link
<ManduLink to="/about">About</ManduLink>

// Pattern 3: Programmatic
mandu.navigate("/about");
```

#### 2. OpenModal Edge

```typescript
{
  kind: "openModal";
  from: "/settings";
  modal: "confirm-delete";
  file: "app/settings/page.tsx";
  source: "mandu.modal.open";
}
```

#### 3. RunAction Edge

```typescript
{
  kind: "runAction";
  from: "/login";
  action: "user.login";
  file: "app/login/page.tsx";
  source: "mandu.action.run";
}
```

---

### Graph Example

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-02-15T10:30:00.000Z",
  "buildSalt": "dev",
  "nodes": [
    { "kind": "route", "id": "/", "file": "app/page.tsx", "path": "/" },
    { "kind": "route", "id": "/about", "file": "app/about/page.tsx", "path": "/about" },
    { "kind": "modal", "id": "login", "file": "components/LoginModal.tsx", "name": "login" }
  ],
  "edges": [
    {
      "kind": "navigate",
      "from": "/",
      "to": "/about",
      "file": "app/page.tsx",
      "source": "<jsx href>"
    },
    {
      "kind": "openModal",
      "from": "/",
      "modal": "login",
      "file": "app/page.tsx",
      "source": "mandu.modal.open"
    }
  ],
  "stats": {
    "routes": 2,
    "navigations": 1,
    "modals": 1,
    "actions": 0
  }
}
```

---

## Stable Selectors

**문제**: DOM 구조가 변경되면 CSS 셀렉터가 깨짐

**해결**: 우선순위 기반 fallback 셀렉터 시스템

### Selector Priority

| Priority | Selector Type | Example | Stability |
|----------|---------------|---------|-----------|
| 1 | `data-testid` | `[data-testid="submit"]` | ⭐⭐⭐ High |
| 2 | `id` | `#submit-button` | ⭐⭐ Medium |
| 3 | Semantic HTML | `button[type="submit"]` | ⭐⭐ Medium |
| 4 | ARIA attributes | `[aria-label="Submit"]` | ⭐⭐ Medium |
| 5 | Class names | `.btn-primary` | ⭐ Low |
| 6 | Tag + text | `button:has-text("Submit")` | ⭐ Low |

### Selector Map Schema

```json
{
  "version": "1.0.0",
  "selectors": {
    "button.submit": {
      "fallbacks": [
        "[data-testid='submit-button']",
        "button[type='submit']",
        "button:has-text('Submit')"
      ],
      "score": 0.85,
      "lastUsed": "2026-02-15T10:30:00.000Z"
    }
  }
}
```

### Healing Process

```
┌─────────────┐
│ Test Fails  │ (Playwright timeout on selector)
└──────┬──────┘
       │
       ↓
┌─────────────────────┐
│ Parse Trace/Report  │ → Extract failed selector
└──────┬──────────────┘
       │
       ↓
┌───────────────────────┐
│ Generate Alternatives │ (DOM snapshot analysis)
└──────┬────────────────┘
       │
       ↓
┌──────────────────┐
│ Rank by Priority │ (data-testid > id > semantic)
└──────┬───────────┘
       │
       ↓
┌──────────────────┐
│ Create Diff      │ (unified diff for selector-map.json)
└──────┬───────────┘
       │
       ↓
┌──────────────────┐
│ User Review      │ (manual apply or auto-patch)
└──────────────────┘
```

**Example Healing Output**:

```diff
--- a/.mandu/selector-map.json
+++ b/.mandu/selector-map.json
@@ -1,3 +1,10 @@
 {
+  "button.login": {
+    "fallbacks": [
+      "[data-testid='login-button']",
+      "button[type='submit']:has-text('Login')",
+      ".auth-form button.primary"
+    ]
+  },
   "version": "1.0.0"
 }
```

---

## Oracle Levels

Oracle은 테스트의 **정확도(precision)**와 **속도(performance)** 사이의 균형을 조정합니다.

### Level Progression

```
L0 (Baseline)
  ├─ console.error 없음
  ├─ Uncaught exception 없음
  └─ 5xx HTTP 응답 없음

L1 (Structure)
  ├─ L0 모든 체크
  └─ <main> 요소 존재 (기본 DOM 구조)

L2 (Behavior)
  ├─ L1 모든 체크
  ├─ URL 패턴 매칭
  ├─ Accessibility (axe-core)
  └─ Performance (Web Vitals: FCP, LCP)

L3 (Domain)
  ├─ L2 모든 체크
  ├─ Visual regression (screenshot diff)
  ├─ Custom domain assertions
  └─ Business logic validation
```

### Implementation

**L0 Template**:
```typescript
const errors: string[] = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto(url);

expect(errors, "console/page errors").toEqual([]);
```

**L1 Template**:
```typescript
// L0 checks
// ...

// L1: Structure
await expect(page.locator("main")).toHaveCount(1);
```

**L2 Template (Future)**:
```typescript
// L1 checks
// ...

// L2: Accessibility
const axeResults = await new AxeBuilder({ page }).analyze();
expect(axeResults.violations).toEqual([]);

// L2: Performance
const metrics = await page.evaluate(() => performance.getEntriesByType("navigation"));
expect(metrics[0].loadEventEnd).toBeLessThan(3000);
```

**L3 Template (Future)**:
```typescript
// L2 checks
// ...

// L3: Visual Regression
await expect(page).toHaveScreenshot("homepage.png", {
  maxDiffPixels: 100,
});

// L3: Domain-specific
if (route === "/dashboard") {
  await expect(page.locator('[data-testid="user-stats"]')).toBeVisible();
  const balance = await page.locator('[data-testid="balance"]').textContent();
  expect(Number(balance?.replace(/[^0-9.-]/g, ""))).toBeGreaterThan(0);
}
```

---

## Healing Algorithm

### Step 1: Trace Parsing

```typescript
interface FailedLocator {
  selector: string;          // "button.submit"
  actionType: "click" | "fill" | "type";
  context: string;           // Surrounding code line
  screenshot?: string;       // Path to failure screenshot
  domSnapshot?: string;      // DOM at failure time
}

function parseTrace(jsonReportPath: string): {
  failedLocators: FailedLocator[];
  metadata: {
    testFile: string;
    testTitle: string;
    errorMessage: string;
  };
}
```

**Playwright Report JSON Structure**:
```json
{
  "suites": [
    {
      "specs": [
        {
          "title": "smoke /",
          "tests": [
            {
              "results": [
                {
                  "status": "failed",
                  "error": {
                    "message": "Timeout 30000ms exceeded.\nwaiting for locator('button.submit')"
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### Step 2: Alternative Generation

```typescript
function generateAlternativeSelectors(
  originalSelector: string,
  actionType: string,
  domSnapshot?: string
): string[] {
  const alternatives: string[] = [];

  // Strategy 1: Extract semantic meaning
  if (originalSelector.includes("submit")) {
    alternatives.push('button[type="submit"]');
    alternatives.push('button:has-text("Submit")');
    alternatives.push('[data-testid="submit-button"]');
  }

  // Strategy 2: Parse CSS class to semantic
  const match = originalSelector.match(/\.([\w-]+)/);
  if (match) {
    const className = match[1];
    alternatives.push(`[data-testid="${className}"]`);
  }

  // Strategy 3: DOM snapshot analysis (if available)
  if (domSnapshot) {
    const parsed = parseDOMSnapshot(domSnapshot);
    const candidates = findSimilarElements(parsed, originalSelector);
    alternatives.push(...candidates);
  }

  // Deduplicate and rank
  return [...new Set(alternatives)].slice(0, 5);
}
```

### Step 3: Diff Generation

```typescript
function generateSelectorMapDiff(
  originalSelector: string,
  alternatives: string[]
): string {
  return `
--- a/.mandu/selector-map.json
+++ b/.mandu/selector-map.json
@@ -1,3 +1,8 @@
 {
+  "${originalSelector}": {
+    "fallbacks": ${JSON.stringify(alternatives, null, 2)}
+  },
   "version": "1.0.0"
 }
`.trim();
}
```

---

## Impact Analysis

**목적**: git diff를 분석하여 영향받는 라우트만 테스트

### Algorithm

```typescript
function computeImpact(input: ImpactInput): {
  changedFiles: string[];
  selectedRoutes: string[];
} {
  // 1. Git diff로 변경된 파일 목록 추출
  const changedFiles = execSync(
    `git diff --name-only ${base}..${head}`
  ).toString().split("\n");

  // 2. Interaction Graph 로드
  const graph = readInteractionGraph(repoRoot);

  // 3. 영향 받는 라우트 계산
  const affectedRoutes = new Set<string>();

  for (const file of changedFiles) {
    // 직접 변경된 라우트 파일
    const route = findRouteByFile(graph, file);
    if (route) affectedRoutes.add(route.id);

    // 같은 폴더의 공유 모듈 변경
    const siblingRoutes = findRoutesByFolder(graph, file);
    siblingRoutes.forEach(r => affectedRoutes.add(r.id));
  }

  return {
    changedFiles,
    selectedRoutes: Array.from(affectedRoutes),
  };
}
```

### Example

**Git Diff**:
```
M app/dashboard/page.tsx
M lib/api.ts
M components/Header.tsx
```

**Impact Calculation**:
```
app/dashboard/page.tsx  → /dashboard (직접 영향)
lib/api.ts              → 모든 라우트 (글로벌 의존성)
components/Header.tsx   → 모든 라우트 (공유 컴포넌트)
```

**최적화 전략**:
```typescript
// 휴리스틱: 공유 파일이면 전체 테스트, 아니면 subset
if (changedFiles.some(f => f.startsWith("lib/") || f.startsWith("components/"))) {
  return { mode: "full", selectedRoutes: allRoutes };
} else {
  return { mode: "subset", selectedRoutes: affectedRoutes };
}
```

---

## Extension Points

ATE는 다음 지점에서 확장 가능합니다.

### 1. Custom Extractors

```typescript
// custom-extractor.ts
import { extract } from "@mandujs/ate/extractor";
import type { InteractionGraph } from "@mandujs/ate/types";

export async function customExtract(repoRoot: string): Promise<InteractionGraph> {
  // 기본 추출
  const result = await extract({ repoRoot });
  const graph = readJson(result.graphPath);

  // 커스텀 패턴 추가 (e.g., Vue Router)
  const vueRoutes = extractVueRoutes(repoRoot);
  graph.nodes.push(...vueRoutes);

  return graph;
}
```

### 2. Custom Oracle

```typescript
// custom-oracle.ts
import type { OracleLevel } from "@mandujs/ate/types";

export function customOracleAssertions(
  route: string,
  level: OracleLevel
): string {
  if (level === "L3" && route.startsWith("/admin")) {
    return `
      // Admin pages must have RBAC check
      await expect(page.locator('[data-role="admin"]')).toBeVisible();
    `;
  }
  return "";
}
```

### 3. Custom Healing Strategy

```typescript
// custom-healer.ts
export function customSelectorAlternatives(
  selector: string,
  context: string
): string[] {
  // 프로젝트별 네이밍 규칙 반영
  if (selector.includes("btn-")) {
    const action = selector.replace("btn-", "");
    return [
      `[data-testid="${action}-button"]`,
      `button.${action}`,
    ];
  }
  return [];
}
```

### 4. Custom Impact Analysis

```typescript
// custom-impact.ts
export function customImpactAnalysis(
  changedFiles: string[],
  graph: InteractionGraph
): string[] {
  // 의존성 그래프 분석 (e.g., import 체인)
  const deps = buildDependencyGraph(repoRoot);

  const affected = new Set<string>();
  for (const file of changedFiles) {
    const dependents = deps.getDependents(file);
    for (const dep of dependents) {
      const route = findRouteByFile(graph, dep);
      if (route) affected.add(route.id);
    }
  }

  return Array.from(affected);
}
```

---

## Performance Considerations

### 1. Extraction Performance

**문제**: 큰 프로젝트(1000+ 파일)에서 ts-morph 분석이 느림

**해결**:
- `skipAddingFilesFromTsConfig: true` (필요한 파일만 로드)
- 증분 분석 (변경된 파일만 재분석)
- Worker threads 병렬화

### 2. Test Generation Performance

**문제**: 라우트가 많으면 스펙 파일 수백 개 생성

**해결**:
- 라우트 그룹핑 (prefix별로 하나의 spec 파일)
- Lazy generation (onlyRoutes 활용)

### 3. Test Execution Performance

**문제**: 전체 테스트 실행 시 CI 시간 증가

**해결**:
- Impact analysis로 subset 테스트
- Playwright sharding (`--shard=1/4`)
- Parallel workers 최적화

---

## Future Architecture

### Planned Enhancements

**1. Dependency Graph Integration**

```typescript
interface DependencyGraph {
  files: Map<string, Set<string>>;  // file -> imports
  routes: Map<string, Set<string>>; // route -> dependencies
}

// 정확한 영향 분석
function computeAccurateImpact(
  changedFiles: string[],
  depGraph: DependencyGraph
): string[] {
  // Import chain 따라가며 영향받는 라우트 계산
}
```

**2. Visual Regression Engine**

```typescript
interface VisualDiff {
  route: string;
  baseline: string;       // screenshot path
  current: string;
  diff: string;
  pixelDiff: number;
  threshold: number;
}

// L3 Oracle에 통합
```

**3. Real User Monitoring (RUM) Integration**

```typescript
interface RUMData {
  route: string;
  errorRate: number;
  avgLoadTime: number;
  userFlows: Array<{ from: string; to: string; count: number }>;
}

// RUM 데이터 기반 테스트 우선순위 결정
function prioritizeTestsByRUM(rum: RUMData): string[] {
  return rum.routes
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10)
    .map(r => r.route);
}
```

---

## Conclusion

ATE는 **정적 분석 + 동적 테스트 + 자가 복구**를 결합하여 E2E 테스트의 유지보수 비용을 최소화합니다.

핵심 설계 원리:
- **Code as Source of Truth**: 코드 변경 시 테스트 자동 업데이트
- **Self-Healing**: 셀렉터 깨짐 자동 복구
- **Impact-Aware**: 변경된 부분만 테스트
- **Extensible**: 프로젝트별 커스터마이징 가능

---

**Next Steps**: [Troubleshooting Guide](../README.md#troubleshooting)
