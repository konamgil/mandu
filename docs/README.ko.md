# Mandu 문서

Mandu는 Bun, React, 감독형 AI 개발을 위한 Agent-Safe Fullstack
Framework입니다. 집중된 풀스택 runtime에 아키텍처, contract, build state,
agent 변경 안전성을 결합합니다.

[English](./README.md)

## Golden Path

```text
create -> dev -> page/API -> agent change -> verify -> build -> start
```

```bash
bunx @mandujs/cli create my-app --yes
cd my-app
bun install
bun run dev
```

공식 최상위 CLI 표면은 정확히 다음 6개입니다.

```text
create  dev  build  start  check  agent
```

이전 명령은 v0 동안 compatibility 또는 Labs 경로로 남지만 v1 제품 계약은
아닙니다. `deploy`, `deploy:plan`은 retire되었으며 Mandu는 검증된 artifact
생성까지만 책임지고 provider 작업은 provider 도구에 맡깁니다.

## 읽는 순서

1. [Agent-Safe 제품 전략](./product/03_agent_safe_refoundation_strategy.md)
2. [Agent workflow](./guides/07_agent_workflow.md)
3. [Typed apply contract](./guides/08_typed_apply.md)
4. [설정](./guides/01_configuration.ko.md)
5. [Core 공개 API 경계](./architect/public-api-boundary.md)
6. [Reference app 계약](./architect/reference-apps.md)
7. [Core v1 migration](./migration/core-v1-surface.md)
8. [Production artifact contract](./deploy/artifact-contract.md)

## Agent 표면

기본 MCP profile은 여섯 `mandu.agent.*` action과 두 docs action만
노출합니다. 공식 skill 여섯 개는 공통 workflow, route, contract,
hydration, Guard, testing을 담당합니다. CLI, MCP, skill은 같은 action
model의 adapter이며 제품 로직을 따로 구현하면 안 됩니다.

Typed apply는 명시적 실행 opt-in 뒤에서 구현되어 있습니다. 정확한 scope,
base revision, content hash를 묶고 touched-file snapshot을 만든 뒤 검증 결과를
CLI/MCP 공통 receipt에 남깁니다. intent만 있는 plan은 읽기 전용
compatibility preview로 유지됩니다.

## 안정성 등급

- Stable Core import: `@mandujs/core`와 문서화된 subpath 10개
- Compatibility: v0 migration 동안의 `@mandujs/core/compat/*`
- Labs: ATE, Kitchen, Playground, Edge, desktop, design, AI brain
- External: cloud deploy 실행과 credential 관리

과거 계획과 폐기된 skill catalog는 `docs/archive/`에 보존되며 현재 제품
계약을 정의하지 않습니다.
