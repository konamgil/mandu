---
title: "React Compiler (opt-in 자동 memoization)"
status: experimental
audience: Mandu 사용자 + contributors
issue: "#240"
since: "@mandujs/core (next minor)"
---

# React Compiler — 자동 메모이제이션

> **TL;DR** — `experimental.reactCompiler.enabled: true` 한 줄로
> React 19 공식 Compiler (`babel-plugin-react-compiler`) 가 island /
> `"use client"` 페이지 / partial 에 자동으로 `useMemo` /
> `useCallback` / `React.memo` 를 주입합니다. SSR 은 건드리지 않습니다.

## 왜

에이전트가 생성한 React 코드는 inline object / array / 콜백으로
불필요한 re-render 를 유발합니다. React Compiler 는 빌드 타임에
이걸 알아서 memoize 해서 runtime 비용을 제거합니다. Next.js 15+ 가
실험적 지원, Mandu 는 Bun 네이티브 번들러에 Babel plug-in 으로
통합.

## 활성화

`mandu.config.ts`:

```ts
import type { ManduConfig } from "@mandujs/core/config";

export default {
  experimental: {
    reactCompiler: {
      enabled: true,
    },
  },
} satisfies ManduConfig;
```

Peer dependency 설치:

```bash
bun add -D @babel/core babel-plugin-react-compiler
```

두 패키지가 없으면 빌드는 계속 성공하지만 warning 이 로그에 찍히고
소스는 변환 없이 pass-through 됩니다 — 실수로 활성화해도 빌드가
깨지지 않도록.

## 어디에 적용되는가

| 파일 유형                      | Compiler 적용 | 이유                                         |
| ----------------------------- | :-----------: | -------------------------------------------- |
| `*.island.tsx`                | ✅            | client-hydrate → 재렌더 memoize 이익         |
| `*.partial.ts` / `partial()`  | ✅            | 동일                                         |
| `"use client"` 페이지         | ✅            | 동일                                         |
| `page.tsx` (SSR)              | ❌            | 1회 렌더 → HTML 직렬화, memoize 이익 없음   |
| `layout.tsx` (SSR)            | ❌            | 동일                                         |
| `slot.ts`                     | ❌            | 서버 전용 데이터 로더                       |
| `route.ts` (API)              | ❌            | React 아님                                  |

`manduClientPlugins()` 게이트가 이 구분을 담당합니다.

## 세부 설정

```ts
experimental: {
  reactCompiler: {
    enabled: true,
    compilerConfig: {
      compilationMode: "infer",   // "infer" | "annotation" | "all"
      target: "19",                // "19" | "18" | "17"
      panicThreshold: "critical_errors", // "none" | "critical_errors" | "all_errors"
    },
  },
},
```

`compilerConfig` 는 `babel-plugin-react-compiler` 에 그대로 전달.
자세한 옵션은 [공식 문서](https://react.dev/learn/react-compiler) 참고.

## React 버전 요구

Mandu 는 `react@^19.2.0` / `react-dom@^19.2.0` 을 peer 로 요구합니다.
Compiler 출력은 React 19.1+ 의 `react/compiler-runtime` export 를
사용하므로 19.2 이상을 권장 (19.2.5 가 현재 최신, caret 이 자동
resolve).

## 15% 바일아웃

React Compiler 는 안전하게 memoize 할 수 없는 컴포넌트를 **조용히
건너뜀** (공식 "15% bailout"). 조건:

- 조건부 hook 호출
- ref escape (`useRef().current` 가 closure 밖으로 유출)
- 가변성 기반 패턴 (Compiler 는 immutable 전제)

Bailout 은 런타임 에러가 아니라 단순히 memoize 를 생략합니다.
`eslint-plugin-react-compiler` 로 정적 감지 가능 (oxlint 는 아직
포트 안 됨 — 그 룰만 ESLint hybrid 로 남기는 것도 한 방법).

## Dev / Prod 동작

- **Production 빌드** (`mandu build`): flag 켜면 모든 client 번들에
  적용.
- **Dev 서버** (`mandu dev`): 동일하게 적용. Compiler 가 소스 파일
  변경마다 Babel 을 한 번 더 돌리므로 HMR round trip 이 ~30-80ms
  느려질 수 있음. Ergonomic 리스크가 있으면 dev 에서는 끄고 prod 만
  쓰는 것도 가능:

  ```ts
  experimental: {
    reactCompiler: {
      enabled: process.env.NODE_ENV === "production",
    },
  },
  ```

## 트러블슈팅

### "peer dependency missing — skipping transform"
`bun add -D @babel/core babel-plugin-react-compiler` 실행.

### 특정 컴포넌트가 memoize 안 됨
Bailout — ESLint React Compiler 플러그인으로 원인 확인. 대부분
ref escape / 조건부 hook.

### 빌드가 느려졌음
예상된 동작 (~10-30% regression). island 갯수에 비례. 해결:
- Prod 만 활성화 (위 Dev / Prod 섹션 참고)
- `compilationMode: "annotation"` 으로 범위 축소 (명시적 opt-in 만)

### HMR 가 깨짐
fastRefresh + compiler 공존 이슈는 알려진 edge case. 발생 시
`packages/core/src/bundler/build.ts` 의 plugin 순서 (`manduClientPlugins`
→ `fastRefreshPlugin`) 가 의도대로인지 확인 후 issue 리포트.

## 관련 구현

- 플러그인: `packages/core/src/bundler/plugins/react-compiler.ts`
- 게이트: `packages/core/src/bundler/build.ts::manduClientPlugins()`
- 스키마: `packages/core/src/config/validate.ts::ManduConfigSchema`
- Dev wiring: `packages/core/src/bundler/dev.ts` +
  `packages/cli/src/commands/dev.ts`

## 관련 이슈

- [#240](https://github.com/konamgil/mandu/issues/240) — 원본 제안
- [docs/tooling/oxc-lint-roadmap.md](../tooling/oxc-lint-roadmap.md) —
  린트 스택 (compiler skip 진단 surface 는 Phase 2)
