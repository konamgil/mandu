# 14. Mandu 최정상급 웹프레임워크 우선순위 실행 계획

작성일: 2026-04-03  
대상: Mandu v0.x -> Top-tier Web Framework  
범위: 기능, 성능, 안정성, 에이전트 경험, 유저 경험  
기준 스냅샷: 현재 `main` 기준 코드/문서/테스트/CI 상태

---

## 0. 핵심 결론

Mandu는 이미 표면 기능이 부족한 프레임워크가 아니다.  
실제 병목은 다음 3가지다.

1. **공식 경로가 여러 갈래로 분열되어 있다.**
2. **품질 게이트와 측정 체계가 top-tier 수준으로 고정되어 있지 않다.**
3. **문서, 데모, CI, 에이전트 루프가 하나의 제품 경험으로 수렴되지 않았다.**

즉, 다음 단계의 핵심은 "기능을 더 많이 추가"하는 것이 아니라 다음을 완성하는 것이다.

1. **하나의 공식 골든패스**
2. **항상 초록인 메인 브랜치**
3. **숫자로 관리되는 성능과 안정성**
4. **재현 가능한 에이전트 개발 루프**
5. **처음 접하는 사용자가 헤매지 않는 제품 경험**

---

## 1. Top-tier 정의

Top-tier 웹프레임워크는 기능 수가 많은 프레임워크가 아니다.  
아래 조건을 동시에 만족해야 한다.

| 축 | Top-tier 기준 | Mandu가 도달해야 할 상태 |
|---|---|---|
| 기능 | 실서비스에 필요한 기본기가 공식 경로로 제공됨 | 라우팅, SSR, Contract, Guard 외에 auth/db/cache가 공식 패키지로 존재 |
| 성능 | 성능 주장이 아니라 예산과 회귀 방지 체계가 있음 | SSR/hydration/bundle/HMR 성능을 수치로 고정하고 CI에서 감시 |
| 안정성 | main이 사실상 항상 배포 가능 상태 | `bun test` 100%, cross-platform CI, smoke/E2E/perf gate 구축 |
| 에이전트 경험 | AI가 써도 덜 망가지는 루프가 재현 가능 | MCP + transaction + Guard + ATE + eval 벤치 일체화 |
| 유저 경험 | 처음 쓰는 사람이 공식 경로를 한 번에 이해 | README, CLI, 템플릿, 데모, docs가 하나의 흐름으로 수렴 |

---

## 2. 현재 상태 진단

| 축 | 현재 상태 | 근거 | 의미 |
|---|---|---|---|
| 기능 | 넓음 | `core`, `cli`, `mcp`, `ate`, `devtools`, `seo`, `contract`, `guard` 존재 | 표면 기능은 충분하지만 공식 제품 경로가 분산됨 |
| 성능 | 부분 구현 | `packages/core/benchmark/hydration-benchmark.ts`, resource perf test 존재 | 벤치 스크립트는 있으나 CI 게이트와 예산이 없음 |
| 안정성 | 준수하지만 미완료 | `bun run typecheck` 전 패키지 통과, `bun test` 1481개 중 1개 실패 | "거의 안정"과 "배포 신뢰 가능"은 다름 |
| 에이전트 경험 | 강한 차별점 보유 | `@mandujs/mcp`, `Guard`, `ATE`, `Kitchen` 존재 | 강점은 분명하나 재현성/평가 체계가 약함 |
| 유저 경험 | 드리프트 존재 | 루트 README는 `3000`, CLI README와 실제 `dev/start`는 `3333` | 공식 문서 신뢰도가 흔들림 |

### 현재 스냅샷의 대표 증거

- 루트 README와 CLI README의 포트/온보딩 정보가 다르다.
  - `README.md`
  - `packages/cli/README.md`
  - `packages/cli/src/commands/dev.ts`
  - `packages/cli/src/commands/start.ts`
- CLI는 동시에 여러 워크플로를 1급으로 노출한다.
  - `packages/cli/src/main.ts`
- 현재 테스트 베이스라인은 강하지만 완전 무결하지 않다.
  - `packages/core/tests/kitchen/kitchen-handler-phase2.test.ts`
- CI는 아직 top-tier 품질 게이트가 아니다.
  - `.github/workflows/ci.yml`
- 문서에는 아직 TODO가 대량으로 남아 있다.
  - `docs/comparison/manifest-vs-resource.md`
  - `docs/guides/resource-troubleshooting.md`
  - `docs/migration/to-resources.md`
- 데모는 최신 `app/` 기반 흐름과 구식 manifest/spec 기반 흐름이 혼재한다.
  - `demo/island-first/*`
  - `demo/todo-list-mandu/*`

---

## 3. 우선순위 원칙

### 원칙 1. 골든패스를 먼저 닫고 나서 표면적을 넓힌다.

공식 온보딩 경로가 흔들리는 상태에서는 새 기능이 오히려 사용자 혼란과 문서 부채만 늘린다.

### 원칙 2. "거의 된다"를 허용하지 않는다.

