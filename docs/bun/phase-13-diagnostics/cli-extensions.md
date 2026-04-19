---
phase: 13
round: R0
status: design
date: 2026-04-18
audience: Mandu core team + dispatched agents (deploy / db-seed / upgrade / mcp-config)
depends_on:
  - packages/cli/src/commands/registry.ts
  - packages/cli/src/commands/deploy.ts
  - packages/cli/src/commands/upgrade.ts
  - packages/cli/src/commands/mcp.ts
  - docs/bun/phase-9-diagnostics/compile-binary.md
  - docs/rfcs/0001-db-resource-layer.md
sources:
  - https://vercel.com/docs/projects/project-configuration
  - https://vercel.com/docs/functions/runtimes/node-js
  - https://fly.io/docs/reference/configuration/
  - https://fly.io/docs/apps/launch/
  - https://docs.railway.com/reference/config-as-code
  - https://docs.netlify.com/configure-builds/file-based-configuration/
  - https://developers.cloudflare.com/pages/configuration/wrangler-configuration/
  - https://docs.docker.com/reference/dockerfile/
  - https://bun.com/docs/runtime/secrets
  - https://modelcontextprotocol.io/docs/tools/inspector
  - https://docs.anthropic.com/en/docs/claude-code/mcp
  - https://docs.github.com/en/rest/releases/releases
---

# Phase 13 — CLI 명령 확장 (`deploy` / `db seed` / `upgrade` / `mcp`) 설계

End-to-end 워크플로 완성. 기획(`init`) → 개발(`dev`) → 검증(`check/guard`) → 배포(`deploy`)까지 **한 CLI** 로 수렴. 현재 각 명령은 "preview-grade" 수준 (`deploy.ts` 74 줄, `upgrade.ts` 75 줄). Phase 13 은 이를 프로덕션 등급으로 끌어올린다.

---

## 1. 현황 스냅샷

| 명령 | 현 상태 | 격차 |
|---|---|---|
| `mandu deploy` | docker / fly 2 타겟. 아티팩트 파일만 생성, 실제 배포 래핑 없음 | +vercel/railway/netlify/cf-pages. provider CLI 래핑. secret 주입 |
| `mandu db` | plan / apply / status / reset (Phase 4c 완료) | **`seed` 부재** — RFC §9 에서 의도적 out-of-scope 처리됨 |
| `mandu upgrade` | npm/bun 기반 `@mandujs/*` 업데이트만 | 바이너리(Phase 9.1) self-update 없음. Windows exec-lock 미처리 |
| `mandu mcp` | tool 실행 (74 tools). IDE 등록 자동화 **없음** | `mandu mcp register <claude\|cursor\|continue>` 신규 필요 |

---

## 2. `mandu deploy` — Adapter 매트릭스

### 2.1 7 타겟 설계

| `--target` | 생성 파일 | Build artifact | Secret 주입 | Provider CLI | URL |
|---|---|---|---|---|---|
| `docker` | `Dockerfile` + `.dockerignore` | 단일 이미지 (static + SSR) | runtime ENV | `docker build/push` | https://docs.docker.com/reference/dockerfile/ |
| `fly` | `fly.toml` + `Dockerfile` | Docker image → Fly registry | `fly secrets set` | `flyctl deploy` | https://fly.io/docs/reference/configuration/ |
| `vercel` | `vercel.json` + `api/_mandu.ts` | static → CDN, SSR → `@vercel/node` | `vercel env add` | `vercel deploy` | https://vercel.com/docs/projects/project-configuration |
| `railway` | `railway.json` + `nixpacks.toml` | Nixpacks build | `railway variables set` | `railway up` | https://docs.railway.com/reference/config-as-code |
| `netlify` | `netlify.toml` + `netlify/functions/ssr.ts` | static → CDN, SSR → Lambda | `netlify env:set` | `netlify deploy` | https://docs.netlify.com/configure-builds/file-based-configuration/ |
| `cf-pages` | `wrangler.toml` + `_worker.js` | static → Pages, SSR → Worker | `wrangler secret put` | `wrangler deploy` | https://developers.cloudflare.com/pages/configuration/wrangler-configuration/ |
| `docker` (compose) | `docker-compose.yml` (opt) | multi-service (app + db) | `.env.production` | `docker compose up` | — |

