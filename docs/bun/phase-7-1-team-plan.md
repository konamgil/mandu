---
title: "Phase 7.1 — Fast Refresh + Slot dispatch + Cold start 에이전트 팀 실행 계획"
status: execution-plan
audience: Mandu core team + dispatched agents
depends_on:
  - docs/bun/phase-7-team-plan.md
  - docs/bun/phase-7-1-diagnostics/fast-refresh-strategy.md
  - docs/bun/phase-7-1-diagnostics/slot-dispatch-analysis.md
  - docs/bun/phase-7-1-diagnostics/cold-start-breakdown.md
created: 2026-04-19
---

# Phase 7.1 — Fast Refresh + Slot dispatch + Cold start

**"빠르고 안 깨지는 HMR"은 Phase 7.0에서 달성. "React state 보존 수준의 DX"를 위한 최종 퍼즐 3조각**을 5-agent × 3 라운드 병렬로 압축.

---

## 0. 진단 요약

| 진단 | 결정적 발견 | 영향 |
|---|---|---|
| R0.1 Fast Refresh | **Bun 1.3.12 `reactFastRefresh: true` 네이티브 지원** — babel/SWC 불필요 | 구현 난도 급감, zero-deps 유지 |
| R0.2 Slot Dispatch | `serverModuleSet`에 slot 추가 = 15-20 라인 (Option B) | 3-4시간 작업, 위험 낮음 |
| R0.3 Cold Start | 626ms median (R0 395 → +231ms 회귀). B_gap 9 marker 추가 선행 필수 | Tier 1만으로 500ms 근접 달성 가능 |

---

## 1. 핵심 목표 (Phase 7.0 미달 항목 완주)

### Fast Refresh
- `.client.tsx` / `.island.tsx` 수정 시 React state (form input, scroll, focused element) **100% 보존**
- HMR boundary 자동 주입 — 사용자가 `import.meta.hot.accept(` 쓰지 않아도 default 동작

### Slot Dispatch
- 36 cells 매트릭스 중 `app/slot.ts` GAP 3개 → **PASS**
- `KNOWN_BUNDLER_GAPS` 에서 `"app/slot.ts"` 제거

### Cold Start
- **≤ 500 ms (P95)** — Phase 7.0 miss (649/583) 완주
- B_gap 9 perf marker 선행 → 향후 측정 인프라 완비

### 비목표 (Phase 7.2로 명시 연기)
- Remix HDR 풀버전 (slot 리페치 without UI remount) — 복잡도 크고 router 재설계 필요
- `import.meta.hot.accept( boundary` 정적 분석 엄밀 구현 — Bun의 `reactFastRefresh: true` 가 흡수
- `prune / send / off / multi-dep accept` Vite 완전판
- HMR token 인증 (원격 dev)
- CSS HMR CLI-layer 벤치
- `mandu.config.ts` 실제 env reload

---

## 2. 분리 가능한 5 concerns

| # | Concern | 라운드 | Agent | 전문성 |
|---|---|---|---|---|
| 1 | Slot dispatch 통합 (Option B) + matrix GAP 복구 | R1 | A | backend-architect |
| 2 | Fast Refresh (`reactFastRefresh: true` + runtime shim + preamble + onLoad boundary) | R1 | B | frontend-architect (가장 복잡) |
| 3 | Cold start Tier 1 (병렬화 + sqlite fire-and-forget + per-island 조건부 skip) | R1 | C | backend-architect |
| 4 | 통합 E2E + perf regression (fixture 확장 + hard assertion 재실행) | R2 | D | quality-engineer |
| 5 | Security audit | R3 | E | security-engineer |

---

## 3. 공유 타입·인프라 계약 — 사전 확정 (Pre-R1, 내가 직접)

### 3.1 `packages/core/src/perf/hmr-markers.ts` 확장 (B_gap 9 marker)

현재 `HMR_PERF` 에 B_gap 9 신규 추가:

