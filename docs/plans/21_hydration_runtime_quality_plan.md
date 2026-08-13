# 21. Hydration Runtime Quality Plan

작성일: 2026-05-23
상태: Active subordinate plan under Refoundation Phase 1
최종 수정일: 2026-05-23
기준 작업:

- GitHub issue #309 이후 hydration/island/runtime 수정
- `@mandujs/core@0.54.15`, `@mandujs/edge@0.4.63` 배포 후 재검수
- 코드 조사 범위: router, bundler, runtime, client serialization, diagnose, MCP, agent verify, release scripts

---

## 0. 결론

현재 Mandu의 가장 큰 약점은 기능이 부족한 것이 아니라 **client boundary를 다루는 경로가 여러 세대로 겹쳐 있는 것**이다.

지금은 다음 세 경로가 동시에 존재한다.

1. page 단위 `clientModule` 기반 hydration
2. `*.island.tsx` / `*.client.tsx` 기반 island hydration
3. compiler-owned client boundary transform 기반 partial island hydration

이번 이슈에서 버그가 계속 나온 이유도 대부분 이 구조에서 나온다. 서버 렌더링, route scanner, bundler manifest, generated browser runtime, MCP/diagnose 도구가 같은 개념을 서로 다른 이름과 규칙으로 다루고 있어서 한 파일을 고쳐도 다른 경로에 회귀가 남는다.

우선순위는 명확하다.

1. compiler-owned client boundary를 표준 경로로 고정한다.
2. 런타임 React element walker를 제거하거나 compatibility fallback으로 격하시킨다.
3. regex 기반 TS/TSX 분석을 AST 기반 분석으로 교체한다.
4. generated runtime string 안의 중복 serialization 로직을 공유 모듈로 이동한다.
5. 실제 브라우저 hydration E2E를 release gate에 넣는다.
6. npm publish 전에 local package metadata와 npm metadata drift를 차단한다.

---

## 1. 현재 구조 지도

### 1.1 Route Scan

관련 파일:

- `packages/core/src/router/fs-scanner.ts`
- `packages/core/src/router/fs-routes.ts`
- `packages/core/src/router/client-entry.ts`
- `packages/core/src/bundler/client-boundary-transform.ts`

현재 상태:

- `fs-scanner.ts`는 `transformClientBoundaries()`로 compiler-owned boundary를 수집한다.
- 동시에 `parsePageHydrationConfig()`는 regex로 `export const hydration`을 읽는다.
- `client-entry.ts`는 import/default export JSX 여부를 regex와 수동 문자열 파싱으로 추론한다.
- `fs-routes.ts`는 legacy `.client.tsx` route client module에 기본 `priority: "immediate"`를 부여하고, boundary route는 `priority: "visible"`을 기본값으로 둔다.

문제:

- 같은 "client hydration"이 route-level mount와 nested boundary로 나뉘어 다른 default priority를 가진다.
- compiler transform은 AST 기반인데, hydration config와 legacy client entry 추론은 regex 기반이다.
- scanner 단계에서 이미 두 세대의 규칙이 섞이기 때문에 이후 bundler/runtime에서 예외 처리가 증가한다.

### 1.2 SSR Runtime

관련 파일:

- `packages/core/src/runtime/page-render-response.ts`
- `packages/core/src/internal/client-boundary.ts`
- `packages/core/src/runtime/handlers.ts`

현재 상태:

- `__ManduClientBoundary`는 명시적인 marker와 `script[data-mandu-props]`를 출력한다.
- `renderPageResponse()`는 route target에 `partial`이 있을 때 `resolveAndWrapInlineClientHydration()` fallback을 수행한다.
- fallback은 React element tree를 순회하면서 일부 sync function component를 직접 호출한다.
- hook 의존 가능성은 `Function.prototype.toString()` 기반 regex로 추정한다.

문제:

- React function component를 React renderer 밖에서 호출하는 것은 구조적으로 위험하다.
- hook 사용 여부를 함수 문자열로 맞히는 방식은 안전한 contract가 아니다.
- 이번 수정으로 obvious hook case는 피했지만, side effect가 있는 sync component나 custom hook 래퍼는 계속 위험하다.
- 이 fallback이 남아 있으면 compiler boundary path가 좋아져도 runtime path가 계속 별도 버그 표면으로 남는다.

### 1.3 Browser Runtime / Bundler

관련 파일:

- `packages/core/src/bundler/build.ts`
- `packages/core/src/bundler/manifest-schema.ts`
- `packages/core/src/bundler/types.ts`
- `packages/core/src/client/serialize.ts`

현재 상태:

- `BundleManifest`는 `boundaries`를 가진다.
- generated runtime은 `script[data-mandu-props]`, `data-props`, `window.__MANDU_DATA__`를 모두 읽는다.
- `build.ts` 안의 runtime template 문자열에 `deserializeManduProps()` 구현이 중복으로 들어 있다.
- `serialize.ts`에도 Mandu value serialization/deserialization 로직이 있다.

문제:

- runtime template은 긴 문자열이라 typecheck, import graph check, dead code check의 보호를 덜 받는다.
- serialization contract가 `serialize.ts`와 generated runtime 문자열에 중복되어 drift가 나기 쉽다.
- Date/Map/Set/URL 등 non-plain value 지원이 늘어날수록 중복 구현은 더 위험해진다.

### 1.4 Diagnostics / MCP / Agent

관련 파일:

- `packages/core/src/diagnose/checks.ts`
- `packages/core/src/agent/verify.ts`
- `packages/mcp/src/tools/hydration.ts`
- `packages/mcp/src/tools/spec.ts`

현재 상태:

- diagnose에는 route manifest boundary와 bundle manifest boundary consistency check가 있다.
- MCP에는 `mandu.route.boundaries`가 있고 `includeBundle`로 bundle manifest와 대조할 수 있다.
- hydration MCP surface에는 `mandu.pageClientMount.list`, legacy alias `mandu.island.list`, `mandu.hydration.set`, `mandu.hydration.addClientSlot`이 있다.
- `agent verify`는 public API와 target boundary 변경 시 적절한 check를 추천한다.

문제:

- agent workflow가 hydration/runtime 변경을 감지했을 때 browser-level hydration 검증까지 강제하지 않는다.
- MCP hydration surface는 page client mount 중심이고, compiler-owned nested boundary가 주인공인 흐름과 용어가 아직 완전히 정리되지 않았다.
- `mandu.route.boundaries`는 좋은 도구지만 issue 조사/수정 workflow의 기본 첫 단계로 충분히 올라와 있지 않다.

### 1.5 Release

관련 파일:

- `package.json`
- `scripts/pre-publish-check.ts`
- `scripts/publish.ts`
- `scripts/check-npm-drift.ts`

현재 상태:

- `check:publish`는 `scripts/pre-publish-check.ts`만 실행한다.
- `scripts/check-npm-drift.ts`는 존재하지만 `check:publish`에 포함되어 있지 않다.
- `publish.ts`는 npm에 같은 version이 이미 있으면 dry-run validation만 하거나 skip한다.

문제:

- 로컬 `package.json` metadata가 변경되었지만 version이 npm과 같으면 publish가 skip된다.
- 이 경우 "로컬 수정이 전부 npm에 올라갔다"는 질문에 답하기 어려운 상태가 된다.
- CLI/MCP처럼 version bump가 없지만 dependency range나 metadata가 바뀐 package는 npm metadata가 그대로 남을 수 있다.

---

## 2. 약점 목록

### P0. Runtime element walker가 React contract 밖에서 component를 호출한다

근거:

- `packages/core/src/runtime/page-render-response.ts`
- `resolveAndWrapInlineClientHydration()`
- `functionComponentLooksHookDependent()`