**cf-pages 와 Phase 15 Edge 의 관계**: Phase 15 는 **프레임워크 런타임 Edge 호환** (handler abstraction, no-Node-API slot). Phase 13 cf-pages 는 **CLI 배포 래퍼만**. Phase 15 완료 전에는 `mandu deploy --target=cf-pages --edge` 는 warning: "Edge runtime compatibility unverified (Phase 15 pending)". 의도적 단계 분리.

### 2.2 공통 파이프라인

```
mandu deploy --target=<t>
  ├── 1. validateAndReport      (기존)
  ├── 2. guard-check             (기존)
  ├── 3. build                   (기존)
  ├── 4. adapter.generate(cfg)   (신규 — 아래 §2.3)
  ├── 5. secret.collect()        (신규 — .env.production → provider env API)
  ├── 6. adapter.deploy()        (신규 — provider CLI 래핑, opt-in)
  └── 7. health.probe()          (신규 — deployment URL 200 체크)
```

steps 1~4: 항상 실행 (artifact-only 모드). steps 5~7: `--execute` 플래그 필요.

### 2.3 Adapter interface

```ts
// packages/cli/src/deploy/adapters/types.ts
export interface DeployAdapter {
  id: "docker" | "fly" | "vercel" | "railway" | "netlify" | "cf-pages";
  generate(cfg: DeployContext): Promise<ArtifactMap>;  // config files
  collectSecrets(cfg: DeployContext): SecretSpec[];     // ENV required
  deploy(cfg: DeployContext, opts: DeployOpts): Promise<DeployResult>;
  healthcheck(url: string): Promise<boolean>;
}
export interface DeployContext {
  rootDir: string;
  mandu: ResolvedConfig;
  buildOutput: { staticDir: string; serverEntry: string; routes: RouteSpec[] };
  env: "production" | "preview";
}
```

각 adapter `packages/cli/src/deploy/adapters/{docker,fly,vercel,railway,netlify,cf-pages}.ts` 분리. Registry `packages/cli/src/deploy/registry.ts` — 기존 `commands/registry.ts` 패턴 차용.

### 2.4 Secret 주입 모델

- `.env.production` 읽기 (Bun.file, dotenv 파싱)
- Provider 별 secret API 호출 (예: `vercel env add X production`)
- **절대 금지**: secret 을 artifact 파일(vercel.json, fly.toml)에 평문 기록. 항상 `${VAR_NAME}` placeholder
- `--dry-run`: secret key 목록만 출력 (value 마스킹)
- 로컬 dev secret: `Bun.secrets.set({service:"mandu", name:"<project>"}, JSON.stringify(env))` (§7.3)

---

## 3. `mandu db seed` — Phase 4c 위에 얹기

### 3.1 파일 컨벤션

```
spec/db/seeds/
  ├── 001_admin_user.seed.ts        # 순서 보장 (파일명 prefix)
  ├── 002_sample_posts.seed.ts
  └── _only_dev/
      └── 003_fixture_data.seed.ts  # dev 환경 전용
```

```ts
// 001_admin_user.seed.ts
import type { SeedContext } from "@mandujs/core/db/seeds";
import { UserResource } from "../../resources/user.resource";

export default async function seed(ctx: SeedContext) {
  await ctx.upsert(UserResource, { email: "admin@example.com" }, {
    email: "admin@example.com",
    name: "Admin",
    role: "admin",
  });
}

export const meta = {
  environments: ["dev", "staging", "production"],  // 화이트리스트
  idempotent: true,                                 // upsert 사용 시 true
};
```

