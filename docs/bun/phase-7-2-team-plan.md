---
title: "Phase 7.2 — SPEED 완주 + DX 완성 + Security Hardening"
status: execution-plan
created: 2026-04-19
depends_on:
  - docs/bun/phase-7-team-plan.md
  - docs/bun/phase-7-1-team-plan.md
  - docs/bun/phase-7-1-benchmarks.md
  - docs/security/phase-7-1-audit.md
---

# Phase 7.2

Phase 7.1의 정직한 미달 3개 + 감사 Medium/Low 4개를 완주. 6-agent × 3 라운드.

## 1. 스코프 3 그룹

### 🥇 SPEED (Agent A)

| # | 항목 | 예상 효과 |
|---|---|---|
| S1 | **B5 live wire-up fix** — Phase 7.0.R3b에서 `changedFile` 전달 완성했지만 R2 D 실측 결과 **live dev 경로에서 미발동**. 원인 진단 + fix. | 실사용자 live SSR reload에서 100 routes × 0.075ms cache hit 발동 |
| S2 | **Tier 2 vendor shim disk cache** — `_vendor-react.js`, `_vendor-react-dom.js`, `_vendor-react-refresh.js`, `_fast-refresh-runtime.js` 를 `React/Bun 버전 해시` 기반 디스크 캐시. Warm 부팅 시 재빌드 스킵. | Cold tmpdir 910ms → ~500ms, warm 493ms → ~350ms |
| S3 | **CLI-layer latency bench** — `mandu dev` spawn + `MANDU_PERF=1` stdout 파싱 벤치 스크립트. 실사용자 walltime 정확 측정 가능. | 향후 회귀 방지 infra |

### 🥈 COMPLETENESS (Agent B)

| # | 항목 | 출처 |
|---|---|---|
| C1 | **Playwright browser state preservation E2E** — 실제 브라우저에서 island useState / form input / scroll 유지 증명 | 7.1.R2 D deferred |
| C2 | **HDR 풀버전** — slot (`.slot.ts`) 수정 시 **UI remount 없이 loader 데이터만 refetch** (Remix HDR 스타일). 새 HMR message type `slot-refetch` + 클라이언트 router에서 loader 재호출. | 7.0 team plan §3.2 |

### 🥉 SECURITY HARDENING (Agent C)

| # | 항목 | 출처 |
|---|---|---|
| H1 | **CSP nonce** inline preamble + Content-Security-Policy 헤더 nonce 연동 (dev only) | 7.1.R3 M-01 |
| H2 | **manifest.shared.fastRefresh URL schema 검증** zod | 7.1.R3 M-02 |
| H3 | **acceptFile URL length cap + slotModule path regex 강화** | 7.1.R3 L-01+L-03 |
| H4 | **$RefreshReg$ / $RefreshSig$ prod smoke test** — `mandu build` 결과물에 dev-only symbol 누출 없음 assertion | 7.1.R3 L-02 |

### 연기 (Phase 7.3)
- A1/A2 Vite API 완전판 (prune/send/off/multi-dep accept, HMR token auth)
- `mandu.config.ts` 실제 env reload (Bun AsyncLocalStorage)
- Cold start target recalibration

---

## 2. 공유 계약 (Pre-R1, 내가 직접)

### 2.1 `packages/core/src/bundler/hmr-types.ts` 확장

```ts
// HDR (Hot Data Revalidation) payload — Agent B의 slot-refetch
export interface HDRPayload {
  type: "slot-refetch";
  routeId: string;                     // which route to refetch
  slotPath: string;                    // which slot changed
  rebuildId: number;                   // monotonic, replay-compatible
}
```

### 2.2 `packages/core/src/bundler/vendor-cache-types.ts` (신규)

```ts
export interface VendorCacheManifest {
  version: 1;
  bunVersion: string;
  reactVersion: string;
  reactDomVersion: string;
  reactRefreshVersion: string;
  entries: Record<string, { path: string; size: number; hash: string }>;
  generatedAt: string;
}

export const VENDOR_CACHE_FILENAME = "vendor-cache.json";
export const VENDOR_CACHE_DIR = ".mandu/vendor-cache";
```

