# Mandu Framework 구현 재평가 보고서 (세계적 아키텍처 관점)
작성일: 2026-01-28  
대상: `C:\Users\User\workspace\mandu` 기준 현재 구현  
평가 방법: 코드/템플릿/테스트/문서 정적 검토 (실행/벤치마크 미수행)

## 1. 총평 (Executive Summary)
Mandu는 “Spec = SSOT + Guard + Transaction”을 실 코드로 구현해, 에이전트 기반 개발의 구조 보존 문제를 정면으로 다루는 독창적 프레임워크다.  
특히 Spec→Generate→Guard의 핵심 루프와 트랜잭션/스냅샷이 결합되어 있다는 점은 세계적 프레임워크에서도 보기 어려운 강점이다.  
다만 런타임–번들러–하이드레이션의 실제 연결 경로가 끊겨 있고, 템플릿/CLI/문서 간 불일치가 누적되어 “완결성”과 “현장 DX”가 떨어진다.  
이 연결 고리만 정리되면 Mandu는 기존 프레임워크와 명확히 구분되는 “아키텍처 보존형 개발 OS”로 진입할 수 있다.

## 2. 구현 기반 아키텍처 흐름 (코드 실측)
### 2.1 핵심 실행 흐름
1) Spec 로드 및 검증: `packages/core/src/spec/load.ts`  
2) Lock 갱신: `packages/core/src/spec/lock.ts`  
3) 코드 생성 + generated.map 작성: `packages/core/src/generator/generate.ts`  
4) Guard 검사/자동수정: `packages/core/src/guard/check.ts`, `packages/core/src/guard/auto-correct.ts`  
5) 런타임 SSR: `packages/core/src/runtime/server.ts`, `packages/core/src/runtime/ssr.ts`  
6) 트랜잭션/히스토리: `packages/core/src/change/*`

### 2.2 CLI 경로
- `spec-upsert`: `packages/cli/src/commands/spec-upsert.ts`  
- `generate`: `packages/cli/src/commands/generate-apply.ts`  
- `guard`: `packages/cli/src/commands/guard-check.ts`  
- `dev`: `packages/cli/src/commands/dev.ts`  
- `change`: `packages/cli/src/commands/change/*`

### 2.3 MCP 경로
- Tool 정의: `packages/mcp/src/tools/*`  
- Resource 정의: `packages/mcp/src/resources/handlers.ts`  
- 서버 본체: `packages/mcp/src/server.ts`

## 3. 세계적 프레임워크 관점의 강점
### 3.1 계약 중심(SSOT) 설계의 명확성
- Spec 스키마가 강한 계약으로 작동한다: `packages/core/src/spec/schema.ts`.  
- Prisma/GraphQL codegen 계열처럼 “스펙이 단일 진실”이라는 구조는 대규모 협업과 자동화에 유리하다.

### 3.2 Guard + Transaction의 결합
- Guard 위반을 자동 수정하고, 실패 시 스냅샷 롤백까지 수행:  
  `packages/core/src/guard/auto-correct.ts`, `packages/core/src/change/*`.  
- 에이전트 환경에서 가장 취약한 “파괴적 수정”을 시스템적으로 제어하는 설계는 세계적 수준의 차별점이다.

### 3.3 에러 분류와 수정 위치 안내
- 오류를 SPEC/LOGIC/FRAMEWORK로 분리하고 고정된 error code 체계를 제공:  
  `packages/core/src/error/types.ts`.  
- 스택 분석 기반 blame frame 추적: `packages/core/src/error/stack-analyzer.ts`.  
- 이는 “진단 가능성”을 중시하는 최신 프레임워크 흐름과 정렬된다.

### 3.4 Slot 자동 검증/교정
- 슬롯 문법 검증과 자동 수정 루프는 에이전트 작업을 전제로 한 고유 기능:  
  `packages/core/src/slot/validator.ts`, `packages/core/src/slot/corrector.ts`.

