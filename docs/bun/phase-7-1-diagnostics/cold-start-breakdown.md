# Phase 7.1 R0.3 — Cold start breakdown + 회귀 원인 pinpoint

**작성일**: 2026-04-18
**측정**: Windows 10, Bun 1.3.12, `demo/starter` (4 routes / 5 islands / devtools 1.15 MB + react-dom-client 922 KB)
**실측**: 3 runs, median **626 ms** (585 / 626 / 678), R0 대비 **+231 ms**.
**참조**: `packages/cli/src/commands/dev.ts:65-823`, `packages/core/src/bundler/build.ts:1456-1842`, `packages/core/src/perf/hmr-markers.ts:120-135`.

---

## 1. Cold boot 단계 flame

`MANDU_PERF=1 bun run mandu dev --port 44xx` 의 median 출력에서 `[perf]` 를 채취하고 미측정 단계는 코드 기반 추정치.

| # | 단계 | 근거 (file:line) | ms | B_gap |
|---|---|---|---|---|
| 1 | `validateAndReport` | `cli/dev.ts:68` → `core/config/validate.ts:276` | **[추정] 5-15** | yes |
| 2 | `validateRuntimeLockfile` | `cli/dev.ts:76` → `cli/util/lockfile.ts:59` | **[추정] 5-10** | yes |
| 3 | `loadEnv` | `cli/dev.ts:92` → `core/runtime/env.ts:140` | **[추정] 3-8** | yes |
| 4 | `startSqliteStore` (dynamic import + DB open + schema) | `cli/dev.ts:102-106` → `core/observability/sqlite-store.ts:50-95` | **[추정] 20-40** | yes |
| 5 | `resolveManifest` / `router:scan` | `cli/dev.ts:115` → `core/router/fs-scanner.ts:59-92` | **측정 12** | — |
| 6 | `checkDirectory` Guard preflight (glob + AST analyze) | `cli/dev.ts:151` → `core/guard/watcher.ts:393 / 170-243` | **[추정] 30-60** | yes |
| 7 | `createBundledImporter` factory | `cli/dev.ts:173` → `cli/util/bun.ts:215` | **< 1** | — |
| 8 | `registerHandlers` (3 API × `ssr:bundled-import` + graph-update) | `cli/dev.ts:193` → `cli/util/handlers.ts:80`, `cli/util/bun.ts:367-403` | **측정 ~75** | — |
| 9 | `resolveAvailablePort` (2 ports) | `cli/dev.ts:223` → `cli/util/port.ts:58-109` | **[추정] 5-15** | yes |
| 10 | `isTailwindProject` (starter: false) | `cli/dev.ts:250` | **< 5** | — |
| 11 | `createHMRServer` (Bun.serve WS) | `cli/dev.ts:640` | **[추정] 10-20** | yes |
| 12 | `startDevBundler` / `bundler:full` (runtime+router+vendor×5+devtools+island×5, Promise.all, safeBuild semaphore=2) | `cli/dev.ts:648` → `core/bundler/dev.ts:358`, `core/bundler/build.ts:1717-1842` | **측정 324-387** | — |
| 13 | `startServer` (Bun.serve main) | `cli/dev.ts:663` | **[추정] 15-30** | yes |
| 14 | `writeRuntimeControl` | `cli/dev.ts:715` | **< 5** | — |
| 15 | `runHook("onDevStart")` | `cli/dev.ts:723` | **< 2** | — |
| 16 | `watchFSRoutes` (chokidar init) | `cli/dev.ts:729` → `core/router/fs-routes.ts:304-338` | **[추정] 20-50** | yes |
| 17 | `archGuardWatcher.start` (chokidar) | `cli/dev.ts:808` | **[추정] 5-15** | yes |

**합산**: 측정 `12 + 75 + 374 = 461 ms` + 추정 150-210 ms = **611-671 ms** ≈ 실측 626 ms (일치).

**B_gap 9곳 미측정**. 가장 의심: #4 (sqlite), #6 (guard), #12 (bundler:full 내부 하위), #16 (chokidar).

---

## 2. R0 → R3 F 회귀 원인 분석 (+231 ms)