테스트 1개 실패, 문서 1개 드리프트, 데모 1개 레거시는 초기에는 사소해 보여도 프레임워크 신뢰도를 결정적으로 깎는다.

### 원칙 3. Mandu의 moat는 "AI 친화적"이라는 문구가 아니라 재현성이다.

에이전트가 실제로 더 안전하게, 더 일관되게 작업한다는 증거가 필요하다.

### 원칙 4. 차별화는 기능 개수보다 방향의 선명함에서 나온다.

Next.js와 기능 체크리스트 경쟁을 하면 진다.  
Mandu는 "아키텍처 보존형, 감독자 친화형, 에이전트 안전형"이라는 정체성을 더 날카롭게 해야 한다.

---

## 4. P0 우선순위 (0~6주)

P0는 "기초 체력과 제품 일관성"이다.  
이 구간이 끝나기 전에는 새 대형 기능을 우선순위로 올리지 않는다.

### P0-1. 공식 골든패스 단일화

**주요 축:** 기능, 에이전트 경험, 유저 경험

#### 왜 먼저 해야 하는가

현재 Mandu는 FS Routes, resource-centric, contract-first, brain workflow를 동시에 전면에 노출한다.  
이 상태는 내부 실험에는 좋지만 외부 사용자에게는 "무엇이 정답인지 알 수 없는 프레임워크"로 보인다.

#### 현재 증거

- `packages/cli/src/main.ts`에 여러 워크플로가 모두 1급으로 서술되어 있다.
- README와 CLI README, 템플릿 설명이 완전히 같은 흐름을 가리키지 않는다.
- demo 앱들이 최신 공식 경로를 대표하지 못한다.

#### 실행 항목

1. 공식 경로를 아래 하나로 고정한다.
   - `init -> app/page.tsx -> contract(optional) -> slot/filling -> dev -> build -> start`
2. `resource-centric`, `contract-first`, `brain`은 "확장 플로우"로 재분류한다.
3. 루트 README, CLI README, docs/README, 템플릿 README를 단일 문구로 통일한다.
4. 포트, 기본 명령, 프로젝트 구조, 파일명 규칙을 한 소스에서 관리한다.
5. `mandu init` 직후 생성되는 템플릿이 공식 구조를 대표하도록 정리한다.

#### 산출물

- `README.md` 정리
- `packages/cli/README.md` 정리
- `docs/README.md` 정리
- `docs/guides/00_quickstart.md` 신규 또는 대체
- 템플릿 설명 정리

#### 완료 기준

- 문서 어디를 보더라도 최초 온보딩 경로가 동일하다.
- `mandu init` 후 10분 내로 첫 페이지와 첫 API를 만들 수 있다.
- "공식 경로"와 "실험 경로"가 문서에서 명확히 구분된다.

#### 지표

- 신규 사용자 온보딩 시간: 10분 이하
- README/CLI README/Quickstart 간 명령/포트/경로 불일치: 0건
- `mandu init` 후 first render 성공률: 100%

---

### P0-2. 메인 브랜치 항상 Green

**주요 축:** 안정성

#### 왜 먼저 해야 하는가

프레임워크는 애플리케이션보다 신뢰 비용이 크다.  
메인 브랜치가 한 번이라도 불안정하면 사용자는 "이 프레임워크를 내 프로젝트 기반으로 삼아도 되나"를 의심한다.

#### 현재 증거

- `bun run typecheck`는 통과한다.
- `bun test`는 1481개 중 1개가 타임아웃으로 실패했다.
- CI는 typecheck + 단일 test job 수준이다.

#### 실행 항목

1. 현재 red test를 우선 제거한다.
   - `packages/core/tests/kitchen/kitchen-handler-phase2.test.ts`
2. flaky test를 분류하고 원인을 제거한다.
3. CI 매트릭스를 추가한다.
   - OS: Windows, macOS, Linux
   - Bun: 최소지원 버전, 최신 안정 버전
4. `init -> dev -> build -> start` smoke test를 기준 앱에 대해 추가한다.
5. `bun test`를 패키지별/영역별로 쪼개어 실패 지점을 더 빨리 식별한다.

#### 산출물

- `.github/workflows/ci.yml` 강화
- 테스트 분류 문서
- smoke test 스크립트

#### 완료 기준

- `main`에서 red test 0
- PR마다 cross-platform typecheck/test/smoke 통과
- flaky 재현율이 아니라 flaky 자체를 제거한 상태

#### 지표

- `bun test` pass rate: 100%
- flaky rerun 비율: 0%
- CI 평균 실패 원인 중 환경 차이 비중: 0%

---

### P0-3. Kitchen/Devtools 안정화

**주요 축:** 안정성, 에이전트 경험

#### 왜 먼저 해야 하는가

Kitchen은 Mandu가 "감독자 친화형 Agent-Native Framework"임을 보여주는 핵심 기능이다.  
이 축이 흔들리면 Mandu의 차별점이 도구가 아니라 실험 기능처럼 보인다.

#### 현재 증거