### 3.2 핵심 설계 결정

| 결정 | 선택 | 이유 |
|---|---|---|
| **순서** | 파일명 prefix 정렬 (migrations 와 동일) | 결정적, git-friendly |
| **멱등성** | `ctx.upsert(resource, where, data)` 헬퍼 제공 | 안전 재실행. ON CONFLICT / INSERT..SELECT 패턴 Phase 4c repo 위에 thin wrapper |
| **환경 분리** | `meta.environments` 화이트리스트 + `--env` 플래그 | prod 실수 방지 (default exclude prod) |
| **트랜잭션** | 파일당 1 transaction (BEGIN..COMMIT) | 부분 실패 시 해당 파일만 롤백, 이후 파일 skip |
| **Rollback** | 없음 (forward-only) | Phase 4c 와 동일 철학. 필요 시 migration 으로 처리 |
| **History 테이블** | `__mandu_seeds` (checksum + applied_at) | 중복 실행 방지. tamper detect (migrations 패턴 재사용) |
| **Typed resource** | Resource + Zod schema 통합 | `ctx.upsert<User>(UserResource, ...)` 컴파일타임 검증 |

### 3.3 명령 스펙

```
mandu db seed                      # 모든 환경 seed 중 현재 env 실행
mandu db seed --env=production     # 특정 env 강제 (confirmation 필요)
mandu db seed --file=001_admin     # 단일 파일만
mandu db seed --dry-run            # SQL 출력, 실행 안 함
mandu db seed --reset              # __mandu_seeds 초기화 후 전체 재실행
```

Exit codes: 0 ok / 1 error / 2 usage / 3 tampered (migrations 와 동일 규약).

### 3.4 보안

- **SQL injection**: Phase 4c `quoteIdent()` 강제 사용. Raw string interpolation 금지 (guard rule 추가)
- **Prod confirmation**: `MANDU_DB_SEED_PROD_CONFIRM=yes` + `--force` 둘 다 필요 (CI 제외)
- **Secret leakage**: seed 파일에 password 평문 금지. `Bun.password.hash()` 또는 `process.env` 레퍼런스

---

## 4. `mandu upgrade` — Binary self-update

### 4.1 분기 로직

```ts
// upgrade.ts (확장)
if (isRunningAsCompiledBinary()) {  // Bun.embeddedFiles 존재 여부로 감지
  await upgradeBinary(options);
} else {
  await upgradePackages(options);   // 현 로직 유지
}
```

### 4.2 바이너리 업데이트 플로우

1. **Discovery**: GitHub Releases API (`GET /repos/mandu/mandu/releases/latest`) — https://docs.github.com/en/rest/releases/releases
2. **Version compare**: `semver.gt(latest, current)` — `semver` 의존 추가 (작음)
3. **Download**: OS/arch 감지 (`process.platform`, `process.arch`) → 대응 asset URL
4. **Integrity**:
   - SHA-256 체크 (`<asset>.sha256` sidecar 파일 다운로드 후 비교)
   - **Phase 11 M-01 서명** 의존 → 서명 도입 전까지: SHA-256 only + release HTTPS 신뢰
   - 도입 후: Windows authenticode / macOS notarytool 검증 (`signtool verify` / `codesign -v`)
5. **Atomic replace** (OS 별):

| OS | 전략 | 주의 |
|---|---|---|
| Unix | `mv new $(which mandu)` | 실행 중 파일 replace 가능 (inode 교체), 현재 프로세스는 구버전 메모리 |
| Windows | 1) `mandu.exe` → `mandu.old.exe` 리네임, 2) `mandu.new.exe` → `mandu.exe`, 3) 다음 실행 시 `mandu.old.exe` 삭제 | `exec` 중 binary 삭제 불가 → rename 우회. 실패 시 `.old` 잔존 (다음 실행 시 cleanup) |

