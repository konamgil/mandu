# Mandu DNA 통합/업그레이드 마스터 기획서 (코드 직접 분석 기반)

> **문서 ID**: MANDU-DNA-MASTERPLAN
> **버전**: 1.1
> **작성일**: 2026-01-28
> **대상**: mandu 코어/플랫폼 팀
> **참조**: `DNA/DNA_ADOPTION_PLAN.md`, `docs/product/01_mandu_product_brief.md`, `docs/architecture/02_mandu_technical_architecture.md`, `docs/plans/08_ont-run_adoption_plan.md`

---

## 1. 배경과 목적

Mandu는 **Agent-Native Fullstack Framework**로서, AI 에이전트가 코드를 작성해도 구조가 무너지지 않는 아키텍처 보존을 핵심 가치로 한다. DNA 폴더에 보관된 성숙한 프레임워크(astro, bun, elysia, fastapi, fresh, hono, next.js, phoenix, qwik)의 **장점과 검증된 코드/패턴**을 조화롭게 흡수해, Mandu를 차세대 풀스택 프레임워크로 강화한다.

### 목적
- Mandu의 **런타임 안정성, 타입 안전성, 하이드레이션, 빌드 파이프라인**을 단기간에 고도화
- 에이전트 개발에 최적화된 **예측 가능한 아키텍처** 제공
- 성능(SSR/CSR), 생산성(DX), 유지보수성(테스트/문서/규약)의 균형 확보

---

## 2. 범위 정의

### In-Scope
- DNA 폴더 내 프레임워크의 패턴/모듈/코드 일부를 **Mandu 코어에 통합**
- Mandu의 **핵심 요청 파이프라인**(라우팅/미들웨어/라이프사이클) 개선
- **Contract 기반 타입 추론 + OpenAPI** 자동 생성 체계 강화
- **아일랜드 하이드레이션/직렬화** 개선
- **콘텐츠/데이터 로더 + 빌드 통합 훅** 설계
- **설정 무결성/lockfile** 워크플로우 도입 (ont-run adoption plan과 연동)

### Out-of-Scope (이번 계획서 기준)
- 전면적인 런타임 교체(Bun/Node/Deno 전환)
- 프론트엔드 렌더러 교체(React → 다른 프레임워크)
- 대규모 API 호환성 깨는 변경(메이저 버전 이전)

---

## 3. 조화 통합 원칙 (Harmony Principles)

1. **Mandu 아이덴티티 우선**: 기존 Mandu 설계 철학(Architecture Preservation)을 훼손하지 않는다.
2. **Adapter First**: 직접 복제보다, Mandu 컨셉에 맞는 얇은 어댑터 계층으로 흡수한다.
3. **단방향 의존성**: DNA 코드가 Mandu 코어에 의존하지 않도록 분리 유지.
4. **호환성 유지**: 기존 Mandu API와 마이그레이션 비용을 최소화한다.
5. **측정 기반 채택**: 성능/안정성/DX 메트릭이 개선될 때만 채택한다.

---

## 4. 직접 분석한 코드 범위 (핵심 파일 목록)

### Hono
- `DNA/hono/src/compose.ts`
- `DNA/hono/src/hono-base.ts`
- `DNA/hono/src/router.ts`
- `DNA/hono/src/router/smart-router/router.ts`

### Elysia
- `DNA/elysia/src/compose.ts`
- `DNA/elysia/src/adapter/bun/compose.ts`
- `DNA/elysia/src/dynamic-handle.ts`
- `DNA/elysia/src/types.ts`
- `DNA/elysia/src/schema.ts`
- `DNA/elysia/src/trace.ts`

### Fresh
- `DNA/fresh/packages/fresh/src/jsonify/stringify.ts`
- `DNA/fresh/packages/fresh/src/jsonify/parse.ts`
- `DNA/fresh/packages/fresh/src/runtime/server/preact_hooks.ts`
- `DNA/fresh/packages/fresh/src/runtime/client/reviver.ts`
- `DNA/fresh/packages/fresh/src/fs_routes.ts`