- 현재 유일 실패 테스트가 Kitchen diff 요청이다.
- server test에는 핸들러 부재 시 `404` 대신 `500`이 섞여도 허용하는 TODO가 남아 있다.
  - `packages/core/tests/server/server-core.test.ts`

#### 실행 항목

1. Kitchen diff API timeout 원인을 제거한다.
2. file/diff/guard/activity 관련 API를 안정화하고 timeout budget을 명시한다.
3. handler 부재, static file 부재, invalid path 상황에서 상태 코드 정책을 고정한다.
4. Kitchen SSE/preview/diff 흐름을 회귀 테스트로 묶는다.
5. `mandu dev`에서 Kitchen이 "옵션"이 아니라 "감독용 대시보드"라는 서사를 문서화한다.

#### 산출물

- Kitchen 안정화 패치
- Kitchen 회귀 테스트 세트
- 상태 코드 정책 문서

#### 완료 기준

- Kitchen 관련 test suite 100% 통과
- diff/preview/guard-feed가 로컬 개발에서 안정적으로 재현
- 에이전트 작업 검토 흐름이 문서와 UI에서 일관됨

#### 지표

- Kitchen 관련 테스트 실패율: 0%
- diff API p95 응답시간: 300ms 이하
- SSE disconnect/reconnect 실패율: 0%

---

### P0-4. 성능 예산과 회귀 방지 체계 도입

**주요 축:** 성능

#### 왜 먼저 해야 하는가

성능은 "빠르다"는 인상이 아니라 예산이 있어야 프레임워크 자산이 된다.  
지금은 벤치 스크립트는 있으나 top-tier 수준의 기준선과 회귀 감시가 없다.

#### 현재 증거

- hydration benchmark 스크립트는 있다.
  - `packages/core/benchmark/hydration-benchmark.ts`
- resource generation 성능 테스트는 있다.
  - `packages/core/src/resource/__tests__/performance.test.ts`
- 하지만 `tests/perf/*`와 CI blocking budget은 없다.

#### 실행 항목

1. 다음 지표를 공식 성능 예산으로 선언한다.
   - SSR p95
   - TTFB p95
   - hydration p95
   - initial JS bundle size
   - HMR latency
   - route scan/generate time
2. 기준 앱 3개에 대한 perf harness를 만든다.
3. 로컬 benchmark와 CI budget을 분리한다.
4. PR이 예산을 넘으면 경고 또는 차단되도록 설정한다.
5. README와 docs에 "현재 성능 기준"을 투명하게 공개한다.

#### 산출물

- `tests/perf/*`
- `tests/perf/perf-baseline.json`
- perf CI workflow
- 성능 대시보드 또는 markdown 리포트

#### 완료 기준

- 대표 시나리오의 baseline이 수치로 저장된다.
- 새로운 PR이 성능 회귀를 만들면 자동으로 탐지된다.
- 성능 수치는 문서에서 주장과 일치한다.

#### 지표

- 로컬 SSR latency p95: 기준 앱별 수치 고정
- hydration p95: 기준 앱별 수치 고정
- bundle size budget 초과 PR: 자동 검출 100%

---

### P0-5. 문서와 데모 수렴

**주요 축:** 유저 경험, 기능

#### 왜 먼저 해야 하는가

프레임워크의 문서와 예제는 부가 자료가 아니라 제품 본체다.  
문서 TODO와 데모 드리프트가 쌓이면 프레임워크는 "현재형"이 아니라 "계획형"으로 인식된다.

#### 현재 증거

- `docs/comparison/manifest-vs-resource.md`에 TODO가 대량으로 남아 있다.
- `docs/guides/resource-troubleshooting.md`, `docs/migration/to-resources.md`도 미완성이다.
- demo는 최신 `app/` 흐름과 과거 `spec/routes.manifest.json` 흐름이 섞여 있다.

#### 실행 항목

1. 공식 문서 집합과 실험 문서 집합을 분리한다.
2. TODO가 많은 문서는 숨기거나 완료 전까지 "draft" 표시를 붙인다.
3. 레거시 demo는 `legacy/`로 이동하거나 deprecated 표시를 한다.
4. 공식 기준 demo 3개만 전면에 노출한다.
5. README, docs, demo가 동일한 구조와 명령을 사용하게 맞춘다.

#### 산출물

- 문서 재분류
- 기준 demo 선정
- deprecated demo 정리

#### 완료 기준

- 공식 진입점에서 draft/legacy 문서가 노출되지 않는다.
- 모든 기준 demo가 최신 골든패스를 사용한다.
- 주요 문서의 TODO 주석 수가 실질적으로 0에 수렴한다.

#### 지표

- 공식 문서 영역의 TODO 수: 0
- 기준 demo 성공 실행률: 100%
- docs와 실제 CLI 동작 불일치 제보: 0건

---

## 5. P1 우선순위 (6~12주)

P1은 "실서비스 기본기와 제품화"다.  
P0 없이 P1로 가면 기능은 늘지만 신뢰도는 늘지 않는다.

