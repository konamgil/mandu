# Mandu Agent-Safe workflow

상태: Current
대상: coding agent, supervisor, CLI/MCP adapter author

Mandu의 공식 변경 루프는 하나다.

```text
context -> plan -> apply -> verify -> repair
```

`apply`는 기본적으로 dry-run이다. 쓰기는 typed operation이 들어 있는 실행
가능 plan에서만 명시적 `--execute` 또는 MCP `dryRun=false`로 연다. intent만
있는 기존 plan은 compatibility preview로 유지되며 파일을 쓰지 않는다.

## 1. 작업 전

1. `AGENTS.md`와 프로젝트 규약을 읽는다.
2. route, API, contract, hydration, guard, test, build, release, docs 중
   작업 domain을 정한다.
3. 설치된 공식 Mandu skill을 적용한다.
4. 해당 MCP action이 있으면 직접 source 편집보다 먼저 사용한다.
5. MCP/skill을 사용할 수 없으면 그 사실과 CLI/source fallback을 밝힌다.

## 2. 공식 action

| 단계 | CLI | MCP |
|---|---|---|
| Context | `mandu agent context` | `mandu.agent.context` |
| Plan | `mandu agent plan` | `mandu.agent.plan` |
| Apply | `mandu agent apply` | `mandu.agent.apply` |
| Verify | `mandu agent verify` | `mandu.agent.verify` |
| Repair | `mandu agent repair` | `mandu.agent.repair` |
| Sync | `mandu agent sync` | `mandu.agent.sync` |

Typed apply의 plan 형식, CLI/MCP 예제, receipt와 rollback 규칙은
[Typed apply contract](./08_typed_apply.md)를 따른다.

MCP 기본 profile에는 위 여섯 action과 `mandu.docs.search`,
`mandu.docs.get`만 노출한다. domain별 저수준 도구는 내부 handler이며 기본
agent surface가 아니다.

## 3. 공식 skills

| Domain | Skill | 최소 검증 |
|---|---|---|
| 공통 변경 루프 | `mandu-agent-workflow` | `mandu agent verify --changed --json --write` |
| page/API route | `mandu-fs-routes` | route targeted tests + verify |
| API contract | `mandu-contract` | contract tests + typecheck + verify |
| island/client boundary | `mandu-hydration` | hydration boundary/E2E + verify |
| architecture/import | `mandu-guard` | Guard + boundary checks + verify |
| test 변경 | `mandu-testing` | targeted Bun test + package gate |

스킬 원본은 `skills/official/` 한 곳뿐이다. Skills 패키지와 MCP resource는
생성물이며 직접 고치지 않는다.

## 4. 변경 규칙

- plan scope 밖 파일을 쓰지 않는다.
- `.mandu/` 생성물을 직접 수정하지 않는다.
- contract와 handler를 함께 변경한다.
- Guard 오류를 숨기려고 규칙을 약화하지 않는다.
- hydration 변경은 browser/client boundary까지 검증한다.
- 기존 사용자 변경과 precondition이 충돌하면 덮어쓰지 않고 중단한다.
- provider 배포와 credential 관리는 Mandu 밖에서 수행한다. Mandu는
  `build`와 [production artifact contract](../deploy/artifact-contract.md)까지만
  책임진다.

## 5. 검증 수준

| 변경 | 요구되는 검증 |
|---|---|
| 문서 | `bun run check:docs-drift`, `git diff --check` |
| route/contract/guard | targeted tests, product typecheck, `mandu agent verify` |
| runtime/build/hydration | Core tests, hydration checks, Golden Path smoke |
| 공개 surface/package | public/package/target boundary, tarball release check |
| 공식 skill | generator, drift check, Skills/CLI/MCP tests |

전체 제품 변경의 기본 gate:

```bash
bun run typecheck:product
bun run lint:product
bun run check:public-api
bun run check:core-v1-imports
bun run check:package-boundaries
bun run check:target-boundaries
bun run test:agent-apply-gate
bun run test:product
bun run test:smoke
```

## 6. 결과 보고

다음 증거를 남긴다.

```text
Domain:
Selected skill/action:
Fallback and reason:
Changed files and intent:
Validation passed:
Validation skipped and reason:
Remaining risk:
```

검증하지 않은 항목을 성공으로 보고하지 않는다. package behavior가 바뀌면
Changeset을 함께 남긴다.