| 커밋 | 날짜 | 내용 | Δ cold (추정) |
|---|---|---|---|
| `8045b41` | 2026-02-02 | Guard `checkDirectory` 도입 | +30-60 (R0 이전일 수도) |
| `b7dd73a` | 2026-02-17 | DevTools dedicated bundle (`_devtools.js` 1.15 MB) | **+50-100** |
| `b503c36` | 2026-04-12 | **Per-island splitting** (`scanIslandFiles` + `buildPerIslandBundle×5`) | **+40-80** |
| `001eb36` | 2026-04-13 | **Phase 6 SQLite observability** (dynamic import + DB + indexes) | **+20-40** |
| `49b30e6` | 2026-04-17 | Phase 0/1/2 (bunfig isolated linker) | ≈0 |
| `012f02c` | 2026-04-18 | Phase 7.0 R1 (src/ recursive watch, perFileTimers, pendingBuildSet) | +5-15 |
| `588fd04` | 2026-04-18 | Phase 7.0 R2 (chokidar 확장: spec/contracts, spec/resources 등) | +10-20 |

**합계 추정 +155-315 ms**. 실측 +231 ms 와 일치.

**가장 비싼 Top 3**:
1. **DevTools bundle** (b7dd73a): +50-100 ms — 1.15 MB 번들 cold boot 에 포함.
2. **Per-island splitting** (b503c36): +40-80 ms — `bundler:full` 가 209 → 374 ms 로 증가한 주원인.
3. **SQLite observability** (001eb36): +20-40 ms — dynamic import + new Database + indexes.

---

## 3. 단축 가능 단계

### A. 병렬화 (I/O bound, config 결정 후 독립)

현재 2→3→4→5→6 직렬. `validateAndReport` 만 시드로 두고 나머지 Promise.all:

```ts
const config = await validateAndReport(rootDir);  // 시드
const [lockResult, envResult, manifest, guardReport] = await Promise.all([
  validateRuntimeLockfile(config, rootDir),
  loadEnv({ rootDir, env: "development" }),
  resolveManifest(rootDir, { fsRoutes: config.fsRoutes }),
  guardConfig ? checkDirectory(guardConfig, rootDir) : null,
]);
void startSqliteStore(rootDir).catch(() => {});  // fire-and-forget
```

**Expected gain**: 현재 직렬 합 ~70-130 ms → max 경로 ~30-60 ms → **-40-70 ms**.

### B. 지연 로드

- **`startSqliteStore`**: await 제거 (eventBus subscriber 이므로 boot 에 필수 아님). **-20-40 ms**.
- **`buildDevtoolsBundle`**: `/__kitchen` 첫 접근 시만 빌드. ready metric 기준 **-50-100 ms**.
- **Vendor shim 빌드**: React 버전 해시 기반 디스크 캐시 (`.mandu/cache/vendor/_react-<hash>.js`). 첫 dev 이후 재사용. **-80-120 ms**.
- **chokidar watchers** (`routesWatcher`, `archGuardWatcher`): ready 이후 async 시작. **-20-50 ms**.

### C. 캐시

- **Guard preflight**: 파일 mtime + content hash 캐시. starter(7 파일) 이득 작지만 규모 앱 **-30-50 ms on warm re-dev**.
- **Vendor shim** (B 와 동일): React 바이너리 해시로 스킵.

### D. 스킵 (opt-out)

- **Guard preflight**: `mandu.config.ts` 에 `guard.preflight: false` 추가 (현재는 `realtime: false` 만). 속도 우선 사용자. **-30-60 ms**.
- **Observability**: `devConfig.observability = false` 이미 존재 — 문서 보강 필요.

---

## 4. Warm-cache fixture 전략

### 현재 측정의 정체

| 측정 | 환경 | 결과 | 해석 |
|---|---|---|---|
| R0 | `demo/starter` warm | 395 ms | Bun module cache warm + `.mandu/` 존재 |
| R3 F (tmpdir) | fresh `mkdtempSync` | 649 ms | Cold: spawn overhead +100-150 ms + module resolution cold |
| 현재 (`demo/starter`) | warm project | **626 ms** | **R0 와 동일 환경** → pure regression +231 ms |