### P1-1. 공식 서버 기본기 패키지 출시

**주요 축:** 기능, 유저 경험

#### 왜 필요한가

라우팅과 SSR만으로는 실서비스 프레임워크가 되지 않는다.  
사용자는 최소한 auth, db, cache에 대해 "Mandu의 공식 답"을 기대한다.

#### 현재 상태

현재 스캔 기준으로 전용 `auth`, `cache`, `adapter`, `ws`, `i18n` 패키지는 사실상 없다.  
`packages/core/src/filling/auth.ts` 수준의 헬퍼는 있지만 제품 패키지라고 보기 어렵다.

#### 실행 항목

1. `@mandujs/auth`
   - JWT/session 기본 흐름
   - route guard integration
   - sample login/logout/protected route
2. `@mandujs/db-*`
   - 최소 1개 공식 ORM/DB 조합 확정
   - migration, config, sample CRUD 제공
3. `@mandujs/cache-*`
   - memory cache + distributed cache adapter 기준선
4. 템플릿과 demo에서 이 패키지들을 실제 사용한다.

#### 산출물

- 새 패키지들
- 공식 가이드
- 기준 앱 통합 예제

#### 완료 기준

- "인증/DB/캐시를 Mandu에서 어떻게 하나요?"에 공식 링크 하나로 답할 수 있다.
- demo와 docs가 실제 패키지를 사용한다.

#### 지표

- auth/db/cache 공식 가이드 수: 3개 이상
- 기준 앱 적용률: 100%

---

### P1-2. Reference Apps를 릴리스 계약으로 승격

**주요 축:** 안정성, 성능, 유저 경험

#### 왜 필요한가

예제는 보여주기용이 아니라 "프레임워크가 실제로 유지 가능한가"를 검증하는 계약이어야 한다.

#### 실행 항목

1. 아래 3개를 공식 reference app으로 지정한다.
   - `hello-ssr`
   - `blog-crud-contract`
   - `dashboard-auth-island` 또는 `realtime-chat`
2. 각 앱에 대해 다음을 구축한다.
   - smoke
   - integration
   - e2e
   - perf
   - ATE subset
3. 릴리스 전 이 앱들이 전부 통과해야 publish 가능하도록 만든다.

#### 산출물

- `demo/*` 재정리
- `tests/e2e/*`
- `tests/perf/*`
- release gate 문서

#### 완료 기준

- 기준 앱이 곧 Mandu 공식 능력의 계약이 된다.
- 새 기능은 기준 앱 중 하나 이상에서 실제로 검증된다.

#### 지표

- reference app release gate 통과율: 100%
- 기준 앱별 E2E pass rate: 100%

---

### P1-3. Agent Eval과 MCP 강화

**주요 축:** 에이전트 경험, 안정성

#### 왜 필요한가

Mandu의 차별점은 에이전트 친화성이 아니라 "에이전트가 망가뜨리기 어렵다"는 점이다.  
이 강점은 평가 벤치 없이는 외부에 증명되지 않는다.

#### 실행 항목

1. MCP mutation tool은 기본적으로 transaction 경로를 타게 한다.
2. Guard 실패 시 patch-ready 출력 형식을 표준화한다.
3. ATE를 agent loop의 기본 검증 도구로 연결한다.
4. task benchmark를 만든다.
   - route 추가
   - contract 생성
   - slot 수정
   - architecture violation 수정
   - hydration 설정 변경
5. "일반 coding agent vs Mandu MCP agent" 비교 벤치를 만든다.

#### 산출물

- agent eval 벤치
- MCP hardening 문서
- mutation safety policy

#### 완료 기준

- 같은 작업에서 Mandu agent loop의 성공률/복구율이 더 높다는 근거가 있다.
- MCP 도구는 실패 시 복구 가능한 경로를 기본 제공한다.

#### 지표

- benchmark task 성공률
- rollback 후 작업 복구 성공률
- architecture violation 자동 수정률

---

### P1-4. 플러그인 시스템 제품화

**주요 축:** 기능, 유저 경험

#### 왜 필요한가

플러그인 API만 있으면 내부 확장점일 뿐이다.  
생태계가 되려면 카탈로그, 호환성, 샘플, 정책이 있어야 한다.

#### 실행 항목

1. 플러그인 버전/호환성 정책 정의
2. 공식 샘플 플러그인 제공
   - guard preset plugin
   - build analyzer plugin
   - logger transport plugin
3. 플러그인 개발 가이드 작성
4. 호환성 테스트 전략 수립

#### 산출물

- plugin author guide
- sample plugins
- compatibility policy

#### 완료 기준

- 외부 개발자가 공식 가이드만으로 플러그인을 만들 수 있다.
- 플러그인 변경이 core breaking change를 유발할 때 탐지 가능하다.

#### 지표

- 공식 샘플 플러그인 수
- plugin compatibility test coverage

---

## 6. P2 우선순위 (3~6개월)

P2는 "정체성 고도화"다.  
이 시점부터는 Mandu가 어떤 부류의 최고가 될지를 좁혀야 한다.