### Astro
- `DNA/astro/packages/astro/src/content/loaders/types.ts`
- `DNA/astro/packages/astro/src/integrations/hooks.ts`
- `DNA/astro/packages/astro/src/core/build/pipeline.ts`

### Qwik
- `DNA/qwik/packages/qwik/src/core/container/pause.ts`
- `DNA/qwik/packages/qwik/src/core/container/serializers.ts`
- `DNA/qwik/packages/qwik/src/core/qrl/qrl-class.ts`

### FastAPI
- `DNA/fastapi/fastapi/openapi/utils.py`
- `DNA/fastapi/fastapi/applications.py`

### Phoenix
- `DNA/phoenix/lib/phoenix/channel.ex`
- `DNA/phoenix/lib/phoenix/socket.ex`

---

## 5. 코드 기반 핵심 인사이트 요약

### 5.1 Hono (compose + router)
- `compose.ts`: `next()` 중복 호출 방지(`index`), 에러 핸들러에서 `context.error` 설정, `context.finalized` 상태에 따른 `context.res` 갱신.
- `hono-base.ts`: `app.use()`가 `*` 경로로 미들웨어 등록, `route()`로 하위 앱 그룹화.
- `smart-router/router.ts`: 여러 라우터를 순차 시도 후 **성공한 라우터로 고정**.

**Mandu 적용 포인트**
- compose의 **중복 next 차단**, `finalized/error` 상태 반영
- 필요 시 SmartRouter 전략 적용

---

### 5.2 Elysia (AOT compose + lifecycle + trace)
- `adapter/bun/compose.ts`: 라우트별 **핸들러 함수 문자열 동적 생성**(AOT) + `sucrose` 추론으로 컨텍스트 최소화.
- `dynamic-handle.ts`: `onRequest`/`parse` 훅 처리, 컨텐츠 타입 기반 파서 선택, `mapEarlyResponse`로 빠른 응답 처리.
- `schema.ts`: TypeBox + `exact-mirror` 기반 정규화/필터링, `hasAdditionalProperties`, `resolveSchema`, `coerce` 로직.
- `trace.ts`: `request/parse/transform/beforeHandle/afterHandle/mapResponse/afterResponse/error` 트레이스 이벤트 제공.

**Mandu 적용 포인트**
- AOT/JIT **핸들러 생성 + 컨텍스트 추론 최적화**
- 라이프사이클/트레이스 기반 관측성 강화
- 스키마 정규화(허용되지 않은 필드 제거/변환) 옵션

---

### 5.3 Fresh (jsonify + islands + FS routes)
- `jsonify/stringify.ts`/`parse.ts`: 참조 테이블 기반 직렬화, `Date/URL/RegExp/Map/Set/Uint8Array/BigInt/NaN/Infinity/-0` 등 지원.
- `runtime/server/preact_hooks.ts`: SSR 중 islands/partials/slots 수집, preact 옵션 훅으로 vnode 후킹.
- `runtime/client/reviver.ts`: DOM 마커 기반 island/partial 복원, `scheduler.postTask`로 비차단 하이드레이션.
- `fs_routes.ts`: 파일을 Command로 변환(middleware/layout/error/route/app), lazy route 로딩에 tracer 사용.

**Mandu 적용 포인트**
- islands 직렬화 **진짜 타입 지원**
- partial/slot 도입 시 **DOM marker 기반 복원**
- 파일 기반 라우팅을 **Command 레이어**로 표준화

---

### 5.4 Astro (Loader + Integrations)
- `content/loaders/types.ts`: LoaderContext에 `store/meta/logger/config/renderMarkdown/generateDigest/watcher` 제공.
- `integrations/hooks.ts`: 통합 훅 실행 시 **시간 초과 로그**, 통합 전용 logger, **안전한 코드 생성 디렉토리** 규칙.
- `core/build/pipeline.ts`: manifest → asset 링크 → 렌더링 흐름 기반 파이프라인.