## 4. 정합성 매트릭스 (Spec–Generator–Runtime–Guard–Tooling)
| 기능 영역 | Spec | Generator | Runtime | Guard | Tooling/CLI |
|---|---|---|---|---|---|
| API Routes | 구현됨 | 구현됨 | 구현됨 | 구현됨 | 구현됨 |
| Page Routes | 구현됨 | 구현됨 | 구현됨(SSR) | 부분 | 부분 |
| Slot (server) | 구현됨 | 구현됨 | 부분(연결 약함) | 구현됨 | 구현됨 |
| Hydration/Client | 부분 | 부분 | 미연결 | 부분 | 미연결 |
| Transaction/History | 구현됨 | N/A | N/A | 연계됨 | 구현됨 |
| Error Mapping | 구현됨 | 부분(맵 생성) | 부분(맵 미사용) | N/A | MCP 일부 |

## 5. 주요 이슈 (우선순위)
### P0. 실행 경로 단절 (Hydration & Bundler)
- **증거**:  
  - SSR HTML에 `__MANDU_DATA__` 주입 없음: `packages/core/src/runtime/ssr.ts`  
  - Island 마커(`data-mandu-island`) 주입 없음: `packages/core/src/runtime/ssr.ts`  
  - `.mandu/client` 정적 서빙 없음: `packages/core/src/runtime/server.ts`  
  - Bundler 생성물은 있으나 로드 경로 부재: `packages/core/src/bundler/build.ts`  
- **영향**: Hydration은 설계 문서가 있어도 실제 실행 불가능.  
- **개선**: SSR 렌더링 단계에서 데이터/마커/스크립트 삽입 + 서버 정적 서빙 도입.

### P0. CLI/템플릿 불일치로 인한 즉시 실패
- **증거**:  
  - 템플릿에 `build` 스크립트 존재하지만 CLI에 `build` 명령 없음:  
    `packages/cli/templates/default/package.json`, `packages/cli/src/main.ts`  
  - 루트 템플릿의 패키지 네이밍 불일치:  
    `templates/default/package.json`, `templates/default/apps/server/main.ts`  
- **영향**: 새 프로젝트 생성 시 즉시 커맨드 실패 가능.  
- **개선**: `mandu build` 추가 또는 템플릿 스크립트 제거, 패키지 명 정합화.

### P0. Error Context 타입 불일치
- **증거**:  
  - `ManduFilling.handle`의 `routeContext` 타입은 `routeId`인데  
    `ErrorClassifier`는 `id`를 기대: `packages/core/src/filling/filling.ts`, `packages/core/src/error/types.ts`  
- **영향**: 타입 안정성 위반 + 에러 리포트에 route context 누락.  
- **개선**: 타입 정합화 + generator가 `routeContext` 전달.

### P1. App Entry/레이아웃 경로 미연결
- **증거**:  
  - `apps/web/entry.tsx`가 런타임에서 호출되지 않음:  
    `packages/core/src/runtime/server.ts`, `packages/cli/src/commands/dev.ts`  
- **영향**: 글로벌 레이아웃/Provider/Route 등록 루트가 사라짐.  
- **개선**: 서버 런타임에서 `setCreateApp` 호출 경로 추가.

### P1. Generated Map 위치와 의미 혼재
- **증거**:  
  - `generateRoutes`가 `packages/core/map`에 map을 생성: `packages/core/src/generator/generate.ts`  
- **영향**: 앱 프로젝트 내부에 “framework 내부 경로”가 생성되어 경계 혼탁.  
- **개선**: `.mandu/generated.map.json` 또는 `spec/` 하위로 이동.

### P1. Guard 규칙/문서/검출 방식 불일치
- **증거**:  
  - README 언급 규칙과 실제 `GUARD_RULES` 불일치: `README.md`, `packages/core/src/guard/rules.ts`  
  - Manual edit 검출이 주석 문자열 기반: `packages/core/src/guard/check.ts`  
- **영향**: 규칙 신뢰도 저하, 우회 가능성 증가.  
- **개선**: hash 기반 검출, 문서 정합화.

### P1. Client Runtime 이중 구현
- **증거**:  
  - 런타임 로직이 `packages/core/src/client/runtime.ts`와  
    번들러 내부 `generateRuntimeSource()`에 중복: `packages/core/src/bundler/build.ts`  
- **영향**: 기능 드리프트와 유지보수 비용 증가.  
- **개선**: 하나의 런타임 소스를 빌드 파이프에서 재사용.

### P2. 스냅샷/슬롯 확장성 제한
- **증거**:  
  - 스냅샷은 `spec/slots/**/*.ts`만 수집: `packages/core/src/change/snapshot.ts`  
