# Mandu ATE (Automated Test Engine) Roadmap v1.0

> 4명 전문가 (자동화, QA/QE, 테스트 케이스, AI 에이전트) 분석 기반
>
> 날짜: 2026-04-12

---

## 현재 상태

- **파이프라인**: Extract → Generate → Run → Report → Heal (5단계)
- **MCP 도구**: 9개 (extract, generate, run, report, heal, impact, auto_pipeline, feedback, apply_heal)
- **Oracle 레벨**: L0 (smoke), L1 (구조적) 구현 완료 / **L2, L3 미구현 (placeholder)**
- **테스트 커버리지**: core 1301, mcp 69, cli 34 = 1404 pass — 하지만 devtools(0), brain(0), watcher(0) 사각지대

---

## 핵심 발견 (4명 공통)

| 발견 | 심각도 | 출처 |
|------|--------|------|
| **L2/L3 Oracle 미구현** — MCP 설명과 코드 불일치 | P0 | 자동화 전문가 |
| **SSR/Island/SSE 테스트 생성 없음** — Mandu 핵심 미검증 | P0 | 자동화 + 테스트 케이스 |
| **devtools/brain/watcher 테스트 0건** | P0 | QA/QE |
| **E2E 테스트 전무** — Playwright 인프라만 존재 | P0 | QA/QE |
| **단일 라우트 Run 필터링 없음** | P1 | 자동화 |
| **Watch 모드 없음** | P1 | 자동화 + QA/QE |
| **Heal 지능 한계** — locator 패턴만, 원인 분석 없음 | P2 | 자동화 + 에이전트 |

---

## Phase 1: L2/L3 Oracle 구현 (가장 시급)

### 1-1. L2 Oracle — Contract 스키마 검증

현재 L2는 `toHaveURL(/.*/)`만 있는 placeholder.

**구현**:
- Extract 단계에서 `*.contract.ts`의 Zod 스키마를 읽어 InteractionGraph에 포함
- Codegen에서 API 응답을 contract 스키마 대조 검증 코드 생성
- 엣지케이스 입력 자동 생성 (빈 문자열, 최대 길이, 음수, null)

```typescript
// 생성될 테스트 예시
test("POST /api/products validates contract", async ({ request }) => {
  const res = await request.post("/api/products", {
    data: { title: "", price: -1 }  // edge case from Zod schema
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty("error");
});
```

### 1-2. L3 Oracle — 행동 검증

현재 L3는 주석만 존재.

**구현**:
- Slot 파일의 side-effect 패턴 (DB 호출, 이메일 발송) AST 감지
- LLM 기반 상태 변화 assertion 생성
- 이전 요청 ↔ 이후 상태 비교 검증

---

## Phase 2: Mandu 전용 테스트 시나리오

### 2-1. SSR 테스트 생성

`scenario.ts`에 `kind: "ssr-verify"` 추가:
- HTML 구조 검증 (`<html>`, `<head>`, `<body>`)
- `__MANDU_DATA__` 스크립트 존재 확인
- Zero-JS: island 없는 페이지에 `<script>` 태그 없음 확인
- PPR: 캐시된 shell + 동적 데이터 스크립트 확인

### 2-2. Island Hydration 테스트

`kind: "island-hydration"` 추가:
- `[data-mandu-island]` 속성 존재 확인
- Hydration 후 인터랙션 동작 (클릭 → 상태 변경)
- `@mandujs/core/client` import 검증 (번들 크기 체크)

### 2-3. SSE 스트리밍 테스트

`kind: "sse-stream"` 추가:
- EventSource 연결 성공
- `event: token` + `data:` 메시지 수신
- `event: done` 수신 후 연결 종료

### 2-4. Action/Form 테스트

`kind: "form-action"` 추가:
- Form POST → `_action` 디스패치 확인
- Revalidation 후 loaderData 갱신
- Progressive Enhancement: JS 없이 HTML form 동작

---

## Phase 3: 테스트 인프라 강화

### 3-1. testFilling 연동

ATE가 Playwright 외에 `testFilling` 기반 유닛 테스트도 병행 생성:
- 서버 없이 빠른 피드백 (ms 단위)
- API 라우트의 input/output 검증
- Action revalidation 검증

### 3-2. 단일 라우트 Run 필터링

`runner.ts`에 `--grep` 필터 전달:
```typescript
const args = ["playwright", "test"];
if (onlyRoutes) {
  args.push("--grep", onlyRoutes.map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("|"));
}
```

### 3-3. Watch 모드

`packages/ate/src/watcher.ts` 신규:
- core watcher 이벤트에 ATE impact 분석 훅 연결
- 변경 파일 → `computeImpact()` → 영향받는 라우트만 테스트 재실행
- CLI: `mandu test --watch`