### 2.3 `packages/core/src/perf/hmr-markers.ts` 확장

```ts
// Tier 2
VENDOR_CACHE_HIT: "vendor:cache-hit",
VENDOR_CACHE_MISS: "vendor:cache-miss",
VENDOR_CACHE_WRITE: "vendor:cache-write",

// HDR
HDR_REFETCH: "hdr:refetch",
```

---

## 3. 에이전트 I/O

### Agent A — SPEED (backend-architect, R1)

**파일**:
- `packages/cli/src/util/handlers.ts` — B5 검증 (로그 + perf marker 확인)
- `packages/cli/src/util/bun.ts` — createBundledImporter 수정 (필요 시)
- `packages/core/src/bundler/build.ts` — vendor shim 캐시 로직
- 신규: `packages/core/src/bundler/vendor-cache.ts` — 캐시 readwrite + hash
- 신규: `scripts/cli-bench.ts` — CLI spawn bench
- 신규: `packages/core/src/bundler/__tests__/vendor-cache.test.ts`
- 신규: `packages/cli/src/util/__tests__/b5-live-wire.test.ts`

**범위 엄격**: `packages/core/src/bundler/dev.ts` 수정 금지 (B/C 영역). `ssr.ts/streaming-ssr.ts` 금지.

**Output**:
- S1: dev 경로에서 HIT/MISS 로그 확인 가능한 실측 제시 + 원인 fix (signature thread 완전 검증)
- S2: 두 번째 boot 부터 `vendor:cache-hit` 로 재빌드 스킵
- S3: `bun run scripts/cli-bench.ts` 실행 시 실제 ready 시간 측정 + P50/P95 출력

### Agent B — COMPLETENESS (frontend-architect, R1)

**파일**:
- `packages/core/src/runtime/hmr-client.ts` — slot-refetch 핸들러 추가
- `packages/core/src/bundler/dev.ts` — **오직 line 1722+ 범위** (HMR 클라이언트 스크립트 + broadcast 로직 — Phase 7.0.C가 쓴 영역)
- `packages/core/src/filling/filling.ts` 또는 `packages/core/src/router/client-router.ts` — client-side loader re-invocation
- `packages/core/src/runtime/ssr.ts` / `streaming-ssr.ts` — slot metadata HTML embed (C와 섹션 분리)
- 신규: `demo/auth-starter/tests/e2e/fast-refresh.spec.ts` — Playwright browser state preservation
- 신규: `packages/core/src/bundler/__tests__/hdr.test.ts`

**범위 엄격**: `cli/util/bun.ts` 금지 (A 영역), `bundler/build.ts` 수정 금지 (A가 vendor cache). `fast-refresh-plugin.ts` 금지 (C가 URL cap).

**Output**:
- C1: demo/auth-starter 의 Playwright 세트에 Fast Refresh 시나리오 ≥3 test
- C2: slot 수정 → WS broadcast `slot-refetch` → client router의 loader 재호출 → `React.startTransition` 래핑된 props 업데이트 → 기존 컴포넌트 트리 유지 (unmount/remount 없음)

### Agent C — SECURITY HARDENING (security-engineer, R1)

**파일**:
- `packages/core/src/runtime/ssr.ts` + `streaming-ssr.ts` — CSP nonce 주입 (B와 섹션 분리: B는 slot metadata, C는 script nonce)
- 신규: `packages/core/src/bundler/manifest-schema.ts` — zod로 manifest 검증
- `packages/core/src/bundler/types.ts` — shared.fastRefresh schema
- `packages/core/src/bundler/fast-refresh-plugin.ts` — URL length cap (기본 2KB)
- `packages/core/src/bundler/dev.ts` — **slotModule path regex 강화만**, B 영역 (line 1722+) 침범 금지
- 신규: `packages/core/src/bundler/__tests__/prod-smoke.test.ts`
- 신규: `packages/core/src/bundler/__tests__/csp-nonce.test.ts`

