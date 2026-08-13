# Typed apply contract

상태: Current

Mandu의 typed apply는 에이전트에게 임의 shell 권한을 주는 기능이 아니다.
승인된 파일과 최종 UTF-8 내용을 구조화된 operation으로 묶고, 현재 파일
상태와 일치할 때만 적용하는 제한된 mutation protocol이다.

## 1. Operation 작성

CLI는 operation draft JSON을 실행 가능한 plan으로 binding한다.

```json
{
  "intent": "add dashboard page",
  "idempotencyKey": "dashboard-v1",
  "rollbackPolicy": "automatic",
  "operations": [
    {
      "id": "dashboard-page",
      "kind": "route.create",
      "target": "app/dashboard/page.tsx",
      "effect": {
        "type": "write",
        "content": "export default function Page() { return <main>Dashboard</main>; }\n",
        "encoding": "utf8"
      }
    }
  ]
}
```

```bash
mandu agent plan "add dashboard page" \
  --operations typed-operations.json --write --json
```

MCP에서는 같은 `operations`, `idempotencyKey`, `rollbackPolicy`를
`mandu.agent.plan` input으로 직접 전달한다. Mandu가 현재 파일을 읽어
`baseRevision`, exact `scope`, write `permissions`, 각 operation의
`exists/contentHash` precondition을 채운다.

지원 kind:

```text
file.create
file.patch-with-hash
route.create
api.create
contract.update
guard.safe-fix
generated.refresh
```

## 2. Preview와 실행

apply의 기본값은 항상 preview다.

```bash
mandu agent apply --from .mandu/agent-plan.json --json
mandu agent apply --from .mandu/agent-plan.json --execute --write --json
```

MCP 실행은 `mandu.agent.apply`에 `dryRun: false`를 명시한다. intent만 있고
typed operation이 없는 plan은 `--execute`를 주어도 compatibility preview로
남으며 파일을 쓰지 않는다.

실행 전 Mandu는 다음을 모두 확인한다.

1. target이 project 내부의 정규화된 상대 경로다.
2. target이 exact scope와 write permission에 포함된다.
3. `.git`, `node_modules`, 환경 파일, agent plan/receipt/snapshot 경로가 아니다.
4. symlink를 거쳐 project 밖으로 나가지 않는다.
5. scope의 현재 revision이 plan의 `baseRevision`과 같다.
6. 각 기존 파일의 SHA-256이 `contentHash`와 같다.
7. create/update 종류와 target 규약이 맞는다.

임의 shell command, provider deploy, recursive delete는 operation이 아니다.
operation 하나의 content는 최대 2 MiB다.

## 3. Receipt와 rollback

실행은 `.mandu/agent-receipts/`에 고유 receipt를 남긴다. CLI와 MCP가 같은
Core 함수를 사용하므로 receipt schema도 같다.

주요 필드:

```text
receiptId, planId, idempotencyKey, baseRevision
status, operations, touchedFiles, changedFiles
verification, rollback, startedAt, completedAt
```

모든 write 전에 `.mandu/agent-snapshots/`에 touched-file snapshot을 만든다.
기본 `automatic` policy는 operation 또는 required verify가 실패하면 이미
적용된 파일만 역순으로 복원한다. 성공 receipt의 변경을 나중에 되돌릴 때는:

```bash
mandu agent repair --rollback <rollbackId> --apply --json
```

rollback은 현재 파일 hash가 apply가 쓴 hash와 같을 때만 복원한다. apply 후
사람이나 다른 도구가 고친 파일은 conflict로 보고 덮어쓰지 않는다.

같은 `planId + idempotencyKey`를 다시 실행하면 저장된 receipt를 replay하고
파일을 다시 쓰지 않는다. 다른 결과를 원하면 현재 상태에서 새 plan을
binding하고 새 idempotency key를 사용한다.

## 4. Release gate

```bash
bun run test:agent-apply-gate
```

gate는 20개 대표 typed task 성공률 85% 이상, scope 밖 write 0건,
실패 rollback 100%, stale precondition 사용자 변경 보존 100%를 요구한다.