**Mandu 적용 포인트**
- Loader 설계 시 **meta store + generateDigest + watcher** 포함
- 통합 훅에 **시간 초과 경고** 및 **logger 분리**

---

### 5.5 Qwik (Resumable + Serializer Registry + QRL)
- `pause.ts`: container state 수집, object ID 맵핑 후 JSON 스냅샷 생성.
- `serializers.ts`: 타입별 serializer registry(collect/prepare/fill) 구조.
- `qrl-class.ts`: QRL 캡처 변수 **직렬화 가능성 검증**, 필요 시 prefetch 실행.

**Mandu 적용 포인트**
- 직렬화에 **플러그인 기반 serializer registry** 개념 적용
- 이벤트 핸들러 지연 로딩용 **QRL-lite** 설계 가능

---

### 5.6 FastAPI (OpenAPI 생성)
- `openapi/utils.py`: 파라미터/바디/보안/예제 등 포함한 자동 OpenAPI 생성.
- `applications.py`: `openapi_schema` 캐싱, `openapi_url` 라우트/문서 라우트 자동 제공.

**Mandu 적용 포인트**
- Contract 기반 OpenAPI 생성 시 **캐싱 + docs endpoint 자동 제공**
- `openapi_examples`, `openapi_extra`를 Mandu Contract 스펙에 포함

---

### 5.7 Phoenix (Channel/Socket)
- `channel.ex`: `join/handle_in/handle_out`, `broadcast/push/reply` 패턴 명확.
- `socket.ex`: `connect/id`, channel/topic 매칭, serializer 기반 메시지 프로토콜.

**Mandu 적용 포인트**
- WS 플랫폼 설계 시 **Channel/Socket 분리 모델** 적용
- `join` 인증과 이벤트 기반 요청 처리 구조 도입

---

## 6. DNA 프레임워크 맵 & 채택 전략

| 프레임워크 | 강점 | Mandu 적용 영역 | 채택 방식 | 리스크 |
|---|---|---|---|---|
| **Hono** | 초경량 미들웨어 compose | 런타임 미들웨어 체인 | 코드 패턴 이식 | 낮음 |
| **Elysia** | 라이프사이클 훅, 타입 추론 | 요청 라이프사이클, 타입 안정성 | 구조/타입 패턴 이식 | 중간 |
| **Fresh** | 아일랜드, 직렬화 | SSR 하이드레이션, props 직렬화 | 코드+패턴 | 중간 |
| **Astro** | 콘텐츠 로더, 통합 훅 | 데이터 수집/플러그인 | 설계 패턴 | 중간 |
| **Qwik** | Resumable, QRL | 미래형 하이드레이션 | 연구/실험 | 높음 |
| **FastAPI** | OpenAPI 자동 생성 | Contract → OpenAPI | 패턴 | 낮음 |
| **Phoenix** | 채널/실시간 | WS 플랫폼(장기) | 연구 | 높음 |
| **Next.js** | 풀스택 패턴 | 구조 참고(벤치마크) | 참고 | 낮음 |
| **Bun** | 런타임 최적화 | 런타임 성능 인사이트 | 참고 | 낮음 |

---

## 7. 목표 아키텍처 (Target Architecture)

```
┌──────────────────────────────────────────────────────────┐
│                      Mandu Core                          │
├──────────────────────────────────────────────────────────┤
│ Request Pipeline                                         │
│  - Router → Compose → Lifecycle → Handler → Response     │
├──────────────────────────────────────────────────────────┤
│ Contracts & Types                                        │
│  - Schema/Validation → Typed Handlers → OpenAPI          │
├──────────────────────────────────────────────────────────┤
│ Rendering & Hydration                                    │
│  - SSR → Islands → Serialize/Deserialize → Client Resume │
├──────────────────────────────────────────────────────────┤
│ Data & Content                                            │
│  - Loader API → DataStore → Build-Time Pipeline          │
├──────────────────────────────────────────────────────────┤
│ Build & Integrations                                     │
│  - Build Hooks → Plugin System → Analyzer                │
└──────────────────────────────────────────────────────────┘
```