- **영향**: `.tsx`, `.client.ts` 등 확장 슬롯이 누락될 수 있음.  
- **개선**: 확장자 범위 확장.

### P2. 클라이언트 API의 hook 계약 미완성
- **증거**:  
  - `useIslandEvent`는 React hook 동작(등록/해제)과 불일치: `packages/core/src/client/island.ts`  
- **영향**: 리렌더 시 리스너 중복 가능.  
- **개선**: `useEffect` 기반 정식 hook으로 변경.

## 6. 모듈별 상세 평가 및 개선

### 6.1 Spec/Lock
**현재 구현**  
- Spec 검증: `packages/core/src/spec/schema.ts`  
- Load/Validate: `packages/core/src/spec/load.ts`  
- Lock: `packages/core/src/spec/lock.ts`

**세계적 관점 감상**  
- 엄격한 스키마는 계약 중심 설계에 부합.  
- 다만 page route에 `module` 필드가 필수이나 런타임에서 사용되지 않아 계약이 비효율적이다.

**개선점**  
- `module`을 page에 대해 optional 처리하거나, page loader에 실제 활용 경로 추가.  
- `loader`/`hydration`의 실제 사용 경로를 런타임에 반영.

### 6.2 Generator
**현재 구현**  
- 서버 핸들러/페이지 컴포넌트/슬롯 생성: `packages/core/src/generator/generate.ts`  
- template 함수: `packages/core/src/generator/templates.ts`

**감상**  
- routeId 기반 파일명은 안정적이고 세계적 표준에 부합.  
- 그러나 page route용 server handler는 런타임에서 사용되지 않아 생성물 일부가 “무효” 상태.

**개선점**  
- page route에 대해 server handler 생성을 비활성화하거나  
  SSR loader/slot 연결을 도입하여 module을 사용하도록 개선.  
- generated handler에서 `filling.handle(req, params, { id, pattern })`로 컨텍스트 전달.

### 6.3 Guard/Auto-correct
**현재 구현**  
- 핵심 위반 규칙과 자동 수정: `packages/core/src/guard/check.ts`, `packages/core/src/guard/auto-correct.ts`

**감상**  
- Guard를 lint보다 상위의 구조 보존 장치로 취급하는 방향은 매우 설득력 있다.  
- 다만 검출 방식이 문자열 기반이라 세계적 프레임워크 수준의 신뢰성에는 미달.

**개선점**  
- generated 파일 해시를 `generated.map.json`에 저장하여 실제 변경 검출.  
- `spec.methods`와 slot handler의 정합성 체크(예: GET만 정의된 API에 POST 핸들러 생성 금지).  
- Guard 규칙 문서화 정합성 확보.

### 6.4 Runtime/SSR
**현재 구현**  
- Router: `packages/core/src/runtime/router.ts`  
- SSR: `packages/core/src/runtime/ssr.ts`  
- Server: `packages/core/src/runtime/server.ts`

**감상**  
- SSR은 안정적이지만 최소 기능에 머물러 있으며, HTML 오류 응답이 없다.  
- 앱 엔트리(`apps/web/entry.tsx`)와의 연결 부재가 구조적 허점이다.

**개선점**  
- HTML 레벨 오류 페이지 제공.  
- `setCreateApp()` 경로를 CLI/dev에서 호출하여 레이아웃/Provider/Route 등록 지원.

### 6.5 Slot/Filling
**현재 구현**  
- Slot DSL: `packages/core/src/filling/filling.ts`  
- Context: `packages/core/src/filling/context.ts`  
- Slot 검증/교정: `packages/core/src/slot/*`

**감상**  
- 체이닝 DSL은 에이전트 친화적이며 학습 비용이 낮다.  
- 자동 수정 루프는 에이전트 기반 개발에서 매우 강한 경쟁력.

**개선점**  
- `routeContext` 타입 정합화 및 전달.  
- `slot`과 `guard`의 금지 import 리스트 일관화.

### 6.6 Error 시스템
**현재 구현**  
- Error type/codes: `packages/core/src/error/types.ts`  
- Classifier/Stack 분석: `packages/core/src/error/classifier.ts`, `packages/core/src/error/stack-analyzer.ts`

**감상**  
- 명시적 분류 체계는 세계적 수준의 “진단 가능성”을 제공한다.  
- generated map을 실제 런타임 분류에 활용하지 못하고 있음.

