---
title: "Phase 7.1 R0.1 — React Fast Refresh 통합 전략"
status: research (pre-RFC)
audience: Mandu core team
created: 2026-04-18
depends_on:
  - docs/bun/phase-7-diagnostics/industry-benchmark.md
  - docs/bun/phase-7-team-plan.md
  - packages/core/src/runtime/hmr-client.ts (Phase 7.0 C)
  - packages/core/src/bundler/build.ts
---

# React Fast Refresh 통합 전략 (Mandu Phase 7.1)

Phase 7.0 에서 `import.meta.hot` **runtime API 만** 구현됨. Bundler 가 아직 accept-boundary 를 emit 하지 않아 island 수정 시 full-reload 로 fallback. 본 문서는 Mandu 에 Vite 수준 Fast Refresh 를 도입할 단일 권장 경로를 제시한다.

**결론 요약**: **Bun 1.3.12 에 이미 내장된 `Bun.build({ reactFastRefresh: true })` 를 쓰고, Mandu 는 (1) runtime shim 번들링 + (2) 정적 boundary detection + (3) accept-wrapper injection 만 담당한다**. 외부 babel/swc 의존성 불필요.

---

## 1. Vite `@vitejs/plugin-react` 의 Fast Refresh flow

Vite 플러그인 세 모듈로 구성된다 ([DeepWiki](https://deepwiki.com/vitejs/vite-plugin-react/2.1-@vitejsplugin-react)):

```
1. viteBabel         — tsx/jsx 소스를 babel-plugin-react-refresh 로 transform
2. viteReactRefresh  — /@react-refresh runtime endpoint + HTML preamble 주입
3. HMR client        — accept callback → RefreshRuntime.performReactRefresh()
```

### 1.1 babel-plugin-react-refresh 가 하는 변환

컴포넌트 정의마다 두 헬퍼 호출을 끼워넣는다 ([Jarred Sumner gist](https://gist.github.com/Jarred-Sumner/1f13f48c12e84a7d9a05365018834475)):

```js
// Before
export default function Counter() {
  const [c, setC] = useState(0)
  return <button>{c}</button>
}

// After babel transform
var _s = $RefreshSig$()
const Counter = _s(function Counter() {
  _s()                         // hook signature collector
  const [c, setC] = useState(0)
  return /* jsx */
}, "<hash of hook signatures>")
$RefreshReg$(Counter, "Counter.tsx:default")
```

- `$RefreshSig$()` 는 module-local signature factory 를 반환. 컴포넌트 렌더 시작점에 `_s()` 호출되어 hook 호출 순서를 수집.
- `$RefreshReg$(type, id)` 는 컴포넌트 타입을 RefreshRuntime 에 등록.
- 두 글로벌은 **모듈 평가 전** `window.$RefreshReg$` / `window.$RefreshSig$` 로 설치되어야 하며, Vite 는 파일 평가를 wrapping 하여 prev/curr 을 save/restore 한다.

### 1.2 Preamble (HTML 주입)

Vite 의 `transformIndexHtml` 이 페이지 최상단에 주입:

```html
<script type="module">
  import RefreshRuntime from "/@react-refresh"
  RefreshRuntime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}
  window.$RefreshSig$ = () => type => type
  window.__vite_plugin_react_preamble_installed__ = true
</script>
```

### 1.3 `accept()` boundary 정적 분석

`import.meta.hot.accept(` **문자열이 원본 소스에 verbatim** 나타나야 Vite 가 이 모듈을 HMR boundary 로 인식한다 ([Vite HMR API](https://vite.dev/guide/api-hmr)). 주석 안에 있어도 토큰으로 간주 — dead-code 없이 문자열 매칭으로만 감지.

### 1.4 State preservation

`_s()` 가 수집한 hook signature hash 가 이전 renderer 의 hash 와 같으면 **`useState`/`useRef` 값을 복원**. hook 순서/개수/`useState` initializer 가 변하면 hash 불일치 → 강제 remount.

---

## 2. Bun.build 플러그인 훅 실측

### 2.1 지원 API ([Bun Plugins docs](https://bun.com/docs/runtime/plugins))

```ts
interface BunPlugin {
  name: string
  setup(build: PluginBuilder): void | Promise<void>
}

// 4 lifecycle hooks
build.onStart(cb)
build.onResolve({ filter, namespace }, cb)   // path → resolved path
build.onLoad({ filter, namespace }, cb)       // path → { contents, loader }
build.onBeforeParse(...)  // native plugins only
```

`onLoad` 가 핵심: 임의의 소스를 읽고 변환한 뒤 `{ contents, loader }` 로 반환하면 Bun 이 그 값을 parse/번들에 사용한다.

### 2.2 **핵심 발견**: Bun 이 이미 Fast Refresh 변환을 지원

Bun 1.3 ([release blog](https://bun.com/blog/bun-v1.3)) 에서 `Bun.build({ reactFastRefresh: true })` 가 정식 공개. `BuildConfig.reactFastRefresh: boolean` 하나로 `$RefreshReg$` / `$RefreshSig$` 주입이 활성화된다 ([BuildConfig reference](https://bun.com/reference/bun/BuildConfig), [PR #25731](https://github.com/oven-sh/bun/pull/25731)).

**실측** — Bun 1.3.12 에서 다음 입력

```tsx
import { useState } from 'react'
export default function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>
}
```

에 `Bun.build({ entrypoints, reactFastRefresh: true, target: 'browser' })` 를 적용하면 정확히 babel-plugin-react-refresh 와 동등한 결과를 emit 한다:

```js
var _s = $RefreshSig$();
const Counter = _s(function Counter() {
  _s();
  const [count, setCount] = useState(0);
  return /* @__PURE__ */ jsxDEV("button", { /* ... */ });
}, "MY+OAOgvYPI=");
$RefreshReg$(Counter, "Counter.tsx:default");
export { Counter as default };
```

### 2.3 제약 — 실측으로 확인

| 항목 | Bun.build 실제 거동 |
|---|---|
| `$RefreshReg$`/`$RefreshSig$` 주입 | ✅ `reactFastRefresh: true` 로 자동 |
| `import.meta.hot` 보존 | ❌ `undefined` 로 치환 (번들 시 강제) — `if (undefined) {}` 로 dead code |
| `import.meta.hot.accept(` 감지 | ❌ 번들이 소스 평면화로 literal 유실 |
| `react-refresh/runtime` 자동 번들 | ❌ 사용자가 shim 제공해야 함 |
| `define: { 'import.meta.hot': 'window.__x' }` 로 치환 | ✅ 작동 (escape hatch) |
| `Bun.Transpiler({ reactFastRefresh: true })` | ❌ 1.3.12 미공개 — [PR #28312](https://github.com/alexkahndev/bun-react-refresh-patch) 미머지 |

실측 재현: 본 문서와 함께 `/tmp/bun-rf-test` 에서 4종 시나리오 검증 (각 결과 확인됨).

---

## 3. 4 approaches 비교

| Approach | 방식 | 장점 | 단점 | 구현 비용 | Mandu 철학 |
|---|---|---|---|---|---|
| **A. babel-plugin-react-refresh** | `onLoad` 에서 babel transform | Vite 1:1 호환, 검증됨 | babel + plugin 의존성 (500KB+), zero-deps 위반 | 중 | 어긋남 |
| **B. SWC plugin** | `onLoad` 에서 swc 호출 | babel 대비 10× 빠름 | `@swc/core` rust binary 의존, Bun 호환성 **불확실**, Windows prebuilt 이슈 빈번 | 중 | 애매 |
| **C. 자체 regex/AST transform** | 순수 Mandu 구현 | 완전 zero-deps | edge case (class component / HOC / forwardRef) 누락 위험, 유지비용 | 고 | 적합하나 과도 |
| **D. Bun 네이티브 `reactFastRefresh: true`** | Bun.build 1줄 옵션 + runtime shim + 정적 boundary 분석 | zero-deps, **Bun 속도 유지**, 업스트림 개선을 자동 상속 | Bun-only lock-in, runtime shim + accept 주입은 Mandu 가 책임 | **저~중** | **완벽 부합** |

**권장: Approach D.** 근거:
1. Mandu 는 Bun 네이티브가 전제 (CLAUDE.md) — Bun-only lock-in 은 reject 사유 아님
2. zero-deps 철학 유지 (`react-refresh/runtime` 은 peer 로 이미 React 생태 기본 패키지 — 13KB wire bundle 실측)
3. babel/swc 추가 시 현재 `Bun.build raw 속도 × descendants-only incremental` 이라는 Phase 7 경쟁 우위가 희석됨
4. `reactFastRefresh` 는 GA API — Bun 팀이 유지. 우리가 lock-in 한 후 옵션이 사라질 위험 낮음
5. 업스트림 개선 (예: 향후 `Bun.Transpiler.reactFastRefresh` 가 0.1ms 로 나오면) 자동 수혜

---

## 4. 구현 단계 분해

### Phase 7.1.A-1 — Transform 파이프라인 (backend, ~1h)

**파일**: `packages/core/src/bundler/build.ts`

- `buildIsland()` / `buildPerIslandBundle()` / `buildRuntime()` 의 `safeBuild` 호출에 조건부 `reactFastRefresh: isDev` 추가
- `buildVendorShims()` 에 **제 6번째 shim** 추가: `_react-refresh-runtime.js` (`react-refresh/runtime` re-export)
- `importMap` 에 `"react-refresh/runtime": "/.mandu/client/_react-refresh-runtime.js"` 매핑 추가

**테스트**: 변환된 output 에 `$RefreshReg$` / `$RefreshSig$` 등장 여부 + gzip 크기 regression ≤ +2KB per island.

### Phase 7.1.A-2 — Runtime registry + preamble (frontend, ~2h)

**파일**:
- `packages/core/src/runtime/hmr-client.ts` (기존 `createManduHot` 보강)
- `packages/core/src/bundler/react-refresh-preamble.ts` (신규)
- `packages/core/src/runtime/ssr.ts` / `streaming-ssr.ts` (`<head>` 주입 지점)

**Preamble 코드** (Mandu 포맷 — Vite preamble 대체):

```ts
// 페이지 <head> 최상단 (script type="module")
import RefreshRuntime from "/.mandu/client/_react-refresh-runtime.js"
RefreshRuntime.injectIntoGlobalHook(window)
window.$RefreshReg$ = () => {}
window.$RefreshSig$ = () => (type) => type
window.__MANDU_REFRESH_INSTALLED__ = true

// 각 island 파일 평가 전/후 래핑용
window.__mandu_fresh__ = (filename) => {
  const prev = { reg: window.$RefreshReg$, sig: window.$RefreshSig$ }
  window.$RefreshReg$ = (type, id) => RefreshRuntime.register(type, filename + " " + id)
  window.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform
  return () => { window.$RefreshReg$ = prev.reg; window.$RefreshSig$ = prev.sig }
}
```

**dispatchReplacement()** 를 보강해 `performReactRefresh()` 호출. dev.ts 의 HMR client script 에서 island-update 수신 시 분기:

```ts
// ws.onmessage (island-update)
const cleanup = window.__mandu_fresh__(path)
try {
  const mod = await import(/* @vite-ignore */ bundleUrl + "?t=" + Date.now())
  if (dispatchReplacement(path, mod)) {
    RefreshRuntime.performReactRefresh()
  } else {
    location.reload()
  }
} finally {
  cleanup()
}
```

### Phase 7.1.A-3 — Boundary detection + injection (backend, ~1.5h)

**파일**: `packages/core/src/bundler/build.ts` (신규 플러그인)

```ts
// Mandu 규약: .client.tsx / .island.tsx 는 자동 boundary
const manduFastRefreshBoundary: BunPlugin = {
  name: "mandu-fr-boundary",
  setup(build) {
    build.onLoad({ filter: /\.(client|island)\.tsx?$/ }, async (args) => {
      const src = await Bun.file(args.path).text()
      // 사용자가 명시적으로 accept 작성한 경우 존중 (Vite-style)
      if (src.includes("import.meta.hot.accept(")) {
        return { contents: src, loader: "tsx" }  // 그대로 통과 — boundary 감지용 별도 수단으로 기록
      }
      // 자동 accept 주입
      const withBoundary = src + `
if (typeof window !== "undefined" && window.__MANDU_HMR__) {
  window.__MANDU_HMR__.acceptFile(${JSON.stringify(args.path)})
}
`
      return { contents: withBoundary, loader: "tsx" }
    })
  }
}
```

**boundary 레지스트리**: `build.ts` 의 `outputs[].imports` 기반 graph (R1 B 가 이미 구축) 에서 각 boundary 파일 경로를 수집 → 클라이언트 `window.__MANDU_HMR__.acceptFile()` 호출 시 자동 등록.

**왜 이 파일들만?** Mandu 는 SSR page/layout 은 Fast Refresh 대상 제외 (full reload 로 prerender 재생성 — Phase 7.0 #188 fix 가 이미 담당). Fast Refresh 는 **순수 클라이언트 stateful 존 (island)** 에만 적용.

### Phase 7.1.A-4 — Integration + test (quality, ~2h)

**테스트 매트릭스** (`packages/core/tests/fast-refresh/`):

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | `island.tsx` 의 JSX 텍스트 변경 | useState 값 보존, DOM 즉시 갱신 |
| 2 | `island.tsx` 에 hook 추가 (useEffect) | 강제 remount (signature mismatch) |
| 3 | `island.tsx` 에 `useState` initializer 변경 | state 리셋 ∵ hash 불일치 |
| 4 | forwardRef/memo wrapping 된 컴포넌트 | 올바른 display name 유지 |
| 5 | Anonymous `export default () => <div/>` | Fast Refresh OFF → 명시적 린트 경고 (Next.js 교훈 §5.2 item 6) |
| 6 | `import.meta.hot.accept(cb)` 명시적 호출 | user cb 실행, 자동 주입 비활성 |
| 7 | non-component export 섞인 파일 | `react-refresh/only-export-components` 린트 규칙 경고 |

E2E: `demo/auth-starter/` 의 `login-form.client.tsx` 실시간 수정 → Playwright 로 input 값 유지 확인.

---

## 5. React 19 호환성 결론

**호환 가능** — 단 조건부:

- React 19 + Fast Refresh 일반 프로젝트: **이슈 없음** ([react-refresh@0.18.0](https://www.npmjs.com/package/react-refresh) 가 React 19 지원)
- React 19 + **React Compiler**: 과거 문제 ([facebook/react#29115](https://github.com/facebook/react/issues/29115), [Expensify discussion](https://github.com/reactwg/react-compiler/discussions/21)) — 런타임이 `useState` 대신 `useMemo` 사용하도록 수정되어 해결됨. Mandu 는 Phase 7.1 에서 React Compiler 옵트인 추가 계획 없음 → 이슈 무관.
- 최소 요구사항: `react@>=19.0.0`, `react-refresh@>=0.18.0`. Mandu `package.json` peer 업데이트 필요.

---

## 6. 예상 함정 (Vite/Nuxt 이슈 재현 가능성)

| # | 이슈 | 원천 | Mandu 재현 가능성 | 대응 |
|---|---|---|---|---|
| F1 | Anonymous default export → state reset | Vite + Next.js 공통 | 높음 | 린트 규칙 `@mandujs/eslint-plugin` 에 `only-export-components` 추가 |
| F2 | Non-component export 섞이면 Fast Refresh 꺼짐 | [shadcn#8489](https://github.com/shadcn-ui/ui/issues/8489) | 중 | 린트 경고 + 문서화 |
| F3 | Symlink 경로 이중 등록 | [vitejs/vite#10558](https://github.com/vitejs/vite/issues/10558) | 높음 (pnpm 사용 시) | `realpath()` 정규화 (Phase 7.0 에서 이미 `normalizeFsPath` 부분 대응) |
| F4 | Cyclic import → 무한 루프 | Remix 2026 릴리즈노트 | 중 | `reactFastRefresh` 변환 결과에 cycle 감지 → full reload fallback |
| F5 | Class component state 소실 | react-refresh 본질 제약 | 항상 | 문서화만. 대안 없음 |
| F6 | HOC (`memo`, `forwardRef`) 의 displayName 누락 → 잘못된 register id | pmmmwh/react-refresh-webpack-plugin troubleshooting | 중 | Bun 의 `reactFastRefresh` 가 처리 (실측에서 `"counter.island.tsx:default"` 형식 id 확인) |
| F7 | `import.meta.hot.accept(` 를 번들이 strip | **본 조사에서 실측 확인** | 필연 | `define: { 'import.meta.hot': 'window.__MANDU_HMR__.selfAccept' }` 조합으로 우회 또는 수동 boundary 테이블 (Phase 7.1.A-3) 사용 |
| F8 | `react-refresh/runtime` 프로덕션 번들 혼입 | [craco#340](https://github.com/dilanx/craco/issues/340) | 중 | `env === "production"` 분기로 shim 빌드/import 스킵 (기존 `buildVendorShims` 패턴 유지) |
| F9 | ESM `import.meta.hot.dispose` 안 불림 | 드문 케이스 | 낮음 | Phase 7.0 `dispatchReplacement` 가 이미 dispose → accept 순서 보장 |

---

## 7. 의사결정 요구사항 (Phase 7.1 킥오프 전)

1. **React Compiler 지원 여부** — Phase 7.1 에서는 OFF 유지 제안 (React 19 단일 지원). 추후 Phase 7.2+ 옵트인 플래그.
2. **Boundary 규약** — 기본 자동 주입 (`.client.tsx` / `.island.tsx`) + 사용자 명시적 `import.meta.hot.accept()` 호출 시 존중. 논의 필요.
3. **린트 배포** — `@mandujs/eslint-plugin` 신규 패키지 또는 `@mandujs/cli doctor` 에 built-in 체크로 포함할지. Phase 7.1 범위 확장.
4. **Vite 공식 플러그인 생태계 호환** — Mandu 의 `window.__MANDU_HMR__` 대신 Vite 의 `window.__vite_plugin_react_preamble_installed__` 를 동시 설정하면 커뮤니티 devtool 과 호환. 작업량 +1h.

---

## 부록. 참고 링크

- [Vite HMR API — 공식](https://vite.dev/guide/api-hmr)
- [@vitejs/plugin-react DeepWiki](https://deepwiki.com/vitejs/vite-plugin-react/2.1-@vitejsplugin-react)
- [How React Fast Refresh works — Jarred Sumner](https://gist.github.com/Jarred-Sumner/1f13f48c12e84a7d9a05365018834475)
- [Beyond HMR — Fast Refresh 심층](https://leapcell.medium.com/beyond-hmr-understanding-reacts-fast-refresh-d6d80ef0fe4e)
- [Bun 1.3 Release Notes](https://bun.com/blog/bun-v1.3)
- [Bun Plugins docs](https://bun.com/docs/runtime/plugins)
- [Bun BuildConfig — reactFastRefresh](https://bun.com/reference/bun/NormalBuildConfig/reactFastRefresh)
- [PR #25731 — expose reactFastRefresh on Bun.build](https://github.com/oven-sh/bun/issues/25716)
- [bun-react-refresh-patch (Transpiler path, 미머지)](https://github.com/alexkahndev/bun-react-refresh-patch)
- [swc-plugin-react-refresh (Approach B 참고)](https://github.com/leegeunhyeok/swc-plugin-react-refresh)
- [pmmmwh/react-refresh-webpack-plugin Troubleshooting](https://github.com/pmmmwh/react-refresh-webpack-plugin/blob/main/docs/TROUBLESHOOTING.md)
- [facebook/react#29115 — React Compiler + Fast Refresh](https://github.com/facebook/react/issues/29115)
- [react-refresh npm](https://www.npmjs.com/package/react-refresh)

*실측 재현 환경*: Bun 1.3.12 / Windows 10, 2026-04-18.