위험:

- invalid hook call
- SSR 중 side effect 발생
- async/sync component 차이에 따른 비결정성
- wrapper component가 client boundary를 감싸면 boundary 누락

개선 방향:

- compiler-owned boundary transform을 정상 경로로 고정한다.
- runtime walker는 legacy compatibility flag 뒤로 숨긴다.
- 새 프로젝트와 새 route에서는 runtime walker가 실행되지 않도록 한다.
- 제거 전까지는 diagnostic warning을 출력한다.

완료 기준:

- 일반 SSR path에서 React function component를 직접 호출하지 않는다.
- `page-render-response.ts`는 marker emission과 response shaping만 담당한다.

### P0. Browser hydration E2E가 release gate가 아니다

근거:

- 현재 테스트는 generated runtime unit/integration과 server HTML 검증이 중심이다.
- 실제 브라우저에서 bundle load, click/interaction trigger, `mandu:hydrated` event, React state update까지 관통하는 필수 gate가 없다.

위험:

- HTML snapshot은 맞지만 실제 hydration이 실패하는 버그를 놓친다.
- `data-mandu-props`와 `data-props` 우선순위, chunk path, interaction hydrate 같은 runtime 버그가 늦게 발견된다.

개선 방향:

- Playwright 기반 minimal app fixture를 추가한다.
- full page, nested boundary, streaming, non-streaming, interaction, visible, idle priority를 커버한다.
- browser console error와 hydration event를 테스트 실패로 처리한다.

완료 기준:

- runtime/bundler/router hydration 관련 파일 변경 시 `bun run test:hydration-e2e`가 agent verify와 release checklist에 포함된다.

### P1. TS/TSX 분석 경로 일부가 regex 기반이다

근거:

- `packages/core/src/router/fs-scanner.ts`의 `parsePageHydrationConfig()`
- `packages/core/src/router/client-entry.ts`의 `findComponentImportRecords()`, `defaultExportRendersClientComponents()`

위험:

- comment/string literal 안의 코드를 실제 export/import로 오인한다.
- valid TypeScript syntax를 놓친다.
- 향후 compiler boundary transform과 legacy route-level inference가 서로 다른 결과를 낼 수 있다.

개선 방향:

- TypeScript AST 기반 `route-source-analyzer`를 만든다.
- hydration config, directive, imports, exports, default render usage를 한 번의 AST parse 결과에서 읽는다.
- legacy regex 함수는 test를 옮긴 뒤 제거한다.

완료 기준:

- route source 분석에 regex로 TS syntax를 해석하는 코드가 남지 않는다.
- scanner와 bundler transform이 같은 AST 기반 analyzer contract를 사용한다.

### P1. Serialization contract가 generated runtime 문자열과 source module에 중복되어 있다

근거:

- `packages/core/src/client/serialize.ts`
- `packages/core/src/bundler/build.ts` runtime template의 `deserializeManduProps()`

위험:

- server serializer가 지원하는 값과 browser deserializer가 지원하는 값이 달라진다.
- generated runtime은 typecheck 보호가 약하다.
- JSON parse fallback과 Mandu tagged value deserialization 우선순위가 파일마다 달라질 수 있다.

개선 방향:

- browser runtime entry를 실제 TS source file로 분리한다.
- shared serializer/deserializer를 browser-safe module로 export한다.
- generated file은 template string 조립이 아니라 esbuild entry point로 빌드한다.

완료 기준:

- `deserializeManduProps()` 구현이 한 곳만 존재한다.
- generated runtime test와 browser E2E가 같은 shared module을 검증한다.

### P1. Manifest는 개선되었지만 source of truth가 완전히 하나는 아니다

근거:

- route manifest는 `clientModule`, `hydration`, `boundaries`를 모두 가진다.
- bundle manifest도 route bundles, partials, boundaries를 모두 가진다.
- MCP hydration 도구는 page client mount 중심이고, spec 도구는 route boundaries 중심이다.

위험:

- agent와 사람이 "island"라는 단어로 서로 다른 대상을 가리킬 수 있다.
- nested boundary가 있는데 page client mount가 없다는 상태를 오류로 잘못 볼 수 있다.
- diagnose, MCP, docs가 서로 다른 count를 보여줄 수 있다.

개선 방향:

- terminology를 공식화한다.
  - page client mount: route 전체를 hydrate하는 client module
  - client boundary: server route 안의 compiler-discovered client component marker
  - partial island: runtime partial bundle boundary
- `mandu.route.boundaries`를 nested boundary inspection의 기본 도구로 문서화한다.
- hydration MCP 응답에 boundary summary를 포함한다.

완료 기준:

- agent workflow에서 hydration 조사 시 `pageClientMount`, `clientBoundary`, `partial`이 분리되어 보고된다.

### P1. Release pipeline이 npm metadata drift를 충분히 막지 못한다

근거:

- `scripts/check-npm-drift.ts`는 존재하지만 `check:publish`에 연결되어 있지 않다.
- `scripts/publish.ts`는 동일 version이 npm에 있으면 skip한다.

위험:

- local publishable package가 변경되었는데 version bump 없이 release가 지나간다.
- npm metadata가 local metadata와 다르지만 command는 성공처럼 보인다.
- core/edge만 publish되고 cli/mcp metadata는 이전 상태로 남는다.

개선 방향:

- `check:publish`에 npm drift check를 추가한다.
- publishable package의 `package.json`이 변경되었는데 local version이 npm latest와 같으면 실패시킨다.
- `publish.ts`의 skip 메시지에 "local metadata was not published"를 명확히 출력한다.

완료 기준:

- 같은 version으로 local `package.json` metadata를 바꾸면 `bun run check:publish`가 실패한다.
- release 전에 "어떤 package가 실제 npm에 올라갈지"가 JSON report로 남는다.

### P2. Hydration 관련 agent verify 추천이 충분히 구체적이지 않다

근거:

- `packages/core/src/agent/verify.ts`는 target/public API 변경은 추천하지만 hydration file matrix는 별도 command로 묶지 않는다.

위험:

- agent가 router/runtime/bundler hydration 파일을 수정하고도 typecheck와 unit test 일부만 실행할 수 있다.
- browser E2E 도입 후에도 자동 추천이 없으면 습관적으로 누락된다.

개선 방향:

- changed file matcher에 hydration-sensitive paths를 추가한다.
- 추천 명령을 다음처럼 분리한다.
  - `bun run test:hydration-boundary`
  - `bun run test:hydration-e2e`
  - `bun run check:publish` for release metadata changes

완료 기준:

- `page-render-response.ts`, `build.ts`, `fs-scanner.ts`, `client-boundary-transform.ts`, `serialize.ts` 변경 시 hydration 검증 명령이 자동 추천된다.

---

## 3. 실행 계획

### Phase 0. Release safety gate

예상 기간: 1일

작업:

1. `package.json`에 `check:npm-drift` script를 추가한다.
2. `scripts/pre-publish-check.ts`에 npm drift check를 step으로 연결한다.
3. `scripts/check-npm-drift.ts`를 다음 상태까지 구분하도록 확장한다.
   - clean: local version == npm latest, local metadata also matches published metadata
   - ahead: local version > npm latest
   - reserved: local version already exists under another tag
   - behind: local version < npm latest
   - metadata-drift: same version exists but local package metadata differs
4. `scripts/publish.ts`의 skip output을 강화한다.

검증:

```bash
bun run check:npm-drift
bun run check:publish
bun run publish:dry
```

완료 기준:

- version bump 없이 publishable `package.json` metadata를 바꾸면 release가 실패한다.
- release dry-run report가 실제 publish 대상과 skip 대상을 분명히 출력한다.

