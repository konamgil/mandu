---
title: "Phase 12 R0 — Mandu 내장 Testing 생태계"
status: proposal
audience: Mandu core team
created: 2026-04-18
bun_version: "1.3.12"
related:
  - packages/ate/src/index.ts
  - packages/ate/src/pipeline.ts
  - packages/core/src/testing/index.ts
  - packages/cli/src/commands/test-auto.ts
---

# Phase 12 R0 — `mandu test` + ATE 확장

> 목표: **"프레임워크 하나로 완결"**. 별도 Vitest / Jest / Playwright 설치 없이 `mandu test` 단일 명령으로 unit + integration + E2E + snapshot + coverage. ATE 를 E2E 엔진으로 흡수, `bun test` 를 unit/integration 엔진으로 재사용.

---

## 1. 현재 ATE 구조

`@mandujs/ate` v0.18.2 — 6 단계 파이프라인 (`packages/ate/src/index.ts`):

```
Extract → Generate → (Impact) → Run → Report → Heal
 ts-morph  Playwright codegen    git diff  runner  html/json  selector-map
```

- 진입점: `ateExtract/Generate/Run/Report/Impact/Heal`.
- 통합: `runFullPipeline()` (`pipeline.ts`) — autoHeal/impact 옵션.
- CLI: `mandu test:auto` (`cli/commands/test-auto.ts`) — L0 oracle.
- Watch: `mandu test:watch` — `createAteWatcher()` (`watcher.ts`).
- Unit codegen: `generateUnitSpecs` (`unit-codegen.ts`) — `testFilling` 기반 `bun:test` 스펙 → `tests/unit/auto/`.
- AI: `smartSelectRoutes`, `detectCoverageGaps`, `precommitCheck`.
- Heal: 7-category 분류 + heal-history 학습.
- Oracle: L0(smoke) / L1(structure) / L2·L3(placeholder).

**내장 testing 모듈** (`packages/core/src/testing/index.ts`):
- `testFilling`, `createTestRequest`, `createTestContext`
- `createTestManifest`, `createTestIsland`, `createMockMcpContext`

**한계**
- `mandu test` 단일 진입점 부재 (`test:auto/watch/heal` 분산).
- unit/integration 은 사용자가 `bun test` 직접 호출.
- DB / Session / Email / Storage fixture 부재.
- Snapshot · coverage · HMR-aware watch 부재.
- Reporter: Playwright HTML + ATE summary 만. JUnit/Slack/GitHub 없음.
- `mandu.config.ts` 에 `test` 블록 없음.

---

## 2. 경쟁 프레임워크 비교