### P2-1. 전략 축 하나 선택

**후보**

1. Agent-supervised development OS
2. Architecture-safe enterprise backend framework
3. Realtime-first fullstack platform

#### 원칙

- 세 축을 동시에 밀면 브랜드가 흐려진다.
- 하나를 대표 축으로 삼고 나머지는 보조 축으로 둔다.

#### 완료 기준

- 홈페이지 첫 문장
- README 첫 문단
- demo 대표 사례
- reference app 구성
- 향후 패키지 우선순위

위 5개가 모두 같은 메시지를 가리킨다.

---

### P2-2. 실시간/분산 스토리 정식화

**주요 축:** 기능, 성능

#### 설명

WebSocket, distributed rooms, resumable/realtime 계열은 충분히 가치가 있지만 P0/P1 이전의 핵심 우선순위가 아니다.  
이 영역은 전략 축을 정한 뒤 제품화해야 한다.

#### 조건

- auth/session/caching의 공식 경로가 먼저 안정화되어 있어야 한다.
- 로컬 모드와 분산 모드의 운영 모델을 문서와 코드에서 구분해야 한다.

---

## 7. 지금 당장 하지 않을 것

아래 항목은 가치가 있어도 현재 최우선은 아니다.

1. 새 대형 렌더링 기능 추가
2. WebSocket/분산 모드 제품화
3. i18n, asset pipeline, image optimizer 같은 부가 기능 확장
4. 실험적 워크플로를 공식 진입점으로 승격
5. 문서/테스트/데모 정리 없이 표면 API만 확장

---

## 8. 90일 실행 순서

| 기간 | 목표 | 핵심 작업 |
|---|---|---|
| 0~2주 | 신뢰도 복구 | red test 제거, CI 강화, 포트/문서 불일치 제거 |
| 2~4주 | 골든패스 정렬 | README/CLI/docs/templates/demo 수렴, 기준 앱 선정 |
| 4~6주 | 측정 체계 도입 | perf baseline, smoke/E2E/release gate 구축 |
| 6~8주 | 제품 기본기 시작 | auth/db/cache 공식 설계 및 첫 패키지 구현 |
| 8~12주 | 차별점 계량화 | agent eval, MCP hardening, reference apps 계약화 |

---

## 9. 첫 실행 체크리스트

### 즉시 착수할 항목

1. `bun test`의 유일 실패 테스트 원인 제거
2. README/CLI README/실제 포트 및 명령 불일치 제거
3. `docs/comparison/manifest-vs-resource.md` 등 draft 문서 처리 방침 결정
4. 기준 demo 3개 선정
5. CI에 smoke test와 OS/Bun matrix 추가
6. `tests/perf/perf-baseline.json` 초안 작성

### 첫 번째 리뷰 시점에 확인할 질문

1. 현재 외부 사용자에게 보여줄 "유일한 공식 경로"가 한 문장으로 설명되는가?
2. Mandu의 핵심 차별점이 문서가 아니라 테스트/벤치로 증명되는가?
3. 다음 3개월 동안 늘릴 기능이 아니라 줄일 복잡성이 무엇인지 합의되었는가?

---

## 10. 최종 판단 기준

이 계획의 성공 여부는 기능 수가 아니라 아래 질문에 대한 답으로 판단한다.

1. 처음 쓰는 사용자가 10분 안에 성공할 수 있는가?
2. 에이전트가 작업해도 구조 보존이 실제로 더 잘 되는가?
3. 성능과 안정성이 숫자로 관리되는가?
4. demo, docs, templates, CI가 같은 제품을 설명하는가?
5. Mandu가 무엇의 최고가 되려는지 한 문장으로 말할 수 있는가?

이 5개에 모두 "예"라고 답할 수 있을 때 Mandu는 비로소 top-tier 진입선에 선다.

---

## 11. P0 세부 백로그

이 섹션은 바로 이슈로 분해 가능한 수준의 실행 백로그다.  
P0는 가능한 한 작은 PR로 쪼개서 순차 반영한다.

### P0-1. 공식 골든패스 단일화

| ID | 작업 | 선행조건 | 예상 터치 영역 | 완료 기준 |
|---|---|---|---|---|
| P0-1-1 | 공식 골든패스 문장을 한 줄로 확정 | 없음 | `README.md`, `docs/README.md`, `packages/cli/README.md` | 세 문서 첫 온보딩 흐름이 동일 문장 사용 |
| P0-1-2 | CLI help에서 공식/실험 워크플로를 분리 | P0-1-1 | `packages/cli/src/main.ts` | help 출력에서 공식 경로 1개, 확장 경로 N개로 구분 |
| P0-1-3 | 포트/명령/예제 URL을 전부 통일 | P0-1-1 | `README.md`, `packages/cli/README.md`, 템플릿 README | `3000`/`3333` 불일치 0건 |
| P0-1-4 | 기본 프로젝트 구조를 canonical tree로 고정 | P0-1-1 | 루트 README, CLI README, 템플릿 문서 | 프로젝트 구조 표기가 전부 동일 |
| P0-1-5 | `mandu init` 직후 경험을 canonical template 기준으로 정리 | P0-1-2 | `packages/cli/templates/default/*` | init 후 첫 페이지/첫 API 작성 흐름이 문서와 일치 |
| P0-1-6 | `resource-centric`, `brain`, `contract-first`를 addon flow로 강등 | P0-1-2 | CLI help, docs guides | 공식 첫 진입점에 실험 플로우가 섞이지 않음 |
| P0-1-7 | Quickstart 신규 작성 또는 기존 문서 대체 | P0-1-3 | `docs/guides/00_quickstart.md` | 10분 온보딩 문서 1개로 연결 가능 |