### Phase 1. Hydration test matrix 고정

예상 기간: 2-3일

작업:

1. `bun run test:hydration-boundary` script를 만든다.
2. 기존 targeted tests를 한 명령으로 묶는다.
   - `packages/core/src/router/fs-routes.test.ts`
   - `packages/core/src/router/client-entry.test.ts`
   - `packages/core/src/bundler/__tests__/client-boundary-transform.test.ts`
   - `packages/core/src/bundler/build.test.ts`
   - `packages/core/src/runtime/__tests__/page-render-response.test.ts`
3. Playwright 기반 `test:hydration-e2e`를 추가한다.
4. browser console error, hydration mismatch, missing chunk, missing props를 실패 처리한다.

필수 E2E fixture:

| Case | 검증 |
|------|------|
| Server page imports client component | marker 생성, bundle load, event 발생 |
| Default export client component | export resolution |
| Named export client component | export resolution |
| Sync server wrapper | boundary id 순서 안정성 |
| Async server wrapper | boundary id 순서 안정성 |
| Date/Map/Set props | Mandu deserialization |
| interaction priority | click 전 미hydrate, click 후 hydrate |
| visible priority | IntersectionObserver path |
| streaming SSR | stream HTML에서 props script 보존 |
| stale manifest | diagnose error |

완료 기준:

- issue #309와 같은 props 누락/invalid hook call류가 browser E2E에서 재현되고 막힌다.

### Phase 2. Compiler-owned boundary를 canonical path로 고정

예상 기간: 3-5일

작업:

1. route 내부 client component는 `transformClientBoundaries()`가 유일하게 처리하도록 한다.
2. `resolveAndWrapInlineClientHydration()` 실행 조건을 legacy route/clientModule fallback으로 제한한다.
3. fallback 실행 시 diagnostic warning을 남긴다.
4. 새 route scan 결과에서는 boundary가 있으면 route-level clientModule 추론을 하지 않는다.
5. `RouteSpec.boundaries`와 `BundleManifest.boundaries` consistency를 build failure 또는 strict diagnostic으로 승격한다.

완료 기준:

- nested client component hydration은 route manifest boundary record 없이는 build되지 않는다.
- runtime SSR path는 compiler marker를 소비할 뿐 component discovery를 하지 않는다.

### Phase 3. AST 기반 route source analyzer

예상 기간: 3-4일

작업:

1. `packages/core/src/router/route-source-analyzer.ts`를 추가한다.
2. analyzer가 한 번의 TypeScript parse로 다음을 반환한다.
   - file directives: `"use client"`, `"use server"`
   - `export const hydration`
   - imports
   - exports
   - default export component shape
3. `fs-scanner.ts`의 `parsePageHydrationConfig()`를 analyzer로 교체한다.
4. `client-entry.ts`의 import/default render regex path를 analyzer로 교체한다.
5. 기존 regex 기반 edge case test를 AST analyzer test로 이전한다.

완료 기준:

- route analyzer에서 TS/TSX syntax 해석에 regex를 쓰지 않는다.
- comment/string literal 오탐 테스트가 추가된다.

### Phase 4. Browser runtime source 분리

예상 기간: 3-5일

작업:

1. generated runtime template을 `packages/core/src/client/runtime-entry.ts`로 이동한다.
2. `serialize.ts`의 browser-safe deserializer를 runtime entry가 직접 import하게 한다.
3. build step은 runtime entry를 esbuild/Bun entry point로 번들한다.
4. generated runtime unit test는 source entry test와 output smoke test로 나눈다.

완료 기준:

- runtime source가 TypeScript typecheck 대상이다.
- `deserializeManduProps()` 중복 구현이 제거된다.
- data source 우선순위가 문서화된다.
  1. boundary-local `script[data-mandu-props]`
  2. legacy sibling `data-props`
  3. route-level `window.__MANDU_DATA__`

### Phase 5. MCP/agent workflow 정리

예상 기간: 2-3일

작업:

1. `mandu.pageClientMount.list` 응답에 `clientBoundaryCount`와 `partialBoundaryCount`를 추가한다.
2. `mandu.route.boundaries`를 hydration debugging guide의 기본 도구로 올린다.
3. `packages/core/src/agent/verify.ts`에 hydration-sensitive file matcher를 추가한다.
4. `docs/guides/07_agent_workflow.md`의 hydration/debug/release workflow를 갱신한다.

완료 기준:

- 에이전트가 hydration 버그를 만나면 page client mount와 nested client boundary를 구분해서 조사한다.
- runtime/bundler/router 변경 후 추천 검증 명령이 자동으로 나온다.

---

## 4. 신규/변경 명령 제안

```json
{
  "scripts": {
    "check:npm-drift": "bun run scripts/check-npm-drift.ts",
    "test:hydration-boundary": "bun test packages/core/src/router/fs-routes.test.ts packages/core/src/router/client-entry.test.ts packages/core/src/bundler/__tests__/client-boundary-transform.test.ts packages/core/src/bundler/build.test.ts packages/core/src/runtime/__tests__/page-render-response.test.ts",
    "test:hydration-e2e": "bun run scripts/test-hydration-e2e.ts",
    "check:hydration": "bun run test:hydration-boundary && bun run test:hydration-e2e"
  }
}
```

`check:publish`에는 최소한 다음이 포함되어야 한다.

```bash
bun run check:npm-drift
bun run check:public-api
bun run check:target-boundaries
bun run check:docs-drift
```

---

## 5. Acceptance Criteria

이 계획은 다음이 모두 만족되면 완료다.

1. 정상 SSR path에서 Mandu runtime이 React function component를 직접 호출하지 않는다.
2. compiler-owned client boundary가 nested client hydration의 단일 source of truth다.
3. route source 분석은 AST 기반이며 comment/string literal 오탐 테스트를 가진다.
4. `RouteSpec.boundaries`와 `BundleManifest.boundaries`가 build/diagnose/MCP에서 같은 boundary set을 보고한다.
5. browser E2E가 실제 hydration event, state update, console error, props deserialization을 검증한다.
6. release 전에 npm version/metadata drift가 실패로 잡힌다.
7. agent verify가 hydration-sensitive 변경에 대해 hydration 전용 검증을 추천한다.

---

## 6. 첫 구현 후보

바로 시작할 순서는 다음이 가장 안전하다.

1. `check:npm-drift`를 `check:publish`에 연결한다.
2. `test:hydration-boundary` script를 추가해 현재 회귀 테스트 묶음을 고정한다.
3. Playwright hydration E2E fixture를 만든다.
4. `resolveAndWrapInlineClientHydration()` fallback warning을 추가한다.
5. AST 기반 `route-source-analyzer`를 추가하고 `parsePageHydrationConfig()`부터 교체한다.

이 순서가 좋은 이유는 release 사고 재발을 먼저 막고, 그 다음 runtime 구조 변경을 테스트로 받치기 때문이다.

---

## 7. Backward Compatibility

| 변경 | 호환성 위험 | 대응 |
|------|-------------|------|
| runtime walker 제거 | legacy partial route가 더 이상 자동 감지되지 않을 수 있음 | compatibility flag와 migration diagnostic 제공 |
| boundary canonical화 | 기존 `clientModule` page hydration과 충돌 가능 | page client mount와 nested boundary 용어/manifest 분리 |
| AST analyzer 도입 | regex가 우연히 허용하던 비정상 syntax가 막힐 수 있음 | migration warning과 explicit hydration config docs 제공 |
| runtime source 분리 | bundle output path/hash 변화 가능 | manifest schema test와 E2E로 검증 |
| npm drift gate | release가 더 자주 실패할 수 있음 | 실패 메시지에 필요한 version bump/package를 명확히 출력 |

