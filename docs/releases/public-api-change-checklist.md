# Public API Change Checklist

작성일: 2026-05-18

`@mandujs/core`, `@mandujs/cli`, `@mandujs/mcp`의 public surface를 바꾸는 PR은 릴리즈 전에 이 체크리스트를 통과해야 한다.

## Scope Detection

- [ ] `packages/*/package.json`의 `exports`, `bin`, `types`, `main` 변경 여부를 확인했다.
- [ ] root barrel(`src/index.ts`)에 새 export가 추가되었는지 확인했다.
- [ ] 문서화된 import path가 삭제/이동/이름 변경되었는지 확인했다.
- [ ] CLI command, flag, exit code, output JSON schema 변경 여부를 확인했다.
- [ ] MCP tool name, input schema, output schema, resource URI 변경 여부를 확인했다.

## Classification

- [ ] 변경된 API를 stable, experimental, internal 중 하나로 분류했다.
- [ ] stable API 변경이면 breaking/additive/deprecation 중 하나로 판정했다.
- [ ] experimental API 변경이면 release note에 변경 이유와 대체 경로를 적었다.
- [ ] internal API 노출이면 사용자-facing 근거 또는 제거 계획을 남겼다.

## Compatibility

- [ ] stable API 제거/rename/signature change는 major version 또는 migration note가 있다.
- [ ] additive stable API는 기존 import path와 타입 추론을 깨지 않는다.
- [ ] deprecated API는 최소 2 minor 동안 compatibility shim 또는 명확한 오류 메시지를 제공한다.
- [ ] package subpath 이동은 이전 subpath alias 또는 migration note를 제공한다.

## Verification

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run check:public-api`
- [ ] `bun run check:target-boundaries`
- [ ] `bun run test:packages`
- [ ] `bun run check:publish`
- [ ] 관련 package의 targeted test
- [ ] public API 문서 또는 reference 업데이트
- [ ] migration note 또는 release note 업데이트

## Required Artifacts

- [ ] 변경 요약
- [ ] 영향을 받는 import path 목록
- [ ] breaking 여부와 버전 영향
- [ ] 사용자 마이그레이션 경로
- [ ] 검증 명령 결과

참조: `docs/architect/public-api-boundary.md`