**개선점**  
- 런타임에서 `generated.map.json` 로드 후 ErrorClassifier에 주입.  
- `ManuduReport` 오타 개선: `packages/core/src/report/build.ts`.

### 6.7 Transaction/History
**현재 구현**  
- Snapshot/History: `packages/core/src/change/*`

**감상**  
- 스냅샷 기반 롤백은 Mandu의 핵심 혁신 중 하나로 평가 가능.  
- 다만 히스토리 파일이 버전 관리에 포함될 위험이 있다.

**개선점**  
- `.gitignore`에 `spec/history/`와 `.mandu/` 추가:  
  `packages/cli/templates/default/.gitignore`, `templates/default/.gitignore`.

### 6.8 Client/Islands & Bundler
**현재 구현**  
- Client API: `packages/core/src/client/*`  
- Bundler: `packages/core/src/bundler/*`

**감상**  
- 설계는 Astro/Islands 계열과 동급 수준의 잠재력을 가진다.  
- 그러나 SSR 삽입/정적 서빙/CLI 연결이 없어 실사용이 불가능하다.

**개선점**  
- 런타임에서 `.mandu/manifest.json`을 읽고 `<script type="module">` 삽입.  
- 번들러 출력 정적 서빙(서버/미들웨어).  
- CLI에 `build` 커맨드 추가, `dev` 시 옵션 기반 번들 빌드.

### 6.9 MCP
**현재 구현**  
- Spec/Generate/Guard/Transaction/Slot 도구 제공: `packages/mcp/src/tools/*`

**감상**  
- 에이전트 제어를 위한 관찰/조작 API는 구조적으로 뛰어나다.  
- Client/Bundle 관련 도구가 없어 설계 문서와 괴리가 있다.

**개선점**  
- `mandu_build_client`, `mandu_set_hydration` 등의 도구 추가.

### 6.10 CLI & Template
**현재 구현**  
- 명령어 체계 명확: `packages/cli/src/main.ts`

**감상**  
- Guard/Transaction 중심 CLI는 Mandu의 정체성을 강화한다.  
- 템플릿 이중화와 패키지명 불일치는 즉시 실패 가능성을 만든다.

**개선점**  
- 템플릿 단일화 및 `@mandujs/*` 일관화.  
- `mandu build` 구현 또는 스크립트 제거.

## 7. 개선 로드맵 (구체적 실행안)
### Phase 1 (P0 안정화, 1~2주)
- SSR HTML에 데이터/마커/스크립트 삽입 (`packages/core/src/runtime/ssr.ts`).  
- `.mandu/client` 정적 서빙 도입 (`packages/core/src/runtime/server.ts`).  
- `mandu build` 명령 구현 또는 템플릿 수정 (`packages/cli/src/main.ts`).  
- `routeContext` 타입 정합화 및 전달 (`packages/core/src/filling/filling.ts`, `packages/core/src/generator/templates.ts`).

### Phase 2 (P1 정합성 개선, 2~4주)
- generated.map 저장 위치를 `.mandu/`로 이동 (`packages/core/src/generator/generate.ts`).  
- Guard 규칙 해시 기반으로 강화 (`packages/core/src/guard/check.ts`).  
- `apps/web/entry.tsx` 통합 경로 구현 (`packages/cli/src/commands/dev.ts`).

### Phase 3 (P2 확장성/DX, 4주+)
- Hydration/Loader 정식 스펙 통합 (`packages/core/src/runtime/*`).  
- 스냅샷 확장자 범위 확장 (`packages/core/src/change/snapshot.ts`).  
- Client hook 정합성 개선 (`packages/core/src/client/island.ts`).

## 8. 결론
Mandu는 “에이전트가 망가뜨리지 못하는 구조”라는 독자적 가설을 실제 코드로 구현한 점에서 이미 세계적 레벨의 비전을 갖고 있다.  
그러나 현재 구현은 런타임–번들–템플릿–도구 간 연결이 끊겨 있어 설계의 우수성이 사용자 경험으로 이어지지 못하고 있다.  
핵심 연결 고리(SSR↔Hydration, CLI↔Bundler, Entry↔Runtime, Template↔패키지명)를 정리하면 Mandu는 “AI 시대의 아키텍처 보존 프레임워크”로 확실한 차별성을 확보할 수 있다.