---

## 8. 운영 원칙

앞으로 hydration/runtime 변경은 다음 순서를 기본으로 한다.

```text
context -> boundary manifest 확인 -> targeted unit tests -> browser E2E -> typecheck -> publish drift check
```

Mandu MCP가 사용 가능한 환경에서는 다음을 먼저 실행한다.

```text
mandu.route.boundaries(includeBundle: true)
mandu.pageClientMount.list
mandu.agent.verify
```

MCP가 없는 환경에서는 local fallback으로 다음을 사용한다.

```bash
bun run check:hydration
bun run typecheck
bun run check:publish
```

이 원칙을 지키면 이번처럼 하나의 hydration 버그를 고쳤는데 runtime, manifest, browser payload, publish metadata에서 후속 버그가 계속 나오는 상황을 줄일 수 있다.

---

## 9. 실행 추적 체크리스트

이 섹션은 실제 개선 작업을 진행하면서 체크박스로 상태를 추적하기 위한 실행 보드다.

체크 규칙:

- `[ ]`는 아직 구현, 테스트, 문서화, 검증 증거가 모두 끝나지 않았다는 뜻이다.
- `[x]`는 관련 코드가 반영되고, 명시된 검증 명령이 통과했으며, 아래 진행 로그에 증거가 남았다는 뜻이다.
- 각 phase는 "구현 완료"가 아니라 "완료 기준 충족" 기준으로 체크한다.
- 구현 도중 더 나은 설계가 나오면 이 문서의 체크리스트를 먼저 갱신하고 작업한다.

### 9.1 현재 기준선

- [x] F42 compiler-owned client boundary transform이 구현되고 npm에 배포되었다.
  - 기준 버전: `@mandujs/core@0.54.18`, `@mandujs/mcp@0.38.10`, `@mandujs/edge@0.4.66`, `@mandujs/cli@0.44.21`
- [x] `check:publish`에 client boundary guardrail smoke가 포함되어 있다.
- [x] hydration runtime quality phase 개발을 시작했다.
- [x] Phase 0 Release safety gate 완료 증거를 진행 로그에 남겼다.

### 9.2 병렬 작업 lane

| Lane | 관점 | 담당 범위 | 선행 조건 | 병합 조건 |
|------|------|-----------|-----------|-----------|
| Release Harness | 하네스/릴리즈 엔지니어링 | npm drift, publish report, release preflight | 없음 | `check:npm-drift`, `check:publish`, `publish:dry` 통과 |
| Browser Hydration | 브라우저 렌더링 엔지니어링 | Playwright hydration E2E, console/error gate | Phase 1 targeted test script | E2E가 실제 state update와 hydration event를 검증 |
| Runtime Canonical | 만두 런타임/프레임워크 | runtime walker 격하, compiler boundary canonical화 | Phase 1 최소 테스트 gate | 일반 SSR path에서 function component 직접 호출 없음 |
| Source Analyzer | 웹 프레임워크/컴파일러 | AST route source analyzer | analyzer contract 합의 | regex 기반 TS/TSX 해석 제거 |
| Runtime Source | 브라우저 runtime/번들러 | runtime template 분리, serializer 공유 | E2E props matrix | deserializer 중복 제거 |
| MCP Agent | 에이전트/컨텍스트 하네스 | MCP boundary summary, agent verify 추천 | 용어 정리 확정 | agent verify가 hydration-sensitive 명령 추천 |

병렬화 원칙:

- [x] Release Harness와 Browser Hydration은 즉시 병렬 시작 가능하다.
- [x] Runtime Canonical은 `test:hydration-boundary`가 만들어진 뒤 시작한다.
- [x] Source Analyzer는 analyzer interface 초안 작성 후 Runtime Canonical과 병렬 진행 가능하다.
- [x] Runtime Source는 browser E2E props fixture가 최소 1개 통과한 뒤 시작한다.
- [x] MCP Agent는 용어와 manifest source of truth가 확정된 뒤 최종 반영한다.

### 9.3 전체 완료 게이트

- [x] Gate A: release metadata drift가 publish 전에 실패로 잡힌다.
- [x] Gate B: hydration 관련 targeted test command가 존재한다.
- [x] Gate C: 실제 브라우저 E2E가 hydration event, state update, console error를 검증한다.
- [x] Gate D: 일반 SSR path에서 runtime이 React function component를 직접 호출하지 않는다.
- [x] Gate E: TS/TSX route source 분석이 AST 기반으로 통합된다.
- [x] Gate F: browser runtime deserializer 구현이 한 곳만 남는다.
- [x] Gate G: MCP/agent verify가 page client mount와 nested client boundary를 구분해 보고한다.
- [x] Gate H: `bun test`, `bun run typecheck`, `bun run check:publish`, `bun run publish:dry`가 모두 통과한다.

---

## 10. Phase별 상세 작업

### Phase 0. Release safety gate 상세

목표: 로컬 package metadata와 npm registry metadata가 어긋난 상태로 release가 성공처럼 보이는 일을 막는다.

대상 파일:

- `package.json`
- `scripts/check-npm-drift.ts`
- `scripts/pre-publish-check.ts`
- `scripts/publish.ts`
- 필요 시 `scripts/check-npm-drift.test.ts`

작업 체크리스트:

- [x] `package.json`에 `check:npm-drift` script를 추가한다.
  - 제안: `"check:npm-drift": "bun run scripts/check-npm-drift.ts"`
- [x] `scripts/check-npm-drift.ts`의 `Status`에 `metadata-drift`를 추가한다.
- [x] published tarball의 `package/package.json`을 기준으로 현재 local version의 published manifest를 조회한다.
  - fallback: `npm view <name>@<localVersion> --json`
- [x] local version이 npm latest와 같을 때도 package metadata를 비교한다.
- [x] 비교 대상 필드를 명시한다.
  - `name`
  - `version`
  - `description`
  - `license`
  - `type`
  - `main`
  - `module`
  - `types`
  - `bin`
  - `exports`
  - `files`
  - `dependencies`
  - `peerDependencies`
  - `optionalDependencies`
  - `engines`
  - `keywords`
- [x] 비교에서 제외할 registry volatile 필드를 명시한다.
  - `_id`
  - `_nodeVersion`
  - `_npmVersion`
  - `dist`
  - `maintainers`
  - `time`
  - `readme`
  - `gitHead`
  - `_integrity`
  - `_resolved`
- [x] JSON mode 출력에 `reports`, `blocking`, `publishPlan`을 포함한다.
- [x] human output에서 `metadata-drift`가 어떤 필드에서 발생했는지 보여준다.
- [x] `scripts/pre-publish-check.ts`의 초반 step에 npm drift check를 연결한다.
  - 권장 위치: lockfile 확인 이후, tarball pack 이전
- [x] `scripts/publish.ts`에서 같은 version skip 메시지를 강화한다.
  - 메시지 요구: "already on npm, local metadata was not published"
  - 메시지 요구: "run bun run check:npm-drift if this package changed"
- [x] dry-run에서도 publish/skip 예정 package 목록을 JSON report로 남긴다.
  - 제안 경로: `.mandu/release/publish-plan.json`
- [x] `metadata-drift` fixture test를 추가한다.
  - local `exports` 변경
  - local dependency range 변경
  - local `bin` 변경
  - local `files` 변경

검증 명령:

```bash
bun run check:npm-drift
bun run check:publish
bun run publish:dry
```

완료 증거:

- [x] version bump 없이 publishable `package.json` metadata를 바꾼 fixture에서 `check:npm-drift`가 실패한다.
- [x] metadata가 동일한 package는 `clean`으로 남는다.
- [x] local version이 npm latest보다 큰 package는 `ahead`로 남는다.
- [x] pre-publish 실패 메시지가 어떤 package와 어떤 필드가 문제인지 알려준다.

### Phase 1. Hydration test matrix 상세

목표: runtime, bundler, router 변경이 실제 browser hydration 실패로 이어지는지 release 전에 잡는다.

대상 파일:

- `package.json`
- `scripts/test-hydration-e2e.ts`
- `packages/core/src/router/fs-routes.test.ts`
- `packages/core/src/router/client-entry.test.ts`
- `packages/core/src/bundler/__tests__/client-boundary-transform.test.ts`
- `packages/core/src/bundler/build.test.ts`
- `packages/core/src/runtime/__tests__/page-render-response.test.ts`
- `packages/core/src/runtime/__tests__/inline-client-hydration.test.ts`

작업 체크리스트:

- [x] `package.json`에 `test:hydration-boundary` script를 추가한다.
- [x] targeted script에 route scan, client entry, transform, build, SSR runtime test를 모두 포함한다.
- [x] `package.json`에 `test:hydration-e2e` script를 추가한다.
  - 제안: `"test:hydration-e2e": "bun run scripts/test-hydration-e2e.ts"`
- [x] `package.json`에 `check:hydration` script를 추가한다.
  - 제안: `"check:hydration": "bun run test:hydration-boundary && bun run test:hydration-e2e"`
- [x] E2E fixture는 repo 내부 publishable package에 임시 산출물을 남기지 않는다.
  - 권장: OS temp dir 또는 `.mandu/tmp/hydration-e2e`
- [x] E2E runner는 사용한 port, fixture path, build output path를 실패 시 출력한다.
- [x] E2E runner는 browser console `error`를 테스트 실패로 처리한다.
- [x] E2E runner는 page error를 테스트 실패로 처리한다.
- [x] E2E runner는 failed network request, missing chunk, 404 client asset을 테스트 실패로 처리한다.
- [x] E2E runner는 `mandu:hydrated` event를 대기하고 timeout 시 실패한다.
- [x] E2E runner는 hydration 후 React state update를 실제 DOM 변화로 확인한다.
- [x] E2E runner는 `data-mandu-props`가 우선 사용되는지 확인한다.
- [x] E2E runner는 legacy `data-props` fallback을 별도 case로 확인한다.
- [x] E2E runner는 `window.__MANDU_DATA__` route-level fallback을 별도 case로 확인한다.

필수 fixture checklist:

- [x] 서버 route가 default export client component를 import한다.
- [x] 서버 route가 named export client component를 import한다.
- [x] sync server wrapper 안에 client boundary가 있다.
- [x] async server wrapper 안에 client boundary가 있다.
- [x] `Date`, `Map`, `Set`, `URL` props가 browser에서 복원된다.
- [x] `priority: "interaction"`은 click 전 hydrate되지 않고 click 후 hydrate된다.
- [x] `priority: "visible"`은 IntersectionObserver path를 탄다.
- [x] streaming SSR에서도 props script가 보존된다.
- [x] stale route manifest와 stale bundle manifest가 diagnose/build에서 잡힌다.
- [x] invalid hook call이 browser console에 나오면 실패한다.

검증 명령:

```bash
bun run test:hydration-boundary
bun run test:hydration-e2e
bun run check:hydration
```

완료 증거:

- [x] E2E에서 hydration success event count와 boundary count가 일치한다.
- [x] fixture별로 실패 메시지가 "어떤 boundary가 왜 실패했는지"를 포함한다.
- [x] `check:publish` 또는 release checklist가 `check:hydration` 실행을 요구한다.

### Phase 2. Compiler-owned boundary canonical화 상세

목표: nested client hydration의 정상 경로를 compiler-owned boundary 하나로 고정하고 runtime discovery를 compatibility fallback으로 내린다.

대상 파일:

- `packages/core/src/runtime/page-render-response.ts`
- `packages/core/src/internal/client-boundary.ts`
- `packages/core/src/router/fs-scanner.ts`
- `packages/core/src/router/fs-routes.ts`
- `packages/core/src/bundler/client-boundary-transform.ts`
- `packages/core/src/diagnose/checks.ts`

작업 체크리스트:

- [x] `resolveAndWrapInlineClientHydration()`의 현재 실행 조건을 문서화한다.
- [x] fallback 실행 조건을 legacy route-level `clientModule` 또는 explicit legacy partial로 제한한다.
- [x] fallback이 실행되면 diagnostic warning을 생성한다.
  - 제안 코드: `MANDU_LEGACY_RUNTIME_PARTIAL_SCAN`
- [x] warning에는 route id, file path, migration hint를 포함한다.
- [x] compiler boundary가 있는 route에서는 route-level clientModule inference를 하지 않는다.
- [x] `RouteSpec.boundaries`가 있으면 runtime은 해당 manifest record만 신뢰한다.
- [x] route manifest boundary와 bundle manifest boundary 불일치를 strict diagnostic으로 승격한다.
- [x] unsupported boundary shape는 build 단계에서 실패한다.
- [x] SSR runtime은 marker emission과 response shaping만 담당하도록 책임을 줄인다.
- [x] 기존 legacy partial 사용자는 compatibility flag로 임시 유지한다.
  - 제안 env: `MANDU_LEGACY_RUNTIME_PARTIAL_SCAN=1`
- [x] compatibility flag 제거 예정 문서를 남긴다.

검증 명령:

```bash
bun run test:hydration-boundary
bun run test:hydration-e2e
bun run typecheck
```

완료 증거:

- [x] 일반 SSR path에서 React function component 직접 호출 코드가 실행되지 않는다.
- [x] hook이 있는 client wrapper fixture가 invalid hook call 없이 통과한다.
- [x] legacy fallback fixture는 warning과 함께 동작하거나 명확히 실패한다.
- [x] compiler boundary가 없으면 nested client component hydration이 암묵적으로 만들어지지 않는다.

Compatibility flag policy:

- `MANDU_LEGACY_RUNTIME_PARTIAL_SCAN=1`은 pre-F42 route-level `clientModule` compatibility 전용이다.
- 기본값은 off다. 기본 SSR path는 hidden client component를 찾기 위해 sync server wrapper를 실행하지 않고 route-level island wrapper 또는 compiler-owned boundary manifest를 사용한다.
- flag가 켜진 상태에서 fallback이 실행되면 `MANDU_LEGACY_RUNTIME_PARTIAL_SCAN` warning을 출력한다.
  - warning 필수 필드: route id, source file, migration hint
- 제거 기준: Phase 3 AST analyzer와 Phase 4 browser runtime source 분리 후 legacy route-level client inference가 문서화된 migration path로 대체되면 flag를 deprecated로 표시한다.

### Phase 3. AST route source analyzer 상세

목표: route source 분석을 문자열/regex 추론에서 TypeScript AST contract로 이동한다.

대상 파일:

- `packages/core/src/router/route-source-analyzer.ts`
- `packages/core/src/router/fs-scanner.ts`
- `packages/core/src/router/client-entry.ts`
- `packages/core/src/router/client-entry.test.ts`
- `packages/core/src/router/fs-routes.test.ts`

제안 interface:

```ts
export interface RouteSourceAnalysis {
  directives: {
    useClient: boolean;
    useServer: boolean;
  };
  hydrationConfig?: {
    strategy?: string;
    priority?: string;
    preload?: boolean;
    sourceRange?: { start: number; end: number };
  };
  imports: Array<{
    source: string;
    defaultName?: string;
    namespaceName?: string;
    named: Array<{ imported: string; local: string }>;
  }>;
  exports: Array<{
    name: string;
    kind: "default" | "named";
    localName?: string;
  }>;
  defaultExport: {
    kind: "function" | "identifier" | "call" | "unknown";
    referencesJsx: boolean;
  };
  diagnostics: Array<{
    code: string;
    message: string;
    start?: number;
    end?: number;
  }>;
}
```