**범위 엄격**: A의 `vendor-cache.ts` 금지, B의 `hmr-client.ts` 금지.

**Output**:
- H1: `<script nonce="...">` + `Content-Security-Policy: script-src 'self' 'nonce-...'` 헤더 설정 가능
- H2: manifest.shared.fastRefresh 가 zod schema 통과 실패 시 throw
- H3: URL > 2KB 또는 `slotModule` path regex 불일치 시 boundary 주입 skip + warn
- H4: `bun run build` 결과물 번들에 `$RefreshReg$`, `$RefreshSig$`, `__MANDU_HMR__` 없음

---

## 4. 의존성 DAG

```
[Pre-R1 (me)]
  hmr-types.ts (HDRPayload) + vendor-cache-types.ts + hmr-markers.ts 확장
        ↓
[R1 병렬 3]
  A: SPEED                 ─┐
  B: COMPLETENESS           ├─→ merge
  C: SECURITY HARDENING    ─┘
        ↓
[R2 단일 — 벤치 + 재판정]
  D: Cold 500ms hard assertion 재검 + B5 HIT 실증 + HDR E2E confirm
        ↓
[R3 단일]
  E: Security audit (CSP nonce 실효성 + HDR attack surface)
```

**파일 충돌 관리**:
- `dev.ts`: B (line 1722+) vs C (slotModule regex, line 415~460) — 섹션 분리 엄격
- `ssr.ts`/`streaming-ssr.ts`: B (slot metadata) vs C (CSP nonce) — 함수 경계 분리
- `build.ts`: A 단독
- `fast-refresh-plugin.ts`: C 단독 (URL cap)
- `hmr-client.ts`: B 단독 (slot-refetch)

---

## 5. 품질 게이트

1. 각 에이전트 단위 테스트 요구 수량 달성 (A ≥15, B ≥10 unit + Playwright ≥3, C ≥10)
2. `bun run test:core` baseline 유지
3. `bun run typecheck` 4 패키지 clean
4. R2 hard assertion:
   - **Cold start (tmpdir) ≤ 500 ms P95** (Tier 2 cache hit 후)
   - **B5 live SSR reload cache-hit 발동** — perf marker 로 증명
   - **Playwright Fast Refresh** — form input 값 유지 확인
5. R3 Critical/High 0

---

## 6. 리스크 & 방어

| 리스크 | 담당 | 방어 |
|---|---|---|
| R7.2-A: B5 미발동 원인이 복잡 (여러 hop 의 signature 미전달) | A | 실측 → 원인 → fix 순서. 완전 실패 시 Phase 7.3 로 연기 |
| R7.2-B: Vendor cache stale (Bun/React 버전 못 잡아서) | A | 해시 키에 Bun.version + React.version + refresh.version 전부 포함 |
| R7.2-C: HDR 이 React startTransition 없이 설계되면 flash | B | React 19의 `startTransition` 강제 래핑 |
| R7.2-D: CSP nonce 적용 시 기존 프로젝트 CSP 설정 charged | C + E | dev only + opt-out env `MANDU_CSP_NONCE=0` |
| R7.2-E: Playwright 의존성으로 CI 느려짐 | B | `test:e2e` 별도 job, `test:unit` 과 분리 |
| R7.2-F: dev.ts 3 에이전트 수정 시 conflict | B + C | A는 dev.ts 금지, B는 line 1722+, C는 line 415~460만. Pre-R1 에서 line 범위 엄격히 명시 |

---

## 7. 커밋 전략

- `feat(core,cli): Phase 7.2.R1 — SPEED (B5 live + vendor cache + CLI bench) + COMPLETENESS (HDR + Playwright) + HARDENING (CSP nonce + schema + caps)`
- `test(core): Phase 7.2.R2 — hard assertion 재판정 + HDR E2E`
- `security(core): Phase 7.2.R3 — audit`

---

## 8. 예상 시간

- Pre-R1 (me): 15~20분
- R1 병렬 3 (B 가장 복잡): 50~70분
- R2 단일: 25~35분
- R3 단일: 15~20분

**Wall clock**: 1.5~2.5시간