```ts
// 신규 — R0.3 에서 미측정 9곳
BOOT_VALIDATE_CONFIG: "boot:validate-config",        // validateAndReport
BOOT_LOCKFILE_CHECK: "boot:lockfile-check",           // validateRuntimeLockfile
BOOT_LOAD_ENV: "boot:load-env",                       // loadEnv
BOOT_SQLITE_START: "boot:sqlite-start",               // startSqliteStore (observability)
BOOT_GUARD_PREFLIGHT: "boot:guard-preflight",         // checkDirectory
BOOT_RESOLVE_PORT: "boot:resolve-port",               // resolveAvailablePort
BOOT_HMR_SERVER: "boot:hmr-server",                   // createHMRServer
BOOT_START_SERVER: "boot:start-server",               // startServer (Bun.serve)
BOOT_WATCH_FS_ROUTES: "boot:watch-fs-routes",         // watchFSRoutes
```

### 3.2 `packages/core/src/runtime/fast-refresh-types.ts` (신규)

```ts
// __MANDU_HMR__ global object (browser runtime)
export interface ManduHMRGlobal {
  /** Register a module as a Fast Refresh boundary. Called by bundler-injected code. */
  acceptFile(moduleUrl: string): void;
  /** Dispatch new module into react-refresh runtime. Called by dispatchReplacement. */
  performReactRefresh(): void;
  /** Query whether a module is currently a registered boundary. */
  isBoundary(moduleUrl: string): boolean;
}

// Bundler plugin helper — emitted by Agent B's onLoad plugin
export interface RefreshBoundaryMetadata {
  moduleUrl: string;
  sources: readonly string[];
  registeredAt: number;
}
```

### 3.3 `docs/bun/phase-7-1-diagnostics/` 이미 존재 — 에이전트 참조

---

## 4. 에이전트 I/O 명세

### Agent A — Slot Dispatch Integration (backend-architect, R1)

**파일**:
- `packages/core/src/bundler/dev.ts` (수정 — serverModuleSet 확장, ~15-20 라인)
- `packages/core/tests/hmr-matrix/fixture-ssg.ts` / `fixture-hybrid.ts` / `fixture-full.ts` (slot 파일 추가)
- `packages/core/tests/hmr-matrix/matrix.spec.ts` (KNOWN_BUNDLER_GAPS에서 `"app/slot.ts"` 제거)
- 신규: `packages/core/src/bundler/__tests__/slot-dispatch.test.ts`

**금지**: Agent B의 영역 (`dev.ts` HMR client script, `build.ts` vendor shim), Agent C의 영역 (`cli/commands/dev.ts` 병렬화 부분)

**Output**:
- `serverModuleSet` 에 `route.slotModule` 경로 추가 (dev.ts:415-426 근처)
- 3 fixture 에 `spec/slots/<route>.slot.ts` 파일 + page.tsx `slotModule` 링크
- matrix GAP 3 cells → PASS
- 단위 테스트 ≥8 (slot 감지 + serverModuleSet 등록 + classifyBatch ssr-only 분류 + fixture smoke)

### Agent B — Fast Refresh (frontend-architect, R1) — 가장 복잡

**파일**:
- `packages/core/src/bundler/build.ts` (수정 — `reactFastRefresh: true` + vendor shim에 `react-refresh/runtime` 추가)
- `packages/core/src/bundler/dev.ts` (수정 — HTML preamble에 RefreshRuntime 초기화 스크립트)
- 신규: `packages/core/src/bundler/fast-refresh-plugin.ts` (Bun.build onLoad 플러그인 — `.client.tsx`/`.island.tsx` 에 boundary 주입)
- 신규: `packages/core/src/runtime/fast-refresh-runtime.ts` (`__MANDU_HMR__` global + `performReactRefresh` wrapper)
- `packages/core/src/runtime/hmr-client.ts` (수정 — `dispatchReplacement` 에서 `performReactRefresh()` 호출)
- 신규: `packages/core/src/bundler/__tests__/fast-refresh.test.ts`

**금지**: Agent A의 영역 (serverModuleSet, slot 관련), Agent C의 영역 (CLI 병렬화)

