# @mandujs/mcp

## 0.13.0

### Minor Changes

- feat: manifest를 generated artifact로 전환 (Option D)

  - `spec/routes.manifest.json` → `.mandu/routes.manifest.json` (generated artifact)
  - `spec/spec.lock.json` → `.mandu/spec.lock.json`
  - `app/` (FS Routes)가 유일한 라우트 소스
  - legacy merge 로직 제거, auto-linking 추가
  - MCP tools FS Routes 기반으로 재작성

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.13.0

## 0.12.3

### Patch Changes

- docs: mention `.claude.json` as a valid MCP configuration location

## 0.12.2

### Patch Changes

- fix: publish 스크립트를 bun publish로 변경하여 workspace:\* 의존성 자동 변환

- Updated dependencies []:
  - @mandujs/core@0.12.2

## 0.12.1

### Patch Changes

- chore: change license from MIT to MPL-2.0 and fix workspace dependency

- Updated dependencies []:
  - @mandujs/core@0.12.1
