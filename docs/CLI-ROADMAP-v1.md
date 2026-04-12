# Mandu CLI Roadmap v1.0

> Current status sync based on the actual CLI surface
>
> Date: 2026-04-12

---

## Snapshot

- `mandu --help` 기준 top-level command: `38`
- `mandu mcp --list` 기준 built-in MCP tools: `74`
- `mandu mcp --list` 기준 MCP categories: `18`
- `bun run typecheck` 기준 `core / cli / mcp / ate` 모두 통과

참고:
- MCP 수치는 터미널 단독 실행 기준이다.
- 서버 인스턴스가 필요한 category는 기본 `--list` 결과에서 빠질 수 있다.

---

## Shipped

### Phase A. 기본 품질 + 핵심 UX

완료:
- `mandu dev`
  - ready summary 출력
  - `o / r / c / q` shortcut 지원
  - `--open` 지원
- `mandu build`
  - bundle summary table 출력
  - `Next: mandu start (or mandu preview)` 안내
- `mandu clean`
- `mandu info`
  - Mandu / Bun / OS / Node / config / guard / adapter / cache 상태 출력
- `mandu preview`

### Phase B. 스캐폴딩 + 워크플로우 자동화

완료:
- `mandu cache stats`
- `mandu cache clear /path`
- `mandu cache clear --tag=<tag>`
- `mandu cache clear --all`
- `mandu middleware init --preset jwt|all`
- `mandu auth init --strategy jwt`
- `mandu session init`
- `mandu ws <name>`
- `mandu collection create <name> --schema markdown`

구현 세부:
- `mandu dev`와 `mandu start`는 `.mandu/runtime-control.json`을 기록한다.
- `mandu cache`는 이 control file을 읽어 런타임의 `/_mandu/cache` endpoint와 직접 통신한다.

### Phase C. AI 에이전트 통합

완료:
- `mandu mcp <tool>`
- `mandu fix`
  - guard heal
  - diagnose
  - optional build verify
- `mandu generate --ai`
- `mandu explain <rule>`
- `mandu review`
- `mandu ask "<question>"`

### Phase D. 운영 / 배포 / 생태계

완료:
- `mandu deploy`
  - validate + build
  - `--target docker`
  - `--target fly`
- `mandu upgrade`
- `mandu completion <bash|zsh|fish>`

---

## Partial

아래 항목은 usable 상태지만 아직 더 다듬을 여지가 있다.

- `mandu cache`
  - 현재는 CLI가 띄운 런타임과의 control plane은 동작한다.
  - 외부 adapter/runtime이 같은 invalidation endpoint를 노출하지 않으면 CLI cache 제어는 제한된다.
- `mandu fix`
  - 현재는 Guard 중심 auto-heal + diagnose + verify 흐름이다.
  - 임의의 build error 전체를 일반화된 self-heal 루프로 복구하는 수준은 아니다.
- `mandu deploy`
  - 지금은 deployment artifact 생성과 preflight validation 중심이다.
  - hosted provider API와 직접 연동하는 one-click deploy는 아직 아니다.
- `mandu upgrade`
  - 현재는 `@mandujs/*` 패키지 점검/업데이트에 집중한다.
- `mandu completion`
  - top-level command completion은 제공한다.
  - subcommand / option completion은 아직 단순하다.

---

## Current Command Surface

주요 그룹은 다음과 같다.

- Core
  - `init`, `dev`, `build`, `start`, `clean`, `info`, `preview`
- Validate
  - `check`, `guard`, `contract`, `doctor`, `cache`, `fix`, `review`, `explain`
- Generate
  - `routes`, `generate`, `middleware`, `auth`, `session`, `ws`, `collection`, `scaffold`, `new`
- Tooling
  - `openapi`, `mcp`, `ask`, `brain`, `add`, `test:auto`, `test:heal`
- Ops
  - `change`, `lock`, `watch`, `monitor`, `deploy`, `upgrade`, `completion`

---

## Next Priorities

1. Adapter-aware cache control
   - Bun 기본 런타임 외 adapter에서도 동일한 invalidation contract를 제공
2. Deploy 확장
   - target 추가
   - adapter와 artifact handoff 정리
3. Completion 고도화
   - subcommand / option completion 지원
4. Help / docs automation
   - command registry와 MCP metadata를 기준으로 사용자 문서 자동 동기화

---

## Notes

- 이 문서는 초기 아이디어 문서가 아니라 현재 구현 상태에 맞춘 sync 문서다.
- 수치와 표면은 실제 `mandu --help`, `mandu mcp --list`, `bun run typecheck` 결과를 기준으로 갱신했다.
