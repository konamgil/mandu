# 기술 아키텍쳐 (MVP‑0.1) — Bun + TS + React, Spec→Generate→Guard→SSR

> MVP‑0.1 목표: **구조 보존(Architecture Preservation)** 가설 1개만 검증한다.  
> 범위 제외: WS/ISR/Plan/Logic Slot/HMR/Streaming SSR/Hydration.

> 구현 현황 노트 (2026-01-30): 이 문서는 MVP‑0.1 기준이다.  
> 현재 코드에는 Hydration 스펙/번들러/런타임, Client Router, Streaming SSR, HMR, Router v5, CLI 확장, MCP 확장 도구가 구현되어 있다.  
> 최신 구현 상태는 `docs/status.md` / `docs/status.ko.md`를 기준으로 본다.

---

## 1. 아키텍처 개요

### 1.1 핵심 가설
- Spec(JSON)이 SSOT이고
- Generator가 generated를 만든다
- Guard가 spec/generated 오염을 차단한다
- Bun.serve SSR 라우팅이 동작한다

> **Option D 마이그레이션 노트**: `routes.manifest.json`은 이제 `app/` 디렉토리의 FS Routes로부터 자동 생성되는 아티팩트이다. 생성된 매니페스트는 `.mandu/routes.manifest.json`에 저장된다. Spec은 여전히 SSOT 역할을 하지만, 그 원천(source)은 파일시스템 라우트(`app/`)이다.

### 1.2 컴포넌트
- **Core** (`@mandujs/core`): runtime(서버/라우터/SSR), spec 스키마/로드/락/트랜잭션, guard, report, map
- **CLI** (`@mandujs/cli`): init / spec‑upsert / generate / guard / build / dev  
  (추가 구현: contract, openapi, change, doctor, watch, brain)
- **MCP** (`@mandujs/mcp`): AI 에이전트 통합을 위한 MCP 서버 ✅
- **Apps**:
  - server: Bun.serve 엔트리 + generated route handlers
  - web: SSR 엔트리 + generated React route modules

---

## 2. 디렉토리 구조(최소)

```
repo/
  app/                             # FS Routes (라우트 원천)
  .mandu/                          # 생성된 아티팩트 (자동 생성)
    routes.manifest.json
    spec.lock.json
    history/                       # 스냅샷 히스토리
  spec/
    slots/                         # 슬롯 파일 (비즈니스 레이어)
    contracts/                     # Contract 정의
  apps/
    server/
      main.ts
      generated/routes/
    web/
      entry.tsx
      generated/routes/
  packages/
    core/
      src/
        runtime/server.ts
        runtime/router.ts
        runtime/ssr.ts
        spec/schema.ts
        spec/load.ts
        spec/lock.ts
        change/transaction.ts        # 트랜잭션 API ✅
        guard/rules.ts
        guard/check.ts
        report/build.ts
        generator/generate.ts
    cli/
      src/
        main.ts
        commands/spec-upsert.ts
        commands/generate-apply.ts
        commands/guard-check.ts
        commands/dev.ts
        util/fs.ts
    mcp/                           # MCP 서버 ✅
      src/
        server.ts
        tools/
          spec.ts
          generate.ts
          transaction.ts
          history.ts
          guard.ts
          slot.ts
          hydration.ts
          contract.ts
          brain.ts
          runtime.ts
        resources/handlers.ts
        utils/
          project.ts
  tests/
    smoke.spec.ts
  tsconfig.json
  package.json
  README.md
```

---

## 3. SSOT 스펙: routes.manifest.json

### 3.1 최소 스키마
- manifest (`.mandu/routes.manifest.json`): `{ version: number, routes: RouteSpec[] }`
- RouteSpec:
  - `id: string` (unique)
  - `pattern: string` (startsWith `/`)
  - `kind: "page" | "api"`
  - `module: string` (server handler path)
  - `componentModule?: string` (page일 때 필수)

### 3.2 lock 파일(`.mandu/spec.lock.json`)
- `routesHash`(sha256), `updatedAt`(ISO)
- 매니페스트 변경은 `app/` FS Routes 변경 후 자동 반영

---

## 4. 런타임 동작 흐름

### 4.1 Bun 서버(fetch) 디스패치
1) `fetch(req)`
2) `router.match(pathname)` → `{ route, params } | null`
3) kind == api → `import(route.module)` → handler 실행
4) kind == page → SSR 렌더링:
   - `apps/web/entry.tsx`의 `createApp({ routeId, url, params })`
   - `packages/core/src/runtime/ssr.ts`로 `renderToString`
   - HTML Response 반환

