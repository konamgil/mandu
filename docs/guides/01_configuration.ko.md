# 설정

Mandu는 프로젝트 설정을 단일 config 파일에서 읽어 CLI와 런타임에 반영합니다.

## 지원 파일

아래 순서대로 탐색하며, 처음 발견된 파일을 사용합니다:

1. `mandu.config.ts`
2. `mandu.config.js`
3. `mandu.config.json`
4. `.mandu/guard.json` (Guard 전용 override)

## 우선순위

- CLI 옵션 > config 값 > 기본값

`mandu dev`, `mandu build`, `mandu routes` 실행 시 설정을 검증하고 문제가 있으면 종료합니다.

## 스키마 요약

### `server`
- `port`: number (1-65535)
- `hostname`: string
- `cors`: boolean 또는 `{ origin?, methods?, credentials? }`
- `streaming`: boolean

### `dev`
- `hmr`: boolean
- `watchDirs`: string[] (dev 번들러 추가 감시 디렉토리)

### `build`
- `outDir`: string (기본 `.mandu`)
- `minify`: boolean
- `sourcemap`: boolean
- `splitting`: boolean (향후 기능)

### `guard`
- `preset`: `"mandu" | "fsd" | "clean" | "hexagonal" | "atomic"`
- `srcDir`: string
- `exclude`: string[] (glob)
- `realtime`: boolean
- `rules`, `contractRequired`: 레거시 spec-guard 제어

### `fsRoutes`
- `routesDir`: string (기본 `"app"`)
- `extensions`: string[]
- `exclude`: string[] (glob)
- `islandSuffix`: string (기본 `".island"`)

### `seo`
- `enabled`: boolean
- `defaultTitle`: string
- `titleTemplate`: string

## 예시

```ts
// mandu.config.ts
export default {
  server: {
    port: 3000,
    hostname: "localhost",
    cors: false,
    streaming: false,
  },
  dev: {
    hmr: true,
    watchDirs: ["src/shared", "shared"],
  },
  build: {
    outDir: ".mandu",
    minify: true,
    sourcemap: false,
  },
  guard: {
    preset: "mandu",
    srcDir: "src",
    exclude: ["**/*.test.ts"],
    realtime: true,
  },
  fsRoutes: {
    routesDir: "app",
    extensions: [".tsx", ".ts"],
    exclude: ["**/*.spec.ts"],
    islandSuffix: ".island",
  },
  seo: {
    enabled: true,
    defaultTitle: "My App",
    titleTemplate: "%s | My App",
  },
};
```

## 참고

- `mandu.config`의 `guard` 값은 `mandu guard arch`의 기본값(preset/srcDir/exclude)으로 사용됩니다. CLI 옵션이 우선이며, 고급 옵션(layers, override, severity)은 계속 CLI에서 제어합니다.
- `fsRoutes` 설정은 `mandu dev`와 `mandu routes`에서 적용됩니다.