**Input**: `fast-refresh-types.ts` (내가 작성)

**Output**:
- Bun.build config 에 `reactFastRefresh: isDev` 플래그 ON
- Vendor shim `_vendor-react-refresh.js` 추가
- HTML preamble 에 runtime 초기화 (`window.$RefreshReg$` 등)
- `.client.tsx`/`.island.tsx` 파일의 onLoad 훅에서 `import "__mandu_refresh_boundary__"` 주입 (boundary 등록)
- `dispatchReplacement` 이 React 모듈일 경우 `performReactRefresh()` 호출
- 단위 테스트 ≥12 (Runtime inject + boundary auto-inject + module swap preserving state + React 19 compat)
- 통합 테스트: island 수정 시 form input value 유지 확인 (가능하면 playwright or jsdom)

### Agent C — Cold Start Tier 1 (backend-architect, R1)

**파일**:
- `packages/cli/src/commands/dev.ts` (수정 — boot 순서 병렬화 + B_gap marker 적용)
- `packages/core/src/bundler/build.ts` (수정 — per-island 조건부 skip)
- `packages/core/src/observability/` (수정 — startSqliteStore fire-and-forget)
- 신규: `packages/core/src/bundler/__tests__/cold-start.test.ts`

**금지**: Agent A의 영역 (slot/serverModuleSet), Agent B의 영역 (Fast Refresh)

**Input**: `HMR_PERF` 의 B_gap 9 markers (내가 확장)

**Output**:
- `Promise.all` 로 병렬: validateAndReport / validateRuntimeLockfile / loadEnv / startSqliteStore (서로 독립)
- 단 `validateAndReport` 실패 시 exit 1 흐름 유지 — Promise.allSettled + 실패 검사
- startSqliteStore 는 fire-and-forget (server ready 후 background)
- Per-island splitting: hydration 없는 route 는 island bundle skip
- 9 boot 단계에 `mark()` + `measure()` 설정
- 단위 테스트 ≥8

**Target**: `demo/starter` cold start **≤ 500 ms P95** (`scripts/hmr-bench.ts` 재실행으로 검증)

### Agent D — Integration E2E + Perf Regression (quality-engineer, R2)

**파일**:
- `packages/core/tests/hmr-matrix/fixture-*.ts` (A가 건드린 것 기반 — slot + fast-refresh-friendly 컴포넌트 추가)
- 신규: `packages/core/tests/hmr-matrix/fast-refresh.spec.ts` (state preservation 시나리오)
- `scripts/hmr-bench.ts` (수정 — B_gap breakdown 출력 추가)
- `docs/bun/phase-7-1-benchmarks.md` (신규 — 최종 리포트)

**Input**: R1 A+B+C 전부

**Output**:
- Fast Refresh E2E: island 내 useState 값 유지 across file edit (headless browser 또는 jsdom)
- Slot dispatch E2E: matrix GAP 3 cells → PASS 확인
- Cold start bench 재실행: 500 ms P95 hard assertion pass
- `phase-7-1-benchmarks.md` 에 before/after 비교 (Phase 7.0 vs 7.1)

### Agent E — Security Audit (security-engineer, R3)

**파일**: `docs/security/phase-7-1-audit.md` + 발견 시 fix

**Focus**:
- Fast Refresh onLoad 플러그인 — 소스 파일 변조 주입 가능성
- `__MANDU_HMR__` global exposure — 악의적 스크립트가 `performReactRefresh` 호출?
- Vendor shim `react-refresh/runtime` 경로 traversal
- Fast Refresh가 주입한 코드의 CSP 호환
- HTML preamble injection — 기존 CSP 정책 위반?
- Boot 병렬화 시 race (env load 전에 sqlite?)

**Deliverable**: Critical/High 즉시 fix + 감사 리포트

---

## 5. 의존성 DAG