### 4.2 SSR 범위 제한(중요)
- `renderToString` 기반
- Streaming/Hydration/Client bundle/HMR은 MVP‑0.1 제외
  - 구현 현황: Streaming SSR/Hydration/Client bundle/HMR가 코드에 포함됨 (실험적/확장 기능)

---

## 5. Generator 설계

### 5.1 입력
- validated `routes.manifest.json`

### 5.2 출력
- `apps/server/generated/routes/{routeId}.route.ts`
  - api handler 스텁 / page는 SSR로 연결
- `apps/web/generated/routes/{routeId}.route.tsx`
  - React 컴포넌트 스텁
- `packages/core/map/generated.map.json`
  - `{ filePath: routeId }` 매핑(디버깅 기반)

### 5.3 안정성 규칙
- 파일명은 **pattern이 아니라 routeId 기반**
- routeId가 같으면 파일 경로/이름은 불변

---

## 6. Guard (MVP‑0.1 최소 4개 룰)

1) **Spec hash mismatch 감지**
- lock과 불일치면 FAIL, “spec-upsert로 변경 반영” 안내

2) **generated 수동 변경 감지**
- `apps/**/generated/**` 변경 감지 시 FAIL, “generate로 재생성” 안내

3) **non-generated → generated 직접 import 금지**
- 엔트리/일반코드가 generated를 직접 import하면 FAIL

4) **generated에서 금칙 import(fs) 금지**
- 보안/일관성 위해 최소 금칙 적용

> MVP‑0.1에서는 레이어링/복잡한 의존 그래프까지는 하지 않는다.  
> 핵심은 “spec/generated 오염 방지”를 100%로 만드는 것.

---

## 7. Report 표준(JSON)

- `status: "pass" | "fail"`
- `guardViolations: [{ ruleId, file, message, suggestion }]`
- `nextActions: string[]`

CLI는 report를 파일로 출력하고, 콘솔에 요약을 출력한다.

---

## 8. CLI 커맨드(사용자 경험)

- `bunx mandu spec-upsert --file .mandu/routes.manifest.json`
- `bunx mandu generate`
- `bunx mandu guard`
- `bunx mandu build`
- `bunx mandu dev`

> 현재 CLI는 contract/openapi/change/doctor/watch/brain 명령도 제공한다.

---

## 9. Smoke Test

- 서버를 띄우고
- `/` → 200 + doctype 포함 확인
- `/api/health` → 200 + JSON 확인

---

## 10. MVP‑0.1 완료 기준(DoD 7개) ✅
1) spec-upsert 검증/lock 갱신
2) generate 생성
3) dev 서버 실행
4) `/` SSR 200
5) `/api/health` 200 JSON
6) generated 수정 시 guard fail + 설명
7) bun test 통과

---

## 11. MCP 서버 아키텍처 (`@mandujs/mcp`) ✅

### 11.1 개요
MCP(Model Context Protocol) 서버를 통해 AI 에이전트가 Mandu 프레임워크를 직접 조작할 수 있습니다.

### 11.2 디렉토리 구조
```
packages/mcp/
├── src/
│   ├── index.ts              # 진입점
│   ├── server.ts             # ManduMcpServer 클래스
│   ├── tools/
│   │   ├── spec.ts           # 라우트 CRUD
│   │   ├── generate.ts       # 코드 생성
│   │   ├── transaction.ts    # begin/commit/rollback
│   │   ├── history.ts        # 스냅샷 관리
│   │   ├── guard.ts          # 규칙 검사
│   │   ├── slot.ts           # 슬롯 읽기/쓰기
│   │   ├── hydration.ts      # Hydration/번들 빌드
│   │   ├── contract.ts       # Contract 관리
│   │   └── brain.ts          # Doctor/Watch/Architecture
│   ├── resources/
│   │   └── handlers.ts       # 리소스 핸들러
│   └── utils/
│       └── project.ts        # 프로젝트 경로 유틸
└── package.json
```

### 11.3 MCP 도구 목록