#### P0-1 추가 메모

- 이 작업은 "새 구조 설계"가 아니라 "현재 이미 존재하는 정답을 하나로 선언"하는 작업이다.
- default template가 공식 표준이 될 가능성이 높다.
- 공식 문구가 정해지기 전까지는 새로운 소개 문서를 늘리지 않는다.

### P0-2. 메인 브랜치 항상 Green

| ID | 작업 | 선행조건 | 예상 터치 영역 | 완료 기준 |
|---|---|---|---|---|
| P0-2-1 | 현재 red test 원인 분석 및 수정 | 없음 | `packages/core/tests/kitchen/*`, 관련 구현부 | `bun test` 전체 green |
| P0-2-2 | flaky test 목록화 | P0-2-1 | `docs/qa/*` 또는 `docs/plans/*` | flaky 후보와 원인 가설 문서화 |
| P0-2-3 | 테스트 실행을 영역별 스크립트로 분할 | P0-2-1 | 루트 `package.json`, 스크립트 파일 | core/cli/mcp/ate/smoke/perf를 분리 실행 가능 |
| P0-2-4 | CI 매트릭스 추가 | P0-2-3 | `.github/workflows/ci.yml` | OS/Bun matrix에서 typecheck/test/smoke 수행 |
| P0-2-5 | smoke app 정의 및 자동 실행 | P0-2-3 | `demo/*`, CI workflow, 테스트 스크립트 | `init -> dev -> build -> start` 자동 검증 |
| P0-2-6 | nightly full suite 또는 extended suite 추가 | P0-2-4 | CI workflow | PR에는 핵심 검증, nightly에는 전체 검증 가능 |
| P0-2-7 | 테스트 실패 분류 규칙 고정 | P0-2-2 | QA 문서 | flaky, infra, regression, assertion failure 구분 |

#### P0-2 추가 메모

- "green"은 rerun으로 초록이 되는 상태가 아니라 첫 실행 기준으로 초록이어야 한다.
- PR 차단 게이트와 nightly 확장 게이트를 구분하면 속도와 신뢰도를 같이 잡을 수 있다.

### P0-3. Kitchen/Devtools 안정화

| ID | 작업 | 선행조건 | 예상 터치 영역 | 완료 기준 |
|---|---|---|---|---|
| P0-3-1 | diff API timeout 재현 케이스 최소화 | 없음 | `packages/core/tests/kitchen/*` | 실패 시나리오가 로컬에서 안정 재현 |
| P0-3-2 | diff API 구현 병목 수정 | P0-3-1 | `packages/core/src/kitchen/api/*`, `stream/*` | timeout 제거 |
| P0-3-3 | file/diff/guard/activity 응답 스키마 고정 | P0-3-2 | Kitchen API 구현, 테스트 | 응답 포맷이 테스트와 문서에 고정 |
| P0-3-4 | handler 없음 / path invalid / file 없음 상태코드 정책 고정 | P0-3-2 | `packages/core/src/runtime/server.ts`, server tests | 404/400/403/500 경계가 일관적 |
| P0-3-5 | Kitchen 회귀 테스트 번들 구축 | P0-3-3 | `packages/core/tests/kitchen/*` | diff/preview/activity/feed 회귀 보장 |
| P0-3-6 | `mandu dev`와 Kitchen 서사 통일 | P0-1-1 | CLI README, docs, kitchen docs | Kitchen이 감독자 대시보드로 설명됨 |

#### P0-3 추가 메모

- Kitchen은 단순 devtools가 아니라 Mandu의 핵심 제품 차별점이다.
- 이 영역은 test-first로 밀어야 한다.

### P0-4. 성능 예산 도입

| ID | 작업 | 선행조건 | 예상 터치 영역 | 완료 기준 |
|---|---|---|---|---|
| P0-4-1 | 공식 성능 지표 목록 확정 | 없음 | 계획 문서, perf baseline 초안 | 추적 지표가 6개 내외로 고정 |
| P0-4-2 | 기준 앱별 측정 시나리오 정의 | P0-4-1 | `tests/perf/*`, demo docs | 앱마다 측정 URL과 액션이 명시됨 |
| P0-4-3 | perf baseline JSON 구조 설계 | P0-4-1 | `tests/perf/perf-baseline.json` | 저장 형식 고정 |
| P0-4-4 | 로컬 벤치 스크립트 작성 | P0-4-2 | `tests/perf/*`, benchmark 스크립트 | 개발자가 baseline 갱신 가능 |
| P0-4-5 | PR 예산 체크 도입 | P0-4-3 | CI workflow | 예산 초과 시 경고 또는 실패 |
| P0-4-6 | 성능 결과 리포트 출력 형식 통일 | P0-4-4 | perf scripts, docs | markdown/json 리포트 일관화 |
| P0-4-7 | 초기 baseline 채집 및 freeze | P0-4-5 | baseline 파일 | 첫 기준선이 merge됨 |