```
[Pre-R1 (me)]
  hmr-markers.ts (B_gap 9 확장) + fast-refresh-types.ts
        ↓
[R1 병렬 3 — 파일 충돌 관리]
  A: Slot dispatch            ─┐
     (dev.ts:415-426)            ├─→ merge ──┐
  B: Fast Refresh              ─┤             │
     (build.ts + 신규 파일들)    │            │
  C: Cold start Tier 1         ─┘            │
     (cli/commands/dev.ts)                    ↓
[R2 단일 — R1 전부 소비]
  D: Integration + bench regression
                                        ↓
[R3 단일 — merge gate]
  E: Security audit
```

**병렬 시 파일 충돌**:
- A: `dev.ts:415-426` (manifest 순회 / serverModuleSet)
- B: `dev.ts:600+` (HMR client script preamble) + `build.ts` (vendor shim)
- C: `cli/commands/dev.ts` 전체 + `build.ts` per-island

**dev.ts 충돌 위험**: A (line 415-426) vs B (line 600+) — 섹션 분리. Phase 7.0 A+C 패턴 재현.
**build.ts 충돌 위험**: B (vendor shim 추가) vs C (per-island skip). 브리핑에 함수 경계 명시.

---

## 6. 품질 게이트

1. 각 에이전트 단위 테스트 요구 수량 달성 (A ≥8, B ≥12, C ≥8, D 통합)
2. `bun run test:core` 2199+ pass, 0 fail (Phase 7.0 기준선)
3. `bun run test:cli` 180+ pass
4. `bun run typecheck` 4 패키지 clean
5. **R2 hard assertion**: Cold start ≤ 500 ms P95 (hmr-bench.ts)
6. **R2 Fast Refresh E2E**: island useState 값 유지 확인

---

## 7. 리스크 & 방어

| 리스크 | 담당 | 방어 |
|---|---|---|
| R7.1-A: Bun `reactFastRefresh` 플래그가 실제 동작 안 함 | B | R0.1에서 실측 확인됨. 재현 스크립트 있음 |
| R7.1-B: `import.meta.hot`이 번들 시 `undefined` 치환 — accept() 무효화 | B | R0.1 결론: `define` 또는 별도 boundary 테이블로 우회 |
| R7.1-C: A와 B가 `dev.ts` 동시 수정 → conflict | A+B | Phase 7.0 교훈 — line 범위 엄격 명시 (415-426 vs 600+) |
| R7.1-D: C 병렬화로 race condition — env load 전 sqlite 등 | C + E | allSettled + 의존성 체크 + 감사 |
| R7.1-E: React 19 + react-refresh 호환 이슈 | B | `react-refresh@>=0.18.0` 사용 (R0.1 결론) |
| R7.1-F: Fast Refresh 주입 코드가 CSP 위반 | B + E | E가 감사 — `'self'` 허용 내에서만 동작 |
| R7.1-G: Cold start 500 ms 미달 (Tier 1만으로 부족) | C + D | D 벤치에서 pass 여부 확인 — 미달 시 Tier 2 부분 착수 (vendor shim 캐시) |

---

## 8. 커밋 전략

- `feat(core): Phase 7.1.R1 — slot dispatch + Fast Refresh + cold start Tier 1`
- `test(core): Phase 7.1.R2 — integration E2E + cold start benchmark`
- `security(core): Phase 7.1.R3 — audit report + fixes`

---

## 9. 예상 시간

- Pre-R1 (me): 15-20분
- R1 (병렬 3, B 가장 복잡): 50-70분
- R2 단일: 25-35분
- R3 단일: 15-20분

**Wall clock**: 1.5~2.5시간

---

## 10. 실행 체크리스트

- [x] R0 진단 3 에이전트 완료 (Fast Refresh / Slot / Cold start)
- [x] 팀 플랜 문서 작성 (이 문서)
- [ ] Pre-R1: hmr-markers.ts 확장 + fast-refresh-types.ts 작성
- [ ] R1 3 에이전트 브리핑 + 파견 (line 범위 엄격)
- [ ] R1 완료 검증 + 커밋
- [ ] R2 단일 파견 + 하드 어서션 pass 확인 + 커밋
- [ ] R3 보안 감사 + 커밋
- [ ] Phase 7.1 push + 종료 보고