작업 체크리스트:

- [x] analyzer가 TypeScript parser를 한 번만 호출하도록 만든다.
- [x] `"use client"`와 `"use server"` directive를 AST statement 기준으로 읽는다.
- [x] `export const hydration = ...`를 AST initializer 기준으로 읽는다.
- [x] hydration config가 object literal이 아니면 diagnostic을 남긴다.
- [x] import record를 AST import declaration에서 추출한다.
- [x] default export function, identifier re-export, call expression을 구분한다.
- [x] default export가 JSX를 직접 또는 간접 참조하는지 conservative하게 판단한다.
- [x] `fs-scanner.ts`의 `parsePageHydrationConfig()`를 analyzer로 교체한다.
- [x] `client-entry.ts`의 import/default render regex path를 analyzer로 교체한다.
- [x] regex helper는 analyzer migration 후 제거하거나 legacy test fixture로만 남긴다.

필수 test checklist:

- [x] comment 안의 `export const hydration`은 무시된다.
- [x] string literal 안의 `import X from`은 무시된다.
- [x] `export { default } from "./Page"`를 처리한다.
- [x] `const Page = () => <Client />; export default Page`를 처리한다.
- [x] `export default function Page()`를 처리한다.
- [x] `export default memo(Page)` 같은 wrapper는 conservative diagnostic을 낸다.
- [x] type-only import는 client component import로 보지 않는다.
- [x] namespace import는 명확히 표시한다.

검증 명령:

```bash
bun test packages/core/src/router/client-entry.test.ts packages/core/src/router/fs-routes.test.ts
bun run test:hydration-boundary
bun run typecheck
```

완료 증거:

- [x] TS/TSX syntax 해석용 regex가 route source analyzer 경로에 남지 않는다.
- [x] analyzer diagnostic이 scanner/build diagnostic으로 연결된다.
- [x] F42 boundary transform과 analyzer가 같은 route source를 서로 모순되게 해석하지 않는다.

### Phase 4. Browser runtime source 분리 상세

목표: 긴 generated runtime string을 TypeScript source로 이동하고 serialization contract를 하나로 만든다.

대상 파일:

- `packages/core/src/bundler/build.ts`
- `packages/core/src/client/serialize.ts`
- `packages/core/src/client/runtime-entry.ts`
- `packages/core/src/bundler/build.test.ts`
- `packages/core/src/runtime/__tests__/inline-client-hydration.test.ts`

작업 체크리스트:

- [x] runtime template 안의 `deserializeManduProps()` 위치를 찾고 behavior snapshot을 만든다.
- [x] browser-safe serialization/deserialization module boundary를 정의한다.
  - `props-serialization.ts`는 Node/Bun/DOM import 없이 wire format만 담당한다.
  - runtime hydration path의 DOM parsing은 `runtime-entry.ts`에 둔다.
  - legacy public `parsePropsScript()` helper는 compatibility API로 유지하되 runtime bundle path에서는 사용하지 않는다.
- [x] `packages/core/src/client/runtime-entry.ts`를 추가한다.
- [x] runtime entry가 shared deserializer를 import하게 한다.
- [x] bundler는 runtime entry를 실제 entry point로 build한다.
- [x] generated runtime string 조립은 config injection 수준으로 줄인다.
- [x] props source 우선순위를 source 코드와 test에 고정한다.
  - 1순위: boundary-local `script[data-mandu-props]`
  - 2순위: legacy sibling `data-props`
  - 3순위: route-level `window.__MANDU_DATA__`
- [x] `Date`, `Map`, `Set`, `URL`, `undefined`, nested object deserialization test를 shared module에 둔다.
- [x] browser E2E가 shared deserializer path를 실제로 지나가게 한다.

검증 명령:

```bash
bun test packages/core/src/bundler/build.test.ts packages/core/src/runtime/__tests__/inline-client-hydration.test.ts
bun run test:hydration-e2e
bun run typecheck
```

완료 증거:

- [x] `deserializeManduProps()` 구현이 한 곳만 존재한다.
- [x] runtime entry가 TypeScript typecheck 대상이다.
- [x] build output의 runtime bundle이 기존 route에서 로드된다.
- [x] hydration E2E에서 complex props가 실제 React component props로 복원된다.

### Phase 5. MCP/agent workflow 상세

목표: 사람과 에이전트가 hydration 문제를 조사할 때 page mount, client boundary, partial island를 혼동하지 않게 만든다.

대상 파일:

- `packages/mcp/src/tools/hydration.ts`
- `packages/mcp/src/tools/spec.ts`
- `packages/mcp/tests/tools/hydration.test.ts`
- `packages/mcp/tests/tools/spec-boundaries.test.ts`
- `packages/core/src/agent/verify.ts`
- `docs/guides/07_agent_workflow.md`

작업 체크리스트:

- [x] 공식 용어를 docs와 MCP response에 맞춘다.
  - page client mount: route 전체 client module hydration
  - client boundary: compiler-discovered nested client component marker
  - partial island: runtime partial bundle boundary
- [x] `mandu.pageClientMount.list` 응답에 boundary summary를 추가한다.
  - `clientBoundaryCount`
  - `partialBoundaryCount`
  - `hasRouteLevelClientMount`
- [x] `mandu.route.boundaries`를 hydration debugging guide의 첫 조사 도구로 문서화한다.
- [x] `agent verify` changed file matcher에 hydration-sensitive paths를 추가한다.
- [x] hydration-sensitive 변경 시 추천 명령을 구체화한다.
  - `bun run test:hydration-boundary`
  - `bun run test:hydration-e2e`
  - `bun run check:publish`
- [x] docs에 MCP가 없을 때의 CLI fallback을 명시한다.
- [x] MCP tests가 page mount와 client boundary를 다른 필드로 검증한다.

검증 명령:

```bash
bun test packages/mcp/tests/tools/hydration.test.ts packages/mcp/tests/tools/spec-boundaries.test.ts
bun test packages/core/src/agent
bun run check:docs-drift
```

완료 증거:

- [x] hydration MCP response가 nested boundary count를 보여준다.
- [x] agent verify가 `page-render-response.ts`, `build.ts`, `fs-scanner.ts`, `client-boundary-transform.ts`, `serialize.ts` 변경에 hydration 검증을 추천한다.
- [x] docs와 MCP 용어가 같은 의미를 사용한다.

---

## 11. 검증 매트릭스

| 변경 범위 | 필수 검증 | 추가 검증 | 실패 시 우선 확인 |
|-----------|-----------|-----------|-------------------|
| release script | `bun run check:npm-drift`, `bun run check:publish`, `bun run publish:dry` | metadata-drift fixture | package manifest normalize 누락 |
| router scanner | `bun run test:hydration-boundary`, `bun run typecheck` | analyzer edge case tests | regex fallback 잔존, AST false positive |
| client boundary transform | `bun run test:hydration-boundary`, `bun run check:publish` | invalid boundary diagnostic tests | unsupported shape diagnostic 누락 |
| SSR runtime | `bun run test:hydration-boundary`, `bun run test:hydration-e2e` | invalid hook/browser console gate | function component direct call path |
| browser runtime | `bun run test:hydration-e2e`, `bun run typecheck` | complex props matrix | deserializer drift, chunk path 404 |
| MCP tools | `bun test packages/mcp/tests/tools`, `bun run check:docs-drift` | manual MCP response inspection | page mount/boundary 용어 혼동 |
| agent verify | `bun test packages/core/src/agent`, `bun run check:docs-drift` | changed-files fixture | hydration-sensitive matcher 누락 |

