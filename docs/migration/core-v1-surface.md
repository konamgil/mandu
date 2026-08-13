# Core v1 surface migration

상태: Current
대상: `@mandujs/core` v0 subpath를 사용하는 앱과 패키지

Phase 3부터 Core의 stable import는 root와 아래 10개 subpath로 제한된다.

```text
client  config  contract  error  guard
middleware  plugins  router  runtime  testing
```

## 자동 변환

먼저 변경 예정 파일만 확인한다.

```bash
bunx mandu-codemod core-v1 .
```

검토한 뒤 적용한다.

```bash
bunx mandu-codemod core-v1 . --write
```

CI에서는 쓰지 않고 drift만 검사할 수 있다.

```bash
bunx mandu-codemod core-v1 . --check
```

codemod는 root와 stable subpath를 그대로 두고 나머지를 compatibility
경로로 바꾼다.

```ts
// before
import { createResource } from "@mandujs/core/resource";
import { createLogger } from "@mandujs/core/logging/logger";

// after
import { createResource } from "@mandujs/core/compat/resource/index";
import { createLogger } from "@mandujs/core/compat/logging/logger";
```

## 새 코드 규칙

- 새 앱 코드는 stable entry만 사용한다.
- compat import가 필요하면 extension/recipe 경계에 격리하고 제거 계획을
  기록한다.
- `@mandujs/core/compat/*`를 다른 라이브러리의 공개 type에 노출하지 않는다.
- generated output은 직접 고치지 말고 원본 또는 generator를 수정한다.

변환 후 `bun run typecheck`, 관련 테스트, `bunx mandu check`를 실행한다.

## v1 beta 전환 체크리스트

1. Bun을 `>=1.3.12`로 맞추고 `bun install --frozen-lockfile`을 통과시킨다.
2. `mandu-codemod core-v1 . --write` 후 `--check` 결과를 0건으로 만든다.
3. 자동화는 공식 CLI 6개(`create dev build start check agent`)를 기준으로
   바꾼다. 다른 명령은 v0 compatibility 또는 Labs 경로다.
4. 배포 자동화에서 `mandu deploy`를 제거하고 `mandu build`가 만든 검증된
   artifact를 provider 도구에 전달한다.
5. MCP는 기본 8개 action을 사용한다. 이전 저수준 도구가 꼭 필요하면
   전환 기간에만 `agent-full` profile을 명시한다.
6. agent write는 intent-only preview가 아니라 typed operations plan을 만들고,
   실행 시 `agent apply --execute`의 receipt/rollback ID를 보존한다.
7. `bun run test:smoke`, `bun run test:reference-apps`, 관련 앱 테스트를 통과시킨다.

`@mandujs/core/compat/*`는 v0 전환용이다. v1 beta에서 즉시 무조건 삭제하는
경로가 아니라, stable 대체 API와 removal manifest가 확인된 항목만 major
정책에 따라 제거한다.