| 카테고리 | 도구 | 설명 |
|----------|------|------|
| **Spec** | `mandu_list_routes` | 라우트 목록 조회 |
| | `mandu_get_route` | 특정 라우트 조회 |
| | `mandu_add_route` | 라우트 추가 |
| | `mandu_delete_route` | 라우트 삭제 |
| | `mandu_validate_manifest` | Manifest 유효성 검사 |
| **Generate** | `mandu_generate` | 코드 생성 |
| | `mandu_generate_status` | 생성 상태 조회 |
| **Transaction** | `mandu_begin` | 트랜잭션 시작 (스냅샷 생성) |
| | `mandu_commit` | 변경 확정 |
| | `mandu_rollback` | 변경 취소 (스냅샷 복원) |
| | `mandu_tx_status` | 트랜잭션 상태 조회 |
| **History** | `mandu_list_history` | 히스토리 조회 |
| | `mandu_get_snapshot` | 스냅샷 조회 |
| | `mandu_prune_history` | 오래된 히스토리 정리 |
| **Guard** | `mandu_guard_check` | Guard 검사 |
| | `mandu_analyze_error` | 에러 분석 |
| **Slot** | `mandu_read_slot` | 슬롯 파일 읽기 |
| | `mandu_validate_slot` | 슬롯 내용 검증 |
| **Hydration** | `mandu_build` | 클라이언트 번들 빌드 |
| | `mandu_build_status` | 번들 상태/매니페스트 조회 |
| | `mandu_list_islands` | Hydration 대상 라우트 목록 |
| | `mandu_set_hydration` | 라우트 Hydration 설정 |
| | `mandu_add_client_slot` | 클라이언트 슬롯 추가 |
| **Contract** | `mandu_list_contracts` | Contract 목록 조회 |
| | `mandu_get_contract` | Contract 조회 |
| | `mandu_create_contract` | Contract 생성 |
| | `mandu_update_route_contract` | 라우트에 Contract 연결 |
| | `mandu_validate_contracts` | Contract-Slot 검증 |
| | `mandu_sync_contract_slot` | Contract/Slot 동기화 |
| | `mandu_generate_openapi` | OpenAPI 생성 |
| **Brain** | `mandu_doctor` | Guard 실패 분석 |
| | `mandu_watch_start` | Watch 시작 |
| | `mandu_watch_status` | Watch 상태 조회 |
| | `mandu_watch_stop` | Watch 중지 |
| | `mandu_check_location` | 파일 위치 규칙 검사 |
| | `mandu_check_import` | import 규칙 검사 |
| | `mandu_get_architecture` | 아키텍처 규칙 조회 |
| **Runtime** | `mandu_get_runtime_config` | 런타임 설정 조회 |
| | `mandu_get_contract_options` | Contract normalize/coerce 옵션 조회 |
| | `mandu_set_contract_normalize` | Contract normalize/coerce 설정 |
| | `mandu_list_logger_options` | 로거 옵션 목록 |
| | `mandu_generate_logger_config` | 로거 설정 코드 생성 |

### 11.4 MCP 리소스

| URI | 설명 |
|-----|------|
| `mandu://spec/manifest` | routes.manifest.json |
| `mandu://spec/lock` | spec.lock.json |
| `mandu://generated/map` | generated.map.json |
| `mandu://transaction/active` | 활성 트랜잭션 정보 |
| `mandu://slots/{routeId}` | 라우트 슬롯 내용 |
| `mandu://watch/warnings` | Watch 경고 목록 |
| `mandu://watch/status` | Watch 상태 |

### 11.5 트랜잭션 흐름

```
┌─────────────────────────────────────────────────────────────┐
│                   Transaction Flow                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. mandu_begin         스냅샷 생성 (manifest + slots)      │
│          ↓                                                  │
│   2. mandu_add_route     Spec 수정                          │
│          ↓                                                  │
│   3. mandu_generate      코드 생성                          │
│          ↓                                                  │
│   4. 슬롯 로직 작성     spec/slots/*.slot.ts 편집           │
│          ↓                                                  │
│   5. mandu_guard_check   규칙 검사                          │
│          ↓                                                  │
│   6a. mandu_commit       ✅ 성공 → 히스토리에 저장           │
│   6b. mandu_rollback     ❌ 실패 → 스냅샷으로 복원          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 11.6 에러 분류 시스템

런타임 에러 발생 시 `generated.map.json`을 활용해 수정해야 할 위치를 안내:

| 에러 타입 | 설명 | 수정 위치 |
|-----------|------|-----------|
| `SPEC_ERROR` | Spec 정의 문제 | `.mandu/routes.manifest.json` |
| `LOGIC_ERROR` | 슬롯 로직 문제 | `spec/slots/{routeId}.slot.ts` |
| `FRAMEWORK_BUG` | 프레임워크 버그 | 이슈 리포트 |

---

## 12. MVP‑0.3 완료 기준(DoD) ✅

1) MVP‑0.1 전체 통과
2) MCP 서버 설치 및 연결
3) `mandu_add_route` → `mandu_generate` → 슬롯 로직 작성 워크플로우 동작
4) `mandu_begin` → 작업 → `mandu_rollback`으로 완전 복원
5) `mandu_guard_check` 실패 시 수정 가이드 제공
6) `mandu_analyze_error`로 에러 분류 및 수정 위치 안내