### 3-4. 접근성(a11y) 테스트

L1 Oracle에 `@axe-core/playwright` 추가:
```typescript
const results = await new AxeBuilder({ page }).analyze();
expect(results.violations).toEqual([]);
```

---

## Phase 4: Heal 지능 강화

### 4-1. 실패 원인 심층 분류

현재 4종(`selector/timeout/assertion/unknown`) → 7종으로 확장:
```typescript
type FailureCategory =
  | "selector-stale"        // DOM 구조 변경
  | "api-shape-changed"     // 응답 스키마 변경
  | "component-restructured"// 컴포넌트 리팩토링
  | "race-condition"        // 타이밍 이슈
  | "timeout"               // 네트워크/렌더링 지연
  | "assertion-mismatch"    // 예상 값 변경
  | "unknown";
```

### 4-2. 원인별 차별화된 수정

| 원인 | 수정 |
|------|------|
| selector-stale | 대체 셀렉터 제안 (role/testid) |
| api-shape-changed | assertion 업데이트 diff |
| component-restructured | selector-map 전체 재빌드 |
| race-condition | `page.waitForResponse()` 삽입 |
| assertion-mismatch | 예상 값 업데이트 |

### 4-3. Heal 이력 학습

`.mandu/ate/heal-history.json`에 적용된 heal과 결과 기록.
동일 패턴 반복 시 자동 적용 신뢰도 상향.

---

## Phase 5: AI 에이전트 통합

### 5-1. `mandu.test.smart` — 지능형 테스트 선택

```
git diff → impact 분석 → 의미적 우선순위 → 상위 N개 라우트만 테스트
```

Contract 변경은 해당 contract를 import하는 모든 라우트에 높은 우선순위.
Guard 위반 파일은 하위 트리 전체 테스트 대상.

### 5-2. `mandu.test.coverage` — 누락 시나리오 탐지

InteractionGraph의 edge 중 테스트가 없는 경로를 식별:
```
"navigate /products → /products/[id]" 엣지에 대한 테스트 없음
→ 자동 시나리오 생성 제안
```

### 5-3. Pre-commit 자동 테스트

staged 파일 → impact → 변경 라우트에 테스트 없으면 smoke 자동 생성.

---

## Phase 6: 테스트 커버리지 사각지대 해소

### 6-1. 누락 테스트 추가 (P0)

| 대상 | 테스트 수 | 타입 |
|------|----------|------|
| SSR 시나리오 (HTML 구조, Zero-JS, PPR) | 5개 | Unit |
| Island 오버로드/직렬화 | 6개 | Unit |
| Action FormData/revalidation | 4개 | Unit |
| devtools error-catcher | 3개 | Unit |
| brain doctor/analyzer | 3개 | Unit |
| CLI dev/start/build 통합 | 3개 | Integration |
| E2E: demo/todo-app 시나리오 | 3개 | E2E |

### 6-2. 테스트 팩토리 확장

`packages/core/src/testing/index.ts`에 추가:
```typescript
export function createTestManifest(routes: Partial<RouteSpec>[]): RoutesManifest
export function createTestIsland(name: string, strategy?: string): IslandComponent
export function createMockMcpContext(root?: string): { paths, readConfig }
```

### 6-3. CI 강화

- E2E job 추가 (Playwright + Chromium)
- 커버리지 리포트 (codecov)
- `bun test --changed` pre-commit hook

---

## 우선순위 매트릭스

```
임팩트 ↑
극대  │  L2/L3 Oracle(1)      SSR/Island 테스트(2)
      │  testFilling 연동(3-1)
      │
 대   │  Run 필터링(3-2)      Watch 모드(3-3)
      │  test.smart(5-1)      Heal 심층분류(4-1)
      │
 높   │  a11y 테스트(3-4)     커버리지 사각지대(6-1)
      │  test.coverage(5-2)   팩토리 확장(6-2)
      │
 중   │  Heal 이력(4-3)       CI 강화(6-3)
      │  Pre-commit(5-3)      스냅샷/비주얼(미포함)
      │
      └────────────────────────────────────→ 난이도
           하                  중          상
```

---

## 핵심 인사이트

> **"L2/L3 Oracle이 미구현인 상태에서 MCP 도구는 거짓 약속을 하고 있다"**
> — 자동화 전문가

> **"devtools 24개 파일에 테스트 0개는 가장 큰 사각지대"**
> — QA/QE 전문가

> **"기존 파이프라인 사이에 LLM 판단 레이어를 삽입하는 게 가장 실용적"**
> — 에이전트 전문가

> **"testFilling 활용으로 서버 없는 ms 단위 피드백이 가능하다"**
> — 테스트 케이스 전문가