최종 release 후보 검증:

```bash
bun run check:hydration
bun test --timeout 180000
bun run test:packages
bun run typecheck
bun run lint
bun run check:docs-drift
bun run check:publish
bun run publish:dry
```

---

## 12. 리스크와 대응

| 리스크 | 발생 가능성 | 영향 | 대응 |
|--------|-------------|------|------|
| runtime walker 격하로 legacy partial route가 깨짐 | 중간 | 높음 | compatibility flag, warning, migration doc 제공 |
| Playwright E2E가 느리거나 flaky함 | 중간 | 중간 | fixture 최소화, fixed port 피하기, console/network failure 명확화 |
| AST analyzer가 regex보다 보수적으로 판정함 | 높음 | 중간 | diagnostic 먼저 도입, build failure는 단계적으로 승격 |
| runtime source 분리로 bundle hash/path가 변함 | 중간 | 중간 | manifest schema test와 browser E2E로 검증 |
| npm drift check가 registry/network에 의존함 | 중간 | 중간 | JSON cache 금지, 실패 메시지 명확화, dry-run에서 별도 report |
| MCP 용어 변경으로 기존 사용자 혼란 | 낮음 | 중간 | alias 유지, response에 legacy field deprecation note 포함 |

---

## 13. 진행 로그

작업할 때마다 아래 형식으로 남긴다.

```text
YYYY-MM-DD
- Phase:
- 변경 파일:
- 완료 체크박스:
- 실행 명령:
- 결과:
- 남은 리스크:
```

현재 기록:

- 2026-05-23
  - Phase: Phase 1 Hydration E2E matrix expansion
  - 변경 파일: `scripts/test-hydration-e2e.ts`, `scripts/test-hydration-e2e-browser.cjs`, `docs/plans/21_hydration_runtime_quality_plan.md`
  - 완료 체크박스: legacy `data-props` fallback, `window.__MANDU_DATA__` route-level fallback, default export client component route, async server wrapper route, `priority: "interaction"` delayed hydration, streaming SSR props script, stale route/bundle manifest diagnose-build guard
  - 실행 명령: `bun run test:hydration-e2e`, `bun run check:hydration`, `bun run typecheck`, `bun run check:docs-drift`, `bun run check:publish`, `bun run publish:dry`, `bun test --timeout 180000`, `git diff --check`
  - 결과: Chromium E2E가 `/`, `/hook`, `/default`, `/async`, `/interaction`, `/streaming`, `/legacy-data-props`, `/route-data-fallback`를 순회하며 boundary marker, props source priority/fallback, `mandu:hydrated`, console/page/network error gate, click 후 React state update를 검증함. stale route manifest는 `packages/core/src/bundler/build.test.ts`의 stale `clientModule` build failure case, stale bundle manifest는 `packages/core/src/diagnose/__tests__/checks.test.ts`의 missing/incomplete boundary bundle manifest error case로 잡힘. `check:hydration`은 76 pass, `typecheck`는 전체 package no errors, `check:publish`와 `publish:dry`는 통과함. 전체 `bun test --timeout 180000`는 6351 pass, 68 skip, 0 fail로 통과함. `git diff --check`는 CRLF warning만 출력하고 실패하지 않음.
  - 남은 리스크: npm 실제 publish와 GitHub issue/comment 정리는 별도 release 작업으로 남음

- 2026-05-23
  - Phase: Phase 5 MCP/agent workflow
  - 변경 파일: `packages/mcp/src/tools/hydration.ts`, `packages/mcp/tests/tools/hydration.test.ts`, `packages/core/src/agent/verify.ts`, `packages/core/src/agent/__tests__/context.test.ts`, `docs/guides/07_agent_workflow.md`, `docs/plans/21_hydration_runtime_quality_plan.md`
  - 완료 체크박스: Gate G, Phase 5 작업 체크리스트 전체, `pageClientMount`/`clientBoundary`/`partialBoundary` 용어 정리, MCP boundary summary, agent verify hydration-sensitive matcher, docs CLI fallback
  - 실행 명령: `bun test packages/mcp/tests/tools/hydration.test.ts packages/mcp/tests/tools/spec-boundaries.test.ts`, `bun test packages/core/src/agent`, `bun run check:docs-drift`, `bun run typecheck`, `bun run check:publish`
  - 결과: `mandu.pageClientMount.list`가 `boundarySummary`, `clientBoundaryCount`, `partialBoundaryCount`, route별 `hasRouteLevelClientMount`와 `clientBoundaryCount`를 반환함. `agent verify`는 `page-render-response.ts`, `build.ts`, `fs-scanner.ts`, `client-boundary-transform.ts`, `serialize.ts`, `runtime-entry.ts`, `props-serialization.ts` 등 hydration-sensitive 파일 변경 시 `bun run test:hydration-boundary`, `bun run test:hydration-e2e`, `bun run check:publish`를 추천함. agent workflow docs는 hydration 조사 시작점으로 `mandu.route.boundaries`와 `mandu.pageClientMount.list`를 명시하고 MCP 미사용 시 CLI fallback을 제공함. MCP targeted tests는 9 pass, agent tests는 9 pass, docs drift와 typecheck, check:publish는 통과함.
  - 남은 리스크: Phase 1 E2E matrix 확장 후 전체 재검증 필요

- 2026-05-23
  - Phase: Phase 4 Browser runtime source split
  - 변경 파일: `packages/core/src/bundler/build.ts`, `packages/core/src/bundler/build.test.ts`, `packages/core/src/client/serialize.ts`, `packages/core/src/client/props-serialization.ts`, `packages/core/src/client/runtime-entry.ts`, `packages/core/src/client/__tests__/props-serialization.test.ts`, `packages/core/src/client/hydrate.ts`, `packages/core/src/client/runtime.ts`, `packages/core/src/client/index.ts`, `scripts/test-hydration-e2e.ts`, `scripts/test-hydration-e2e-browser.cjs`, `docs/plans/21_hydration_runtime_quality_plan.md`
  - 완료 체크박스: Gate F, Phase 4 작업 체크리스트 전체, shared deserializer boundary, runtime entry source split, runtime entry actual build entrypoint, props source priority test, complex props browser E2E
  - 실행 명령: `bun test packages/core/src/bundler/build.test.ts packages/core/src/runtime/__tests__/inline-client-hydration.test.ts packages/core/src/client/__tests__/props-serialization.test.ts`, `bun test packages/core/src/bundler/build.test.ts packages/core/src/client/__tests__/props-serialization.test.ts`, `bun run test:hydration-e2e`, `bun run check:hydration`, `bun run typecheck`, `bun run check:publish`, `bun run publish:dry`, `bun test --timeout 180000`, `git diff --check`
  - 결과: generated runtime string의 `deserializeManduProps()` 중복 구현을 제거하고 `runtime-entry.ts`가 `props-serialization.ts`의 `deserializeProps()`를 직접 import하도록 변경함. `build.ts`는 `_runtime.src.js` 임시 문자열 대신 `client/runtime-entry.ts`를 실제 browser entry point로 번들함. `props-serialization.test.ts`는 `Date`, `Map`, `Set`, `URL`, `undefined`, nested object roundtrip을 검증하고, browser E2E는 실제 Chromium에서 complex props가 React component props로 복원되어 `data-complex-props="ok"`가 되는지 확인함. `build.test.ts`는 boundary-local props가 route-level data보다 우선하고, legacy `data-props` fallback과 route-level `window.__MANDU_DATA__` fallback이 동작함을 확인함. `check:hydration`은 76 pass, `typecheck`는 전체 package no errors, `check:publish`와 `publish:dry`는 통과함. 전체 `bun test --timeout 180000`는 6350 pass, 68 skip, 0 fail로 통과함. `git diff --check`는 CRLF warning만 출력하고 실패하지 않음.
  - 남은 리스크: legacy public `parsePropsScript()` DOM helper는 compatibility API로 남아 있으며 runtime bundle path에서는 사용하지 않는다. Phase 5 MCP/agent verify와 docs workflow 정리는 아직 남음