| Framework | Unit | E2E | 통합 명령 | Fixture |
|---|---|---|---|---|
| **Next.js** ([nextjs.org/docs/app/.../testing](https://nextjs.org/docs/app/building-your-application/testing)) | Vitest/Jest 별도 | Playwright 별도 | 없음 | 없음 |
| **Remix/RR7** ([reactrouter.com/start/framework/testing](https://reactrouter.com/start/framework/testing)) | Vitest | Playwright 별도 | 없음 | `createRoutesStub` |
| **SvelteKit** ([svelte.dev/docs/kit/testing](https://svelte.dev/docs/kit/testing)) | vitest 내장 | Playwright 내장 | `npm test` | `$app/environment` |
| **Nuxt** ([nuxt.com/docs/4.x/getting-started/testing](https://nuxt.com/docs/4.x/getting-started/testing)) | `@nuxt/test-utils` | `@nuxt/test-utils/e2e` | `nuxt test` | `setup()` + `$fetch` |
| **Astro** ([docs.astro.build/en/guides/testing/](https://docs.astro.build/en/guides/testing/)) | Vitest | Playwright 별도 | 없음 | `AstroContainer` |
| **Bun** ([bun.sh/docs/cli/test](https://bun.sh/docs/cli/test)) | `bun test` Jest-like | — | — | mocks, `test.each` |

**Mandu 차별화**: ATE auto-gen E2E + `testFilling` serverless unit + `bun test` 재사용 → 신규 deps 0, zero-config.

---

## 3. `mandu test` 통합 명령

### 서브커맨드

```
mandu test [target] [options]

targets:
  (none)|all    unit + integration + e2e
  unit          *.test.ts (bun test 래퍼)
  integration   tests/integration/** (+ server fixture)
  e2e           ATE 파이프라인 (Playwright)
  snapshot      SSR/island snapshot
  watch         HMR-aware re-run
  coverage      bun+playwright coverage merge
  heal          alias: test:heal

options:
  --filter <pattern>    --impact              --oracle L0|L1|L2|L3
  --reporter console|html|junit|github|slack
  --bail <N>            --parallel <N>        --update-snapshots   --ci
```

### `mandu.config.ts` test 블록

```ts
test?: {
  unit?: { include?: string[]; exclude?: string[]; timeout?: number };
  integration?: { include?: string[]; setupFiles?: string[] };
  e2e?: {
    baseURL?: string; oracle?: "L0"|"L1"|"L2"|"L3";
    browsers?: ("chromium"|"firefox"|"webkit")[];
    startCommand?: string; readyTimeout?: number;
  };
  reporters?: Array<"console"|"html"|"junit"|"github"|"slack">;
  coverage?: { enabled?: boolean; threshold?: { lines?: number } };
  fixtures?: { db?: "sqlite-memory"|"sqlite-file"|"none"; session?: boolean };
}
```

### 실행 플로우

```
loadConfig → merge CLI → discover (unit/integration/ATE graph)
 → (if --impact) computeImpact → 영향 파일
 → parallel: bun test (unit) | bun test (integration, server boot) | ATE runFullPipeline
 → mergeReports → emit(reporters) → exit
```

---

## 4. Fixture 시스템

**HTTP** — `@mandujs/core/testing/server`
```ts
beforeAll(async () => await setup({ port: 0 }));
afterAll(async () => await stop());
test("GET /api/posts", async () => expect((await fetch("/api/posts")).status).toBe(200));
```
구현: `startServer(manifest, { port: 0 })` + `server.url` 캐시 + `clearDefaultRegistry()` teardown (기존 검증 패턴).

**DB** — Phase 4c resource/migration 재사용. `createDbFixture({ mode: "sqlite-memory" })` — per-test savepoint rollback.

**Session** — Phase 2 `loginUser()` 호출 → Set-Cookie → 헤더 반환.
```ts
const authed = await loginFixture({ userId: "u1" });
await fetch("/dashboard", { headers: authed.headers });
```

**Mock 프리미티브**: `mockMcp()` (기존 확장), `mockEmail()` (Phase 5 memory provider), `mockStorage()` (Phase 3 in-memory), `mockScheduler()` (Bun.cron fake timer).

---

## 5. Snapshot + HMR-aware

### SSR snapshot
```ts
const html = await snapshotRoute("/");
expect(html).toMatchSnapshot(); // bun:test native
```
- `renderToString` → 결정적 HTML (nonce/timestamp 마스킹).
- Island marker (`data-mandu-island`) + serialized props 포함.
- 저장: `tests/__snapshots__/` (bun:test native).

### HMR-aware re-run
Phase 7.0 B5 import graph 재활용:
1. `fs.watch` 수집 (debounce 300ms).
2. `buildDependencyGraph()` (`ate/dep-graph.ts`) 역방향 탐색 → 영향 테스트.
3. `bun test <affected>` (unit/integration).
4. 라우트 파일 → ATE watcher subset.

**키**: unit/integration 과 E2E 의 import graph 공유 → 한 watcher 가 양쪽 결정.

---

## 6. ATE 확장

- **AI auto-gen 범위 확대**: unit-codegen 확장 (contract Zod → happy + negative), 신규 `integration-codegen.ts` (filling+slot+island flow).
- **Impact 확장**: manifest diff (route add/remove), resource schema diff → contract 테스트 재생성, island props 변경 → snapshot 무효화.
- **Heal 확장**: snapshot drift auto-fix PR, contract 변경 시 fixture 재생성.
- **신규 단계**: `Plan` (smartSelect 확장 — unit/integration/e2e 레벨 결정, CPU budget), `Fixture` (선언적 DB/session/mock).

```
Extract → Plan → Generate(unit|integration|e2e) → Fixture → Run → Report → Heal
```

---

## 7. 아키텍처

**결정: `@mandujs/core/testing` 확장 + ATE 별도 유지**

- `@mandujs/core/testing` = 런타임 계약 (fixture, helper, snapshot). 사용자 import.
- `@mandujs/ate` = 오프라인 codegen + runner (정적분석, Playwright 래퍼, heal). CLI import.
- `@mandujs/cli/commands/test.ts` = orchestrator.

이유: 새 패키지 3중 관리 회피, peer dep(Playwright) 을 core 에 섞지 않음.

**경로**
```
packages/core/src/testing/
  index.ts            # 기존
  server.ts           # NEW — setup/fetch/stop
  db.ts               # NEW — createDbFixture
  session.ts          # NEW — loginFixture
  snapshot.ts         # NEW — snapshotRoute
  mocks.ts            # NEW — email/storage/scheduler
  config.ts           # NEW — resolveTestConfig
  reporters/          # NEW — console/html/junit/github/slack

packages/ate/src/
  integration-codegen.ts  # NEW
  planner.ts              # NEW — Plan 단계

packages/cli/src/commands/
  test.ts             # NEW — 통합 진입점
  test-auto.ts        # alias → test.ts
```

**Reporter**: `ManduTestReporter { onStart/onTest/onEnd/onFailure }` plugin. `github` = `::notice::` 애노테이션, `slack` = webhook.

**CI**: `.github/workflows/test.yml` 템플릿 `mandu init` scaffold.
```yaml
- run: bun install
- run: bunx playwright install chromium
- run: mandu test --ci --reporter github --reporter junit
```

---

## 8. Phase 분할

### 12.1 — 기본 (1.5주)
`mandu test unit/integration` + config 블록 + HTTP/Session fixture.

- [ ] `test` config 블록 + 로더
- [ ] `core/testing/server.ts`
- [ ] `core/testing/session.ts` (Phase 2 auth)
- [ ] `cli/commands/test.ts` (unit/integration)
- [ ] Reporter: console + junit
- [ ] 테스트: 신규 모듈 unit + CLI E2E

### 12.2 — E2E 흡수 (1.5주)
ATE 를 `mandu test e2e` 로 통합 + startCommand 자동 기동.

- [ ] `mandu test e2e` = `runFullPipeline()` 래퍼, `test:auto` alias
- [ ] `startCommand` + ready probe → baseURL 주입
- [ ] `--impact` 전 파이프라인 전파
- [ ] Reporter: html + github

### 12.3 — 고급 (2주)
Snapshot + HMR-aware + coverage + DB fixture + AI codegen 확장.

- [ ] `snapshot.ts`
- [ ] HMR-aware watcher (import graph 공유)
- [ ] Coverage merge (bun `--coverage` + Playwright)
- [ ] `integration-codegen.ts` + snapshot drift heal
- [ ] DB fixture (Phase 4 이후)

---

## 9. 구현 순서 + 시간

| # | 작업 | Phase | 시간 | 의존 |
|---|---|---|---|---|
| 1 | `test` config + 로더 | 12.1 | 0.5d | — |
| 2 | `server.ts` + 테스트 | 12.1 | 1.5d | — |
| 3 | `session.ts` + 테스트 | 12.1 | 1d | Phase 2 |
| 4 | `cli/test.ts` (unit/int) | 12.1 | 2d | 1-3 |
| 5 | console + junit reporter | 12.1 | 1d | 4 |
| 6 | 문서 + demo | 12.1 | 0.5d | 5 |
| 7 | `test e2e` (ATE 래핑) | 12.2 | 2d | 4 |
| 8 | startCommand + ready | 12.2 | 1d | 7 |
| 9 | --impact 전파 | 12.2 | 1d | 7 |
| 10 | html + github reporter | 12.2 | 1d | 7 |
| 11 | `snapshot.ts` | 12.3 | 2d | — |
| 12 | HMR-aware watcher | 12.3 | 3d | 11 |
| 13 | coverage merge | 12.3 | 1.5d | 4,7 |
| 14 | integration-codegen + heal | 12.3 | 2.5d | 11 |
| 15 | DB fixture | 12.3 | 2d | Phase 4 |

**총합**: 12.1 = 6.5d, 12.2 = 5d, 12.3 = 11d → **약 4주** (버퍼 5주).

---

## 10. Exit criteria

- [ ] `mandu test` 한 명령으로 unit + integration + E2E.
- [ ] `mandu.config.ts` `test` 블록만으로 전 옵션 구성.
- [ ] demo/auth-starter + demo/todo-app 전부 녹색.
- [ ] CI 에서 JUnit + GitHub annotation 발행.
- [ ] Playwright/Vitest 직접 설치·설정 **제로**.
- [ ] 기존 `test:auto/watch/heal` alias 호환.

---

## 11. Open questions

1. **Vitest 호환 layer?** → 네이티브 `bun:test` 만 (YAGNI).
2. **Playwright 자동 설치** → peer dep 유지 + `mandu test e2e` 첫 실행 시 `bunx playwright install` 프롬프트.
3. **Coverage 포맷** → lcov (Codecov 호환).
4. **Snapshot serializer** → 구조만 (style/id 마스킹, noise 최소화).
5. **우선순위** → Phase 9(OS)·10(docs) 가 옵션이면 12 가 1.0 전에. 결정 필요.

---

## 12. 참고 경로

- ATE API: `packages/ate/src/index.ts`, `pipeline.ts`
- 기존 CLI: `packages/cli/src/commands/test-auto.ts`, `registry.ts:444-501`
- 내장 testing: `packages/core/src/testing/index.ts`
- Config: `packages/core/src/config/mandu.ts`
- Phase 2 auth: `packages/core/src/auth/`
- Phase 4 DB: `docs/bun/phases-4-plus.md`