6. **Rollback**: `mandu upgrade --rollback` → `.old` 존재 시 복원. `$BIN.previous-version` 파일에 버전 기록

### 4.3 `BUN_BE_BUN=1` 와의 분리

바이너리 내장 Bun 의 `bun upgrade` 는 **Bun runtime 만** 갱신 (Mandu 로직 미포함). Mandu 자체 업데이트는 위 로직 별도. 두 기능 README 에서 명확히 구분.

---

## 5. `mandu mcp <provider>` — IDE 등록 자동화

### 5.1 현재 vs 목표

현재 `mandu mcp <tool>` — tool 실행. 확장:

```
mandu mcp                              # tool 목록 (기존)
mandu mcp <tool> [--args]              # tool 실행 (기존)
mandu mcp register <provider>          # NEW — IDE 에 Mandu MCP 서버 등록
mandu mcp config                       # NEW — config 파일 경로 조회
mandu mcp test <provider>              # NEW — connection test
```

### 5.2 Provider 매트릭스

| Provider | Config 파일 | 등록 방식 | URL |
|---|---|---|---|
| Claude Code | `~/.claude/mcp.json` (global) 또는 `.mcp.json` (project) | JSON merge (기존 servers 유지) | https://docs.anthropic.com/en/docs/claude-code/mcp |
| Cursor | `~/.cursor/mcp.json` | Claude 와 동일 포맷 | https://docs.cursor.com/features/mcp |
| Continue.dev | `~/.continue/config.json` | `mcpServers` 필드 주입 | https://docs.continue.dev/ |
| VS Code (GitHub Copilot) | `.vscode/mcp.json` | JSON merge | https://code.visualstudio.com/docs/copilot/customization/mcp-servers |

### 5.3 등록 스펙

```json
// 자동 주입되는 항목
{
  "mcpServers": {
    "mandu": {
      "command": "bunx",
      "args": ["@mandujs/mcp", "--project", "${PROJECT_ROOT}"],
      "env": { "MANDU_MCP_PROJECT": "${PROJECT_ROOT}" }
    }
  }
}
```

`--project` 플래그는 `.mandu/mcp-projects.json` 에 기록 (다중 프로젝트 관리). 등록 시 기존 config 백업 (`.backup.<ts>`).

### 5.4 Connection test (`mandu mcp test claude`)

1. Provider config 읽기 → Mandu 엔트리 파싱
2. Spawn 해당 command + `{"jsonrpc":"2.0","id":1,"method":"initialize"}` stdin 주입
3. 응답 JSON 파싱 → capabilities 표시
4. `tools/list` 호출 → tool 개수 검증
5. Exit 0 (OK) / 1 (spawn fail) / 2 (protocol err)

참조: MCP Inspector — https://modelcontextprotocol.io/docs/tools/inspector

---

## 6. 공통 아키텍처 — CLI Plugin 시스템

### 6.1 현 구조

`packages/cli/src/commands/registry.ts` 41 개 `registerCommand({...})` 선언 집약. 서드파티 plugin 불가. Phase 13 산출물은 **plugin entrypoint 공개**.

### 6.2 Plugin 로더 설계

```
packages/cli/src/commands/plugin-loader.ts (NEW)
  ├── discoverBuiltin()          → packages/cli/src/commands/*.ts (현재 수동 등록 대체)
  ├── discoverWorkspace()        → <cwd>/node_modules/mandu-plugin-*/package.json
  └── discoverUser()             → ~/.mandu/plugins/*.ts
```

각 플러그인 `manifest: { id, commands: CommandRegistration[] }` export. Loader 가 `registerCommand()` 호출로 통합.

### 6.3 공용 유틸 (`packages/cli/src/util/`)