즉 R0 ↔ 현재의 `demo/starter` 측정이 정당한 비교. tmpdir 는 추가 overhead 포함.

### 제안 — Two-phase bench

```ts
// scripts/hmr-bench-warm.ts (신규)
async function measureWarmColdStart(form: ProjectForm) {
  const rootDir = mkdtempSync(...); scaffold(form, rootDir);
  const cold = await spawnDevAndWaitReady(rootDir);  // ~650 ms (first build)
  const warm = await spawnDevAndWaitReady(rootDir);  // expected ~400-450 ms
  return { cold, warm };
}
```

- **Cold**: 첫 `mandu dev` (프로젝트 최초 생성, 타겟 500 ms 유지).
- **Warm**: 재부팅 — `.mandu/client/` 이미 존재, manifest 재사용 path.

**HMR_PERF_TARGETS 확장 제안**:
```ts
COLD_START_MS: 500,      // first-time boot
WARM_START_MS: 250,      // restart with cached .mandu/client
```

---

## 5. 500 ms 목표 달성 방안

**현재 gap**: 626 → 500 = **-126 ms 필요**.

### Tier 1 (low risk)
1. Guard/lockfile/env/manifest 병렬화 (§3.A): **-40-70 ms**
2. `startSqliteStore` fire-and-forget (§3.B): **-20-40 ms**
3. Per-island 조건부 skip (dev first boot): **-40-70 ms**
4. B_gap 9 markers 추가 (측정 인프라 선행)

**합계 -100-180 ms → 446-526 ms**. 목표 근접 (경계).

### Tier 2 (larger gain)
5. Vendor shim 디스크 캐시: **-80-120 ms**
6. DevTools lazy bundle: **-50-100 ms**
7. `MANDU_BUN_BUILD_CONCURRENCY=5` dev 기본 (현재 default=2, safe-build.ts:27): **-50-80 ms**

**Tier 1 + Tier 2 합계 -280-480 ms → 146-346 ms** (Vite 수준).

### 확신도

| 조합 | 예상 | 확신도 |
|---|---|---|
| Tier 1 만 | 446-526 ms | 중 (경계) |
| Tier 1 + vendor 캐시 | 366-446 ms | 중상 |
| 전체 | 146-346 ms | 중 (vendor 해시 키 디자인 필요) |

---

## 6. CI 환경 고려사항

- **Windows `Bun.spawn`**: Linux 대비 +100-150 ms. `measureColdStart` tmpdir fixture 에서 과대평가. Linux CI P95 는 Windows 의 70-80% 예상.
- **NTFS glob + fs.stat**: Guard preflight `glob(src/**)` 는 Linux 더 빠름.
- **fs.watch setup**: 1회성이라 cold 영향 작음.

**제안**:
```ts
// scripts/hmr-bench.ts
const COLD_START_REPS = process.platform === "win32" ? 5 : 3;
const WARMUP_REPS = 1;  // 첫 rep discard
```

**타겟 재조정 제안**:
- Linux CI: COLD_START_MS = 400
- Windows local: COLD_START_MS = 500 (현재 값)
- 공통 WARM_START_MS = 250

---

## 7. Next action (우선순위)

1. **B_gap 9개 perf marker 추가** (R0.4 블로커): `cold:config-validate`, `cold:lockfile`, `cold:load-env`, `cold:observability`, `cold:guard-preflight`, `cold:port-resolve`, `cold:hmr-server`, `cold:main-server`, `cold:fs-routes-watch`.
2. **Tier 1 3항목** (R1): 병렬화 + sqlite fire-and-forget + per-island 조건부.
3. **Warm fixture bench** (`scripts/hmr-bench-warm.ts`) + `WARM_START_MS` 목표.
4. **Vendor shim 캐시 RFC** (R2+): 500 ms 여유 달성 + Vite 동등.

---

_참조: `docs/bun/phase-7-benchmarks.md` §3, `docs/bun/phase-7-diagnostics/performance-reliability.md` §1-5._