---

## 8. 워크스트림별 상세 계획 (코드 기반 확장)

### A. Core Runtime Pipeline (Hono + Elysia)
**목표**: 요청 처리 파이프라인을 단일 체계로 통합

**핵심 작업**
- Hono `compose` 패턴 기반 미들웨어 체인 재구성
- `next()` 중복 호출 방지, `finalized` 상태 반영
- 라우트 디버깅을 위한 `routeIndex` 추적

**산출물**
- `packages/core/src/runtime/compose.ts`
- `packages/core/src/filling/filling.ts` API 확장

**테스트**
- `tests/runtime/compose.test.ts`

---

### B. 라이프사이클 + Trace (Elysia)
**목표**: 요청 흐름을 표준화하고 단계별 관측 가능성을 확보

**핵심 작업**
- `request → parse → transform → beforeHandle → handle → afterHandle → mapResponse → afterResponse → error` 단계 정의
- trace 이벤트 수집 API 제공

**산출물**
- `packages/core/src/runtime/lifecycle.ts`
- `packages/core/src/runtime/trace.ts`

**테스트**
- `tests/runtime/lifecycle-order.test.ts`
- `tests/runtime/trace.test.ts`

---

### C. AOT 핸들러 생성 (Elysia adapter/bun/compose)
**목표**: 라우트별 컨텍스트 최소화로 성능 개선

**핵심 작업**
- `sucrose` 유사 추론으로 필요한 속성만 생성
- AOT/JIT 선택 가능 구조 설계

**산출물**
- `packages/core/src/runtime/aot/compose.ts`
- `packages/core/src/runtime/aot/infer.ts`
- CLI 옵션: `mandu build --aot` 또는 config `runtime.precompile`

**테스트**
- `tests/runtime/aot-ctx-infer.test.ts`
- `tests/perf/aot-vs-jit.test.ts`

---

### D. Type Contracts & OpenAPI (Elysia + FastAPI)
**목표**: Contract 정의에서 타입과 OpenAPI 자동 생성

**핵심 작업**
- Contract 정의 → Request/Response 타입 추론
- OpenAPI 스키마 자동 생성 파이프라인 설계
- `openapi_examples`, `openapi_extra` 지원
- 캐싱(`openapiSchema`) + docs endpoint 옵션

**산출물**
- `packages/core/src/contract/infer.ts`
- `packages/core/src/contract/openapi.ts`
- CLI: `mandu openapi --out openapi.json`

**테스트**
- `tests/contract/openapi.test.ts`

---

### E. Schema 정규화 + Coerce (Elysia schema)
**목표**: 허용되지 않은 필드 제거/변환 옵션 제공

**핵심 작업**
- `normalize: false | 'exactMirror' | 'typebox'` 옵션 정의
- `ctx.body()`에서 정규화 적용

**산출물**
- `packages/core/src/contract/normalize.ts`

**테스트**
- `tests/contract/normalize.test.ts`

---

### F. Hydration & Serialization (Fresh + Qwik)
**목표**: 아일랜드 props 직렬화 강화 및 확장 포인트 제공

**핵심 작업**
- Fresh 방식 reference table 기반 직렬화
- Qwik 방식 serializer registry 확장 포인트 설계

**지원 타입**
- `Date/URL/RegExp/Map/Set/Uint8Array/BigInt/NaN/Infinity/-0/undefined`

**산출물**
- `packages/core/src/client/serialize.ts`
- `packages/core/src/client/deserialize.ts`

**테스트**
- `tests/client/serialize.test.ts`

---

### G. Islands/Partials/Slots (Fresh)
**목표**: partial/slot 개념 도입(선택) + DOM marker 기반 복원

**핵심 작업**
- island 렌더링 시 marker 규약 정의
- client reviver에서 DOM 스캔 및 복원

**산출물**
- `packages/core/src/client/island.ts` 개선
- `packages/core/src/client/reviver.ts`

**테스트**
- `tests/client/island-revive.test.ts`

---

