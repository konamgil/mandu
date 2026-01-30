# 코딩 에이전트용 프롬프트/지시문 템플릿 (MVP‑0.1)

> 그대로 복붙해서 코딩 에이전트(Claude/Codex/GPT 등)에 던지면 됩니다.

---

```text
너는 Bun + TypeScript + React 기반의 “Agent‑Native Fullstack Framework (MVP‑0.1)”를 구현하는 코딩 에이전트다.
목표는 “Spec(JSON) → Generate(생성물) → Guard(오염 방지) → Dev 서버 SSR 동작”의 핵심 가설을 검증하는 것이다.

[절대 원칙]
- MVP‑0.1 범위를 넘지 마라: WS/ISR/Plan/Logic 슬롯/HMR/스트리밍 SSR/하이드레이션은 모두 금지.
- 런타임은 Bun.serve를 직접 사용한다. 다른 웹 프레임워크(Hono/Nest/Express 등) 위에 얹지 마라.
- generated 파일과 spec 파일은 사람이 직접 수정하면 안 된다. Guard로 감지하고 실패 처리해야 한다.
- 라우트 파일명/경로는 pattern이 아니라 routeId 기반으로 “항상 안정적”이어야 한다.

[리포지토리 목표 구조(최소)]
repo/
  spec/
    routes.manifest.json
    spec.lock.json
    history/                (optional)
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
  tests/
    smoke.spec.ts
  tsconfig.json
  package.json
  README.md

[최종 완료 기준(DoD) — 반드시 전부 통과]
1) `bunx mandu spec-upsert --file spec/routes.manifest.json` 로 스펙 등록/검증/lock 갱신이 된다.
2) `bunx mandu generate` 로 generated 산출물이 생성된다.
3) `bunx mandu dev` 로 서버가 뜬다(Bun.serve).
4) `/` 요청 시 SSR HTML이 응답된다(200, `<!doctype html>` 포함).
5) `/api/health` 요청 시 JSON 응답(200)이 된다.
6) generated 파일을 손으로 수정하면 `bunx mandu guard`가 FAIL 하고, 왜 막혔는지 + 대안을 제시한다.
7) `bun test`의 smoke 테스트가 통과한다.

[초기 스펙 샘플: spec/routes.manifest.json]
아래 파일을 repo에 포함해라(정확히).
{
  "version": 1,
  "routes": [
    {
      "id": "home",
      "pattern": "/",
      "kind": "page",
      "module": "apps/server/generated/routes/home.route.ts",
      "componentModule": "apps/web/generated/routes/home.route.tsx"
    },
    {
      "id": "health",
      "pattern": "/api/health",
      "kind": "api",
      "module": "apps/server/generated/routes/health.route.ts"
    }
  ]
}

[구현 단계(순서 고정, 단계별로 결과 보고)]
각 Step을 완료할 때마다:
- 생성/수정한 파일 목록
- 실행한 커맨드
- 커맨드 출력/결과(요약)
- DoD 관점에서 무엇이 완료됐는지
를 짧게 보고하고 다음 Step으로 넘어가라.

Step 1) Spec 스키마/검증(필수)
- packages/core/src/spec/schema.ts: Zod로 RoutesManifest 스키마 작성
  - RouteSpec: { id, pattern, kind, module, componentModule? }
  - rules: id unique, pattern startsWith '/', kind=page면 componentModule 필수
- packages/core/src/spec/load.ts: load+validate+에러포맷
- packages/core/src/spec/lock.ts: sha256 hash + read/write spec.lock.json
=> 잘못된 스펙이면 사람이 이해 가능한 에러를 출력해야 한다.

Step 2) Minimal SSR
- packages/core/src/runtime/ssr.ts: renderToString 기반 HTML 생성(Response 반환)
- apps/web/entry.tsx: routeId로 간단히 분기하여 ReactElement 반환(초기엔 stub)
=> 하이드레이션/스트리밍 금지.

Step 3) Router + Bun 서버
- packages/core/src/runtime/router.ts: pattern 매칭(:param 지원 최소)
- packages/core/src/runtime/server.ts: Bun.serve 래핑(fetch에서 match 후 api/page 처리)
- apps/server/main.ts: manifest 로드 후 startServer
=> `/`와 `/api/health`가 동작해야 한다.

Step 4) Generator (spec → generated)
- packages/cli/src/commands/generate-apply.ts:
  - apps/server/generated/routes/{routeId}.route.ts 생성
  - apps/web/generated/routes/{routeId}.route.tsx 생성(page only)
  - manifest에 없는 stale routeId 파일은 삭제
- packages/core/src/generator/generate.ts:
  - packages/core/map/generated.map.json 출력(파일->routeId 매핑)
=> 생성물 파일명은 routeId 기반 고정.

Step 5) Guard (MVP‑0.1 4개 룰)
- rules:
  1) spec hash mismatch 감지: “spec-upsert로 변경하라”
  2) apps/**/generated/** 수동 변경 감지: “generate로 재생성하라”
  3) non-generated에서 generated 직접 import 감지: FAIL
  4) generated에서 fs import 금지: FAIL
- packages/core/src/guard/check.ts + packages/cli/src/commands/guard-check.ts
=> 실패 시 ruleId/file/message/suggestion을 포함한 report 생성.

Step 6) Report
- packages/core/src/report/build.ts: guard 결과를 표준 report.json으로 출력
- CLI에서 콘솔 요약 출력 + nextActions 제시

Step 7) CLI 커맨드 완성
- packages/cli/src/main.ts: mandu spec-upsert / generate / guard / dev
- bunx 실행 가능하게 package.json에 bin 설정
=> README에 사용법 4줄로 재현 가능하게.

Step 8) Smoke Test
- tests/smoke.spec.ts:
  - 서버를 특정 포트로 띄우고
  - fetch `/` 200 + doctype 포함 확인
  - fetch `/api/health` 200 + JSON 확인
=> `bun test` 통과.

[중요 구현 제약]
- Node 전용 API 사용 최소화. Bun 런타임에서 동작해야 한다.
- 라우팅은 복잡하게 만들지 말고 :param 수준까지만.
- SSR은 renderToString만.
- error/stacktrace는 MVP‑0.1에서 고급 매핑까지 완벽히 안 해도 되지만,
  최소한 generated.map.json을 생성하여 향후 확장 기반을 깔아라.

[마지막]
모든 Step이 끝나면:
- DoD 7개 항목을 각각 어떻게 만족하는지 체크리스트로 증명하고,
- 실행 커맨드 시퀀스를 한 줄로 정리해라.
```