신규:
- `provider-cli.ts` — `spawnProviderCli(bin, args, {env})` — version check + error normalize
- `secrets-bridge.ts` — `.env` ↔ `Bun.secrets` ↔ provider env API 매핑
- `github-releases.ts` — Releases API 래퍼 (rate limit / retry / checksum)
- `atomic-replace.ts` — OS 별 binary self-replace
- `json-merge.ts` — Config 파일 안전 병합 (기존 key 보존)

기존 재사용: `theme/*`, `errors.ts` (CLI_E*), `fs.ts:resolveFromCwd`.

### 6.4 다이어그램

```
       user invocation
            │
            ▼
   ┌─────────────────┐
   │  main.ts (argv) │
   └────────┬────────┘
            ▼
   ┌─────────────────┐    ┌──────────────┐
   │commandRegistry  │◄───│ plugin-loader│  (builtin + workspace + user)
   └────────┬────────┘    └──────────────┘
            ▼
   ┌─────────────────────────────────────┐
   │  deploy  │  db seed  │ upgrade │ mcp│
   └────┬─────┴─────┬─────┴────┬────┴─┬──┘
        ▼           ▼          ▼      ▼
   ┌────────┐  ┌────────┐ ┌────────┐ ┌─────────┐
   │adapter │  │Phase4c │ │GitHub  │ │provider │
   │registry│  │runner  │ │Releases│ │config   │
   └────────┘  └────────┘ └────────┘ └─────────┘
        │           │          │          │
        ▼           ▼          ▼          ▼
       docker/    SQL      atomic       ~/.claude/
       fly/...    exec     replace      ~/.cursor/
```

---

## 7. 보안 모델

### 7.1 Deploy
- Secret **절대 artifact 파일에 평문 기록 금지**. `${VAR}` placeholder 강제 (lint rule)
- `.env.production` 는 gitignore 검증 (`mandu deploy` 시 git tracked 면 error)
- Provider token: 환경변수만 (`VERCEL_TOKEN`, `FLY_API_TOKEN`) — CLI 인자 금지 (process 목록 유출)
- `--execute` 는 반드시 대화형 confirmation (CI 제외)

### 7.2 Seed
- Guard rule 신규: `spec/db/seeds/` 내 raw SQL `` ` `` backtick 금지 (Phase 4c repo API 만 허용)
- Prod env: `MANDU_DB_SEED_PROD_CONFIRM=yes` + `--force` 동시 필요
- Password: `Bun.password.hash()` 의무, 평문 저장 시 guard error

### 7.3 Upgrade
- HTTPS-only (http:// 스킴 거부)
- SHA-256 mismatch 시 즉시 abort + 로컬 파일 삭제
- Phase 11 M-01 서명 도입 후: authenticode/codesign 검증 실패 시 abort
- `.old` 바이너리 권한: 원본과 동일 (chmod 보존)

### 7.4 MCP
- Provider config 쓰기 전 backup (`.backup.<unix-ts>`)
- `env` 에 secret 직접 주입 금지 — `${env:VAR_NAME}` 참조만
- 로컬 dev token: `Bun.secrets.set({service:"mandu-mcp",name:provider}, token)` — OS keychain 활용 (https://bun.com/docs/runtime/secrets)

---

## 8. Phase 분할 (13.1 / 13.2 / 13.3 / 13.4)

`deploy` 가 독보적으로 크므로 단독 phase. 나머지 3개 병렬 가능.

| Sub-phase | 주제 | 작업 | 시간 | Agent |
|---|---|---|---|---|
| **13.1** | `mandu deploy` 확장 | 7 adapter + plugin system + secret bridge + health probe + 18 테스트 | **2 주** | backend-architect × 2 (adapter A: docker/fly/cf-pages / adapter B: vercel/railway/netlify) |
| **13.2** | `mandu db seed` | SeedRunner + `__mandu_seeds` history + upsert helper + env 화이트리스트 + 8 테스트 | **5 일** | backend-architect (Phase 4c 연장선) |
| **13.3** | `mandu upgrade` binary | GitHub Releases + SHA-256 + atomic replace (Unix/Win) + rollback + 6 테스트 | **4 일** | backend-architect (Phase 9.1 팔로업) |
| **13.4** | `mandu mcp register` | 4 provider config merge + connection test + Bun.secrets + 10 테스트 | **3 일** | backend-architect |
| **병렬 가능** | 13.2 // 13.3 // 13.4 | — | — | 독립 스코프 |
| **총 기간** | | | **2 주 + 1 주 (병렬)** = **3 주** | |

### 8.1 구현 순서

```
Week 1: 13.1 adapter foundation (plugin loader + types + docker/fly refactor)
        + 13.2 seed runner start (병렬)
        + 13.3 upgrade binary (병렬)