### H. Data & Content Layer (Astro)
**목표**: Loader 시스템 도입, meta store + digest + watcher 지원

**핵심 작업**
- Loader 인터페이스 설계
- File/API Loader 구현
- DataStore + MetaStore 구성

**산출물**
- `packages/core/src/loader/types.ts`
- `packages/core/src/loader/store.ts`
- `packages/core/src/loader/loaders/file-loader.ts`
- `packages/core/src/loader/loaders/api-loader.ts`

**테스트**
- `tests/loader/loader.test.ts`

---

### I. FS Routes Command Layer (Fresh)
**목표**: 파일 기반 라우팅을 Command 레이어로 표준화

**핵심 작업**
- middleware/layout/error/route/app 명령 체계화
- lazy route 로딩 시 tracer 연동

**산출물**
- `packages/core/src/router/fs-commands.ts`
- `packages/core/src/router/fs-routes.ts`

**테스트**
- `tests/router/fs-routes.test.ts`

---

### J. Build & Integrations (Astro + Fresh)
**목표**: 빌드 훅/플러그인 시스템 확장

**핵심 작업**
- Build Hooks (start/setup/done)
- 플러그인 API 정의
- 훅 실행 시간 초과 경고 + 전용 logger

**산출물**
- `packages/core/src/integrations/hooks.ts`
- `packages/core/src/integrations/logger.ts`
- `packages/core/src/bundler/hooks.ts`
- `packages/core/src/bundler/plugins.ts`

**테스트**
- `tests/integration/hooks.test.ts`

---

### K. Stability & Observability (공통)
**목표**: 안정성과 디버깅 편의성을 확보

**핵심 작업**
- 에러 스택/컨텍스트 추적 강화
- 로깅 인터페이스 정의
- 성능 측정(라우팅, SSR, hydration)

**산출물**
- `packages/core/src/runtime/logger.ts`
- `tests/perf/*.test.ts`

---

### L. WebSocket Channels (Phoenix)
**목표**: Channel/Socket 분리 모델 기반 실시간 플랫폼

**핵심 작업**
- `join`, `handle_in`, `handle_out`, `broadcast/push/reply` 설계
- serializer 기반 메시지 프로토콜 정의

**산출물**
- `packages/core/src/ws/socket.ts`
- `packages/core/src/ws/channel.ts`
- `packages/core/src/ws/serializer.ts`

**테스트**
- `tests/ws/channel.test.ts`

---

### M. Resumable POC (Qwik)
**목표**: QRL-lite 기반 이벤트 핸들러 지연 로딩 실험

**핵심 작업**
- QRL-lite 설계
- resumable POC 문서화

**산출물**
- `packages/core/src/client/qrl.ts`
- `packages/core/src/client/resumable.ts`

---

## 9. 수정/추가 파일 구조 (제안)

```
packages/core/src/
├── runtime/
│   ├── compose.ts
│   ├── lifecycle.ts
│   ├── trace.ts
│   └── aot/
│       ├── compose.ts
│       └── infer.ts
├── contract/
│   ├── infer.ts
│   ├── normalize.ts
│   └── openapi.ts
├── client/
│   ├── island.ts
│   ├── serialize.ts
│   ├── deserialize.ts
│   ├── reviver.ts
│   └── qrl.ts
├── loader/
│   ├── types.ts
│   ├── store.ts
│   └── loaders/
│       ├── file-loader.ts
│       └── api-loader.ts
├── router/
│   ├── fs-commands.ts
│   └── fs-routes.ts
├── integrations/
│   ├── hooks.ts
│   └── logger.ts
└── ws/
    ├── socket.ts
    ├── channel.ts
    └── serializer.ts
```

---

## 10. 로드맵 (구체 일정)

### Phase 0: DNA 인벤토리 & 설계 확정
- **기간**: 2026-01-29 ~ 2026-02-04
- **결과물**: 프레임워크별 채택 목록 확정, 라이선스 체크리스트