#### P0-4 추가 메모

- baseline은 완벽할 필요가 없다. 먼저 "존재"해야 한다.
- 첫 단계에서는 hard fail보다 soft warning으로 시작해도 된다.

### P0-5. 문서와 데모 수렴

| ID | 작업 | 선행조건 | 예상 터치 영역 | 완료 기준 |
|---|---|---|---|---|
| P0-5-1 | 공식 문서 / draft / legacy 분류 규칙 정의 | 없음 | `docs/README.md`, 문서 index | 문서 상태가 명시됨 |
| P0-5-2 | TODO 다량 문서에 draft 표기 추가 | P0-5-1 | `docs/comparison/*`, `docs/guides/*`, `docs/migration/*` | draft 문서가 공식 입구에 노출되지 않음 |
| P0-5-3 | demo 목록을 공식/실험/레거시로 분류 | P0-5-1 | `demo/*`, docs | 각 demo의 상태가 문서화됨 |
| P0-5-4 | reference app 후보 3개 확정 | P0-5-3 | `demo/*`, 계획 문서 | 기준 앱 3개가 고정됨 |
| P0-5-5 | 레거시 demo deprecate 또는 이동 | P0-5-4 | `demo/island-first/*` 등 | 공식 경로에서 레거시 노출 최소화 |
| P0-5-6 | README와 demo 명령 일치화 | P0-1-3 | README, demo별 README | 복붙 가능한 명령이 실제 동작 |
| P0-5-7 | docs entrypoint에서 공식 문서만 우선 노출 | P0-5-2 | `docs/README.md` | 초심자가 draft/legacy를 먼저 보지 않음 |

#### P0 묶음 순서

1. P0-2-1
2. P0-1-1
3. P0-1-2 ~ P0-1-4
4. P0-5-1 ~ P0-5-3
5. P0-2-3 ~ P0-2-5
6. P0-3-1 ~ P0-3-5
7. P0-4-1 ~ P0-4-4
8. P0-1-5 ~ P0-1-7
9. P0-5-4 ~ P0-5-7
10. P0-4-5 ~ P0-4-7

---

## 12. P1 세부 백로그

### P1-1. 공식 서버 기본기 패키지

| ID | 작업 | 선행조건 | 예상 터치 영역 | 완료 기준 |
|---|---|---|---|---|
| P1-1-1 | 공식 auth 범위 확정: JWT vs session vs 둘 다 | P0 완료 | 새 패키지 설계 문서 | auth MVP 범위가 고정됨 |
| P1-1-2 | `@mandujs/auth` 패키지 scaffold | P1-1-1 | `packages/auth` 또는 동등 구조 | 패키지 초기 구조 생성 |
| P1-1-3 | route guard와 auth helper 통합 | P1-1-2 | core/auth package | protected route 예제 동작 |
| P1-1-4 | login/logout/protected demo 구현 | P1-1-3 | reference app | demo에서 실제 사용 |
| P1-1-5 | 공식 DB 조합 1개 선택 | P0 완료 | docs/product/plans | ORM/DB 선택이 고정됨 |
| P1-1-6 | `@mandujs/db-*` 패키지 또는 guide MVP | P1-1-5 | 새 패키지/guide/demo | CRUD path 공식화 |
| P1-1-7 | cache 전략 정의: memory + distributed | P0 완료 | 설계 문서 | cache scope 고정 |
| P1-1-8 | `@mandujs/cache-*` MVP | P1-1-7 | 새 패키지 | memory/distributed 기본 경로 제공 |

### P1-2. Reference Apps 계약화

| ID | 작업 | 선행조건 | 예상 터치 영역 | 완료 기준 |
|---|---|---|---|---|
| P1-2-1 | 공식 reference app 3개 최종 선정 | P0-5-4 | `demo/*`, docs | 기준 앱 고정 |
| P1-2-2 | 앱별 smoke 시나리오 작성 | P1-2-1 | `tests/smoke/*` | 모든 앱 smoke 보유 |
| P1-2-3 | 앱별 E2E 작성 | P1-2-1 | `tests/e2e/*` | 핵심 흐름 커버 |
| P1-2-4 | 앱별 perf 시나리오 작성 | P0-4 완료 | `tests/perf/*` | perf budget 연결 |
| P1-2-5 | 앱별 ATE subset 구성 | P1-2-1 | `tests/e2e/auto/*`, scripts | 변경 영향 기반 테스트 가능 |
| P1-2-6 | publish gate에 reference apps 반영 | P1-2-2 ~ P1-2-5 | publish workflow | 기준 앱 미통과 시 publish 금지 |