- 2026-05-23
  - Phase: Phase 3 AST route source analyzer
  - 변경 파일: `packages/core/src/router/route-source-analyzer.ts`, `packages/core/src/router/client-entry.ts`, `packages/core/src/router/fs-scanner.ts`, `packages/core/src/router/fs-types.ts`, `packages/core/src/router/client-entry.test.ts`, `packages/core/src/router/fs-routes.test.ts`, `docs/plans/21_hydration_runtime_quality_plan.md`
  - 완료 체크박스: AST 기반 directive/hydration/import/default export 분석, hydration initializer diagnostic, `parsePageHydrationConfig()` 제거, `client-entry.ts` import/default render regex path 교체, comment/string/type-only false positive 방지, identifier default export, default re-export, wrapper call diagnostic, namespace import 표시
  - 실행 명령: `bun test packages/core/src/router/client-entry.test.ts packages/core/src/router/fs-routes.test.ts`, `bun run test:hydration-boundary`, `bun run typecheck`, `bun run check:publish`, `bun run publish:dry`, `bun test`
  - 결과: `route-source-analyzer.ts`가 TypeScript parser로 route source를 분석하고 `client-entry.ts`/`fs-scanner.ts`가 같은 analysis result를 사용함. router targeted tests는 29 pass, `test:hydration-boundary`는 75 pass, `check:publish`는 npm drift와 browser hydration E2E까지 통과함. 전체 `bun test`는 6348 pass, 68 skip, 0 fail로 통과함.
  - 남은 리스크: Phase 4 browser runtime source 분리와 Phase 5+ agent/MCP verify는 아직 남음

- 2026-05-23
  - Phase: Phase 2 Compiler-owned boundary canonicalization
  - 변경 파일: `packages/core/src/runtime/page-render-response.ts`, `packages/core/src/runtime/server.ts`, `packages/core/src/runtime/__tests__/page-render-response.test.ts`, `packages/core/src/runtime/__tests__/inline-client-hydration.test.ts`, `packages/core/src/diagnose/checks.ts`, `packages/core/src/diagnose/__tests__/checks.test.ts`, `scripts/test-hydration-e2e.ts`, `scripts/test-hydration-e2e-browser.cjs`, `docs/plans/21_hydration_runtime_quality_plan.md`
  - 완료 체크박스: runtime fallback 실행 조건 문서화, legacy compatibility flag, `MANDU_LEGACY_RUNTIME_PARTIAL_SCAN` warning, route/file/migration hint, boundary route의 route-level inference 억제, boundary manifest strict diagnostic, legacy fallback fixture, hook이 있는 client wrapper browser fixture
  - 실행 명령: `bun test packages/core/src/runtime/__tests__/page-render-response.test.ts packages/core/src/runtime/__tests__/inline-client-hydration.test.ts`, `bun test packages/core/src/diagnose/__tests__/checks.test.ts`, `bun run test:hydration-e2e`, `bun run check:hydration`, `bun run typecheck`, `bun run check:publish`, `bun run publish:dry`
  - 결과: 기본 서버 path는 runtime scan을 만들지 않고 route-level wrapper로 떨어지며, legacy flag를 켠 경우에만 sync wrapper fallback이 동작하고 warning을 출력함. routes manifest에 boundary가 있는데 bundle manifest가 없으면 diagnose severity가 `error`가 됨. browser E2E는 `/`의 `index--0` boundary와 `/hook`의 `HookWrapper(useId) -> Counter.client` 구조인 `hook--0` boundary를 실제 Chromium에서 hydration/event/state update까지 검증함. `check:hydration`은 67 tests, 274 expects와 browser E2E를 통과했고 `check:publish`도 통과함.
  - 남은 리스크: Phase 4 browser runtime source 분리와 Phase 5+ agent/MCP verify는 아직 남음

- 2026-05-23
  - Phase: Phase 1 Hydration browser E2E gate
  - 변경 파일: `package.json`, `scripts/test-hydration-e2e.ts`, `scripts/test-hydration-e2e-browser.cjs`, `scripts/pre-publish-check.ts`, `docs/plans/21_hydration_runtime_quality_plan.md`
  - 완료 체크박스: Gate C, `test:hydration-e2e`, `check:hydration`, E2E browser console/page/network failure gate, `mandu:hydrated` event count, React state update, `data-mandu-props` priority, visible IntersectionObserver path, `check:publish` hydration gate
  - 실행 명령: `bun run test:hydration-e2e`, `bun run test:hydration-boundary`, `bun run check:hydration`, `bun run typecheck`, `bun run check:publish`, `bun run publish:dry`
  - 결과: production client boundary fixture가 실제 Chromium에서 `index--0` boundary marker, boundary-local props script, `mandu:hydrated` event, hydrated event count, visible hydration observer path, click 후 React state update를 검증함. `check:publish` Step 1.2에 `bun run check:hydration`이 연결되어 통과했고, `publish:dry`가 `.mandu/release/publish-plan.json`을 다시 생성함.
  - 남은 리스크: default export client component, async wrapper, interaction priority, streaming SSR, stale manifest fixture는 아직 별도 E2E matrix로 확장 필요. complex props(Date/Map/Set/URL)는 Phase 4에서 browser E2E로 보강됨

- 2026-05-23
  - Phase: Phase 1 Hydration test matrix
  - 변경 파일: `package.json`, `docs/plans/21_hydration_runtime_quality_plan.md`
  - 완료 체크박스: Gate B, `test:hydration-boundary` script, targeted hydration boundary test bundle
  - 실행 명령: `bun run test:hydration-boundary`
  - 결과: 6개 파일, 66 tests, 266 expects 통과
  - 남은 리스크: browser-level `test:hydration-e2e`는 아직 없음

- 2026-05-23
  - Phase: Phase 0 Release safety gate
  - 변경 파일: `package.json`, `scripts/check-npm-drift.ts`, `scripts/check-npm-drift.test.ts`, `scripts/pre-publish-check.ts`, `scripts/publish.ts`, `docs/plans/21_hydration_runtime_quality_plan.md`
  - 완료 체크박스: Gate A, Phase 0 작업 체크리스트 전체
  - 실행 명령: `bun test ./scripts/check-npm-drift.test.ts`, `bun run check:npm-drift`, `bun run check:publish`, `bun run publish:dry`
  - 결과: metadata-drift status와 publishPlan JSON이 추가되었고, current npm/local package metadata는 모두 clean으로 확인됨. `publish:dry`가 `.mandu/release/publish-plan.json`을 생성함.
  - 남은 리스크: Phase 1 browser hydration E2E와 Phase 2 runtime walker 격하는 아직 시작하지 않음

- 2026-05-23
  - Phase: planning
  - 변경 파일: `docs/plans/21_hydration_runtime_quality_plan.md`
  - 완료 체크박스: 실행 체크리스트 추가
  - 실행 명령: 문서 편집만 수행
  - 결과: phase별 작업 ID, 검증 명령, 완료 증거 기준 추가
  - 남은 리스크: 구현은 아직 시작하지 않음