### Phase 1: Core Runtime 안정화
- **기간**: 2026-02-05 ~ 2026-02-25
- **주요 작업**: compose + lifecycle + trace, 기본 테스트

### Phase 2: 타입 시스템 & Contract 강화
- **기간**: 2026-02-26 ~ 2026-03-25
- **주요 작업**: 타입 추론 + OpenAPI + normalize

### Phase 3: Hydration/Loader 통합
- **기간**: 2026-03-26 ~ 2026-04-22
- **주요 작업**: serialize/islands 개선 + Loader 시스템

### Phase 4: Build/Integrations 확장
- **기간**: 2026-04-23 ~ 2026-05-20
- **주요 작업**: integration hooks + FS routes + 성능 리포트

### Phase 5: 고급 기능 연구
- **기간**: 2026-05-21 이후
- **주요 작업**: WS 채널 + Resumable POC

---

## 11. 코드 차용 프로세스 (명문화)

1. **DNA 스캔**: 대상 파일/모듈 선정 → `DNA_ADOPTION_PLAN.md` 업데이트
2. **라이선스 확인**: MIT/Apache 등 호환 여부 기록
3. **기술 설계서 작성**: Mandu 설계로의 매핑 정의
4. **어댑터 구현**: 직접 복제 대신 Mandu 컨텍스트에 맞게 재구성
5. **테스트/벤치마크**: 기능+성능 기준 충족 여부 확인
6. **문서화/마이그레이션**: 변경사항을 README/Docs에 반영

---

## 12. 테스트/품질 전략

### 단위 테스트
- compose, lifecycle, trace, serialize, loader, contract

### 통합 테스트
- SSR + island + hydration 시나리오

### 성능 테스트
- 라우팅 처리량 (req/sec)
- SSR TTFB
- hydration JS 크기

---

## 13. KPI & 성공 지표

| 영역 | 목표 지표 | 기준값 |
|---|---|---|
| 성능 | TTFB 20% 개선 | 현재 대비 |
| DX | 신규 프로젝트 세팅 5분 내 | CLI 기준 |
| 타입 | Contract 기반 타입 오류 0 | CI 기준 |
| 안정성 | 에러 재현 시간 30% 단축 | 로그/테스트 기준 |

---

## 14. 리스크 & 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| API 호환성 깨짐 | 높음 | Adapter 계층 유지, deprecated 단계 운영 |
| 코드 차용 라이선스 충돌 | 높음 | Phase 0에서 라이선스 체크리스트 실행 |
| AOT/Trace 비용 증가 | 중간 | perf test로 영향 측정 후 단계적 적용 |
| Resumable 복잡도 증가 | 중간 | POC로 한정, v1 이후 확정 |
| 일정 지연 | 중간 | 우선순위 재조정 (P0/P1 선행) |

---

## 15. 인력/역할 제안

- **Tech Lead**: 아키텍처 승인, 변경 통제
- **Core Runtime Engineer**: compose/lifecycle/trace 구현
- **Type/System Engineer**: contract/openapi/normalize
- **Rendering Engineer**: islands/serialization
- **Build/Tooling Engineer**: loader/build hooks
- **Docs/QA**: 테스트/문서 업데이트

---

## 16. 실행 체크리스트

- [ ] Phase 0 인벤토리 완료
- [ ] 라이선스 체크리스트 승인
- [ ] compose + lifecycle + trace 통합
- [ ] AOT POC 및 성능 검증
- [ ] serialize/deserialize 개선
- [ ] Contract 타입 추론 + OpenAPI
- [ ] Schema normalize 옵션 적용
- [ ] Loader 시스템 구현
- [ ] Integration hooks + FS routes 구현
- [ ] WS 채널/Resumable POC
- [ ] 성능 리포트 자동화

---

## 17. 부록

- 상세 코드 예시는 `DNA/DNA_ADOPTION_PLAN.md` 참고
- 관련 문서: `docs/product/01_mandu_product_brief.md`, `docs/architecture/02_mandu_technical_architecture.md`

---

> **다음 리뷰**: 2026-02-05 (Phase 1 시작 전)