### P1-3. Agent Eval과 MCP 강화

| ID | 작업 | 선행조건 | 예상 터치 영역 | 완료 기준 |
|---|---|---|---|---|
| P1-3-1 | mutating MCP tool 목록 정리 | P0 완료 | MCP docs/code | 위험 도구 목록 확정 |
| P1-3-2 | transaction default 정책 설계 | P1-3-1 | MCP/core docs | mutation safety 규칙 고정 |
| P1-3-3 | Guard 실패 patch-ready 출력 형식 정의 | P1-3-2 | guard/mcp | machine-readable proposal 가능 |
| P1-3-4 | ATE를 agent loop 검증 단계로 연결 | P1-3-2 | MCP/ATE/docs | mutation 후 자동 검증 가능 |
| P1-3-5 | benchmark task set 설계 | P1-3-2 | eval docs/scripts | 대표 작업 5~10개 고정 |
| P1-3-6 | baseline agent vs Mandu agent 비교 실행 | P1-3-5 | eval results | 성공률/복구율 수치 확보 |

### P1-4. 플러그인 시스템 제품화

| ID | 작업 | 선행조건 | 예상 터치 영역 | 완료 기준 |
|---|---|---|---|---|
| P1-4-1 | plugin compatibility policy 정의 | P0 완료 | docs/release, plugin docs | breaking 범위 명확화 |
| P1-4-2 | sample plugin 3종 제작 | P1-4-1 | sample plugin dirs | 공식 샘플 제공 |
| P1-4-3 | plugin author guide 작성 | P1-4-2 | docs/guides/plugins | 외부 작성 가능 |
| P1-4-4 | plugin compatibility test 도입 | P1-4-1 | tests/plugins | core 변경 영향 탐지 |

---

## 13. P2 세부 백로그

### P2-1. 전략 축 결정 작업

| ID | 작업 | 선행조건 | 완료 기준 |
|---|---|---|---|
| P2-1-1 | 후보 3축 비교 문서 작성 | P1 주요 항목 완료 | 장단점과 시장 포지션이 문서화됨 |
| P2-1-2 | 대표 축 선택 | P2-1-1 | 하나의 문장으로 제품 정의 가능 |
| P2-1-3 | 홈페이지/README/demo/reference app 재정렬 | P2-1-2 | 모든 외부 표면이 같은 메시지 사용 |

### P2-2. 실시간/분산 정식화

| ID | 작업 | 선행조건 | 완료 기준 |
|---|---|---|---|
| P2-2-1 | 로컬 모드와 분산 모드 모델 정의 | P1-1 auth/cache 선행 | 운영 모델이 문서화됨 |
| P2-2-2 | realtime package 범위 고정 | P2-2-1 | websocket/rooms/auth/session 경계 명확화 |
| P2-2-3 | 분산 adapter 전략 정의 | P2-2-2 | pubsub/session/cache 의존성이 명확화됨 |

---

## 14. 이슈 분해 규칙

이 계획을 실제 GitHub 이슈로 옮길 때는 아래 규칙을 따른다.

### 이슈 크기 규칙

1. 한 이슈는 가능하면 **1~3일 내 완료** 가능한 크기로 쪼갠다.
2. 문서+코드+테스트를 한 이슈에 다 넣지 말고, 리뷰 가능한 단위로 나눈다.
3. "리팩토링" 같은 추상 제목을 쓰지 않는다.

### 권장 이슈 제목 형식

- `P0-1-3 README와 CLI README의 기본 포트/URL을 3333으로 통일`
- `P0-2-4 CI에 Windows/macOS/Linux Bun matrix 추가`
- `P0-3-4 handler 부재 시 404/500 정책 고정`
- `P1-3-5 Agent eval benchmark task set 정의`

### 권장 라벨

- `priority:p0`
- `priority:p1`
- `priority:p2`
- `area:dx`
- `area:docs`
- `area:perf`
- `area:stability`
- `area:mcp`
- `area:kitchen`
- `area:demo`

### 권장 마일스톤

- `P0 Foundation`
- `P1 Productization`
- `P2 Positioning`

---

## 15. 바로 이슈로 만들 첫 10개

1. `P0-2-1 Kitchen diff timeout 실패 테스트 수정`
2. `P0-1-1 공식 골든패스 문구 확정`
3. `P0-1-2 CLI help에서 공식/실험 워크플로 분리`
4. `P0-1-3 README와 CLI README 포트/명령 통일`
5. `P0-5-1 docs를 official/draft/legacy로 분류`
6. `P0-5-3 demo를 official/experimental/legacy로 분류`
7. `P0-2-3 테스트 스크립트를 영역별로 분할`
8. `P0-2-4 CI에 OS/Bun matrix 추가`
9. `P0-3-4 runtime 상태 코드 정책 고정`
10. `P0-4-1 성능 baseline 지표 목록 확정`