Week 2: 13.1 adapter wave 2 (vercel/railway/netlify/cf-pages)
        + 13.4 mcp register (병렬)
Week 3: 13.1 integration tests + E2E smoke (Fly + Vercel staging 프로젝트)
        + 모든 sub-phase 통합 QA
```

### 8.2 Definition of Done (Phase 13 전체)

- [ ] 7 deploy adapter 전부 dry-run E2E 통과
- [ ] 2 개 실제 staging 배포 성공 (Fly.io + Vercel)
- [ ] `mandu db seed` admin user demo (auth-starter 에 통합)
- [ ] `mandu upgrade` Unix + Windows 실측 self-update 1 회
- [ ] `mandu mcp register claude` 자동 등록 후 Claude Code 에서 `mandu` tool 인식
- [ ] 전 sub-phase 단위 + 통합 테스트 추가
- [ ] 기존 suite (1955+) 회귀 없음
- [ ] CI `--randomize --retry=2` 3회 green
- [ ] 신규 docs: `docs/cli/deploy.md`, `docs/cli/seed.md`, `docs/cli/mcp-integration.md`
- [ ] `docs/CLI-ROADMAP-v1.md` Phase D 항목 "Partial" → "Completed" 전환

---

## 9. 의사결정 필요

- **D13.1-A**: cf-pages adapter 를 Phase 13 에 포함 vs Phase 15 까지 대기? **제안**: Phase 13 은 warning 로 포함 (artifact 만), Phase 15 가 런타임 호환성 승격
- **D13.1-B**: Provider CLI 자동 설치 vs 사용자 선설치? **제안**: 선설치 + `mandu doctor` 가 체크 안내
- **D13.3-A**: Phase 11 M-01 (binary signing) 완료 대기? **제안**: SHA-256 only 로 먼저 release, signing 은 Phase 13.5 로 분리
- **D13.4-A**: MCP register 가 다중 프로젝트 지원? **제안**: v1 은 single project, multi-project 는 v2 (Phase 14)

---

## 10. 출처 (verified URLs)

- Vercel Project Config — https://vercel.com/docs/projects/project-configuration
- Vercel Node Runtime — https://vercel.com/docs/functions/runtimes/node-js
- Fly.io fly.toml — https://fly.io/docs/reference/configuration/
- Fly.io Launch — https://fly.io/docs/apps/launch/
- Railway config-as-code — https://docs.railway.com/reference/config-as-code
- Netlify netlify.toml — https://docs.netlify.com/configure-builds/file-based-configuration/
- Cloudflare Pages wrangler — https://developers.cloudflare.com/pages/configuration/wrangler-configuration/
- Dockerfile ref — https://docs.docker.com/reference/dockerfile/
- Bun.secrets — https://bun.com/docs/runtime/secrets
- GitHub Releases API — https://docs.github.com/en/rest/releases/releases
- MCP Inspector — https://modelcontextprotocol.io/docs/tools/inspector
- Claude Code MCP — https://docs.anthropic.com/en/docs/claude-code/mcp
- Cursor MCP — https://docs.cursor.com/features/mcp
- Bun --compile self-update 기반 — `docs/bun/phase-9-diagnostics/compile-binary.md` §6
