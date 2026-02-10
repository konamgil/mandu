# @mandujs/cli

## 0.15.0

### Minor Changes

- feat: auto-resolve template dependency versions at init time

  Template package.json now uses dynamic placeholders ({{CORE_VERSION}}, {{CLI_VERSION}}) instead of hardcoded versions. The actual installed versions are injected when running `mandu init`.

## 0.14.1

### Patch Changes

- fix: update template dependency versions to latest (core ^0.13.0, cli ^0.14.0) and remove legacy spec/ directory

## 0.14.0

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

## 0.13.2

### Patch Changes

- fix: create `.claude.json` alongside `.mcp.json` and use relative `cwd` for MCP setup

## 0.13.1

### Patch Changes

- fix: add process.exit(0) after successful command execution to prevent CLI from hanging

## 0.13.0

### Minor Changes

- 터미널 종료 관련 업데이트

### Patch Changes

- fix: add process.exit(0) after successful command execution to prevent CLI from hanging

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
