# 기술 아키텍쳐 (MVP‑0.1) — Bun + TS + React, Spec→Generate→Guard→SSR

> MVP‑0.1 목표: **구조 보존(Architecture Preservation)** 가설 1개만 검증한다.  
> 범위 제외: WS/ISR/Plan/Logic Slot/HMR/Streaming SSR/Hydration.

---

## 1. 아키텍처 개요

### 1.1 핵심 가설
- Spec(JSON)이 SSOT이고
- Generator가 generated를 만든다
- Guard가 spec/generated 오염을 차단한다
- Bun.serve SSR 라우팅이 동작한다

### 1.2 컴포넌트
- **Core**: runtime(서버/라우터/SSR), spec 스키마/로드/락, guard, report, map
- **CLI**: spec‑upsert / generate / guard / dev
- **Apps**:
  - server: Bun.serve 엔트리 + generated route handlers
  - web: SSR 엔트리 + generated React route modules

---

## 2. 디렉토리 구조(최소)

```
repo/
  spec/
    routes.manifest.json
    spec.lock.json
    history/                       # optional
  apps/
    server/
      main.ts
      generated/routes/
    web/
      entry.tsx
      generated/routes/
  packages/
    core/
      runtime/server.ts
      runtime/router.ts
      runtime/ssr.ts
      spec/schema.ts
      spec/load.ts
      spec/lock.ts
      guard/rules.ts
      guard/check.ts
      report/build.ts
      map/generate.ts
    cli/
      main.ts
      commands/spec-upsert.ts
      commands/generate-apply.ts
      commands/guard-check.ts
      commands/dev.ts
      util/fs.ts
  tests/
    smoke.spec.ts
  tsconfig.json
  package.json
  README.md
```

---

## 3. SSOT 스펙: routes.manifest.json

### 3.1 최소 스키마
- manifest: `{ version: number, routes: RouteSpec[] }`
- RouteSpec:
  - `id: string` (unique)
  - `pattern: string` (startsWith `/`)
  - `kind: "page" | "api"`
  - `module: string` (server handler path)
  - `componentModule?: string` (page일 때 필수)

### 3.2 lock 파일(spec.lock.json)
- `routesHash`(sha256), `updatedAt`(ISO)
- spec 변경은 `ax spec-upsert`로만 반영되도록 사용

---

## 4. 런타임 동작 흐름

### 4.1 Bun 서버(fetch) 디스패치
1) `fetch(req)`
2) `router.match(pathname)` → `{ route, params } | null`
3) kind == api → `import(route.module)` → handler 실행
4) kind == page → SSR 렌더링:
   - `apps/web/entry.tsx`의 `createApp({ routeId, url, params })`
   - `packages/core/runtime/ssr.ts`로 `renderToString`
   - HTML Response 반환

### 4.2 SSR 범위 제한(중요)
- `renderToString` 기반
- Streaming/Hydration/Client bundle/HMR은 MVP‑0.1 제외

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

- `bunx ax spec-upsert --file spec/routes.manifest.json`
- `bunx ax generate`
- `bunx ax guard`
- `bunx ax dev`

---

## 9. Smoke Test

- 서버를 띄우고
- `/` → 200 + doctype 포함 확인
- `/api/health` → 200 + JSON 확인

---

## 10. MVP‑0.1 완료 기준(DoD 7개)
1) spec-upsert 검증/lock 갱신  
2) generate 생성  
3) dev 서버 실행  
4) `/` SSR 200  
5) `/api/health` 200 JSON  
6) generated 수정 시 guard fail + 설명  
7) bun test 통과
