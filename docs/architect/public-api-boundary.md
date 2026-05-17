# Public API Boundary

작성일: 2026-05-18

목적: `@mandujs/core`의 root export와 package subpath export를 stable, experimental, internal로 분류하고, v1 이전 public API drift를 줄이기 위한 리뷰 기준을 고정한다.

## 정책

| 등급 | 의미 | 변경 규칙 |
|---|---|---|
| stable | 사용자 앱과 공식 문서가 직접 import해도 되는 API | patch/minor에서 제거 금지. breaking change는 migration note와 major version 필요 |
| experimental | 공개되어 있지만 v0.x에서 모양이 바뀔 수 있는 API | 문서에 experimental 표시 필요. 변경 시 release note 필요 |
| internal | 프레임워크/CLI/MCP/테스트 내부 연결용 API | root export에서 직접 노출하지 않는 것이 목표. 필요한 경우 명시 subpath 또는 `internal` 네임스페이스로 격리 |

## Root Export Review

현재 `packages/core/src/index.ts`는 `export *`를 통해 넓은 surface를 제공한다. v0.x 호환성을 위해 즉시 제거하지 않지만, 아래처럼 분류한다.

### Stable Root Surface

| API | 근거 |
|---|---|
| `Mandu` namespace | 사용자-facing 통합 API |
| `filling`, `contract`, `client`, `island`, `intent` 계열 | 공식 앱 작성 경로 |
| `config`, `router`, `runtime`의 문서화된 entry | 앱 실행과 adapter integration |
| `middleware`, `auth`, `session`, `csrf`, `secure`, `rate-limit` subpaths | 앱 요청 파이프라인 |
| `resource`, `db`, `content`, `i18n`, `seo`, `openapi` subpaths | 사용자-facing feature modules |
| `testing` subpaths | 공식 테스트 헬퍼 |
| `observability`, `perf`의 문서화된 API | 운영/성능 계측 API |
| `Image` component | public UI component |

### Experimental Surface

| API | 이유 |
|---|---|
| `brain`, `intent`, AI-native generation APIs | agent-native API shape가 아직 빠르게 변할 수 있음 |
| `devtools`, `kitchen` | 개발 도구 UI/프로토콜이 v1 전까지 변동 가능 |
| `desktop`, `design`, `deploy` subpaths | target/provider별 안정성 차이가 큼 |
| `scheduler` | runtime lifecycle와 adapter 경계가 아직 분리 중 |
| `a11y` | optional peer dependency 기반으로 target별 경계 강화 중 |

### Internal Candidates

| API | 현재 상태 | 목표 |
|---|---|---|
| `bundler/*` | 명시 subpath로 공개되어 있음 | stable build hooks와 internal bundler helper 분리 |
| `runtime/server`, `runtime/cache`, `runtime/router` | adapter와 테스트가 직접 사용 | stable adapter API와 internal runtime helper 분리 |
| `guard/tsgolint-bridge`, low-level guard helpers | tooling integration용 | public rule authoring API와 bridge internal 분리 |
| `resource/ddl/*`, `resource/generator-repo` | generator/DDL 내부 세부 구현 | documented migration/resource authoring API 중심으로 축소 |
| `plugins/runner` | plugin lifecycle 내부 실행기 | plugin authoring API와 runner internal 분리 |
| `dev-error-overlay` | dev runtime implementation | devtools adapter 내부로 이동 |

## Release Review Rules

- root export에 새 `export *`를 추가하면 public API review가 필요하다.
- `packages/core/package.json`의 `exports`에 새 subpath를 추가하면 stable/experimental/internal 등급을 정해야 한다.
- stable API 제거, 이름 변경, 시그니처 변경은 migration note 없이는 금지한다.
- experimental API 변경은 release note에 이유와 대체 경로를 적는다.
- internal candidate를 계속 노출해야 한다면 docs에 사용자-facing 근거를 추가한다.

## 다음 작업

- `scripts/check-public-api-boundary.ts`가 `@mandujs/core` export map의 stable/experimental/internal 분류 누락을 release gate에서 검증한다.
- root export에서 internal candidate를 즉시 제거하지 말고, v0.x deprecation window를 둔다.
- `@mandujs/core/internal/*` 또는 package-private 경로 정책을 별도 RFC로 결정한다.
- API snapshot 테스트를 추가해 root export symbol drift까지 추적한다.
