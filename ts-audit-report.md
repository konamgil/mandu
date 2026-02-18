# Mandu Framework TypeScript Advanced Types Audit Report

> **Date**: 2026-02-18
> **Scope**: packages/core, packages/cli, packages/mcp, packages/ate
> **Methodology**: typescript-advanced-types skill 기반 6개 도메인 병렬 분석
> **Files**: 215 type definition files, 168 files with generics
> **Overall Grade**: **B+ → A- (focused fixes로 달성 가능)**

---

## Executive Summary

Mandu 프레임워크의 타입 시스템은 **전반적으로 우수한 수준(B+)**이다. Contract 시스템의 6단계 mapped type 추론 체인, Runtime의 discriminated union 패턴, Guard의 `Record<GuardPreset, ...>` 전수 검사 패턴 등 고급 TypeScript 패턴을 적극 활용하고 있다.

**핵심 수치:**
- 프로덕션 코드 `any` 사용: **~99회** (전체 ~25,000 LOC 대비 0.4%)
- Zod 내부 접근(`_def`): **~25회** → 중앙화 유틸리티로 통합 필요
- MCP 서버 타입 소실: **~15회** → SDK 타입 활용 필요
- `catch (err: any)`: **~30회** → `catch (err: unknown)` 일괄 교체

**3주 집중 개선으로 A- 등급 달성 가능** (P0: 1주, P1: 1주, P2: 1주)

### Scoring Criteria

| Level | Description |
|-------|-------------|
| A | Best practice — 고급 패턴 적극 활용, 개선 불필요 |
| B | Good — 기본 타입 안전성 확보, 일부 개선 여지 |
| C | Needs Work — 타입 안전성 부족, `any` 남용 또는 패턴 미적용 |
| D | Critical — 런타임 에러 위험, 즉시 수정 필요 |

### Domain Scores

| Domain | Score | Key Finding |
|--------|-------|-------------|
| 1. Contract System | **B+** | 6단계 mapped type 추론 체인 우수. Zod `_def` 접근 산재(11회) |
| 2. Runtime & SSR | **A-** | discriminated union/type guard 모범 사례. `any` 5회(모두 정당화) |
| 3. Guard & Spec | **A-** | `Record<GuardPreset, ...>` 전수 검사 패턴 탁월. `any` 3회 |
| 4. Plugin & Config | **B+** | 에러 계층 설계 우수. 메타데이터 symbol 접근 `as any` 25회 집중 |
| 5. Content & SEO | **A-** | 프로덕션 `any` 0회. Zod 통합/conditional type 우수 |
| 6. CLI & ATE | **B+** | discriminated union 설계 우수. `catch (err: any)` 30+회 |

---

## Domain 1: Contract Type System

**Scope**: `packages/core/src/contract/` (12 source files, ~4,200 LOC)
**Evaluating**: Mapped types, conditional types, generic constraints, type inference

### 1.1 Current State

Contract 시스템은 프레임워크에서 **가장 정교한 타입 추론 체인**을 보유한다. `InferZod` → `InferResponseSchema` → `InferMethodRequest` → `InferContractRequest` → `InferContractResponse` → `InferContract`로 이어지는 6단계 conditional type 체인이 Zod 스키마에서 완전한 타입 추론을 수행한다.

`any` 11회 사용 (Zod 내부 접근 8회 + 타입 정의 3회)

### 1.2 Strengths

- **Expert Mapped Type** (`client.ts:97-102`): `[M in ContractMethod as M extends keyof T["request"] ? M : never]` — key filtering + conditional + 중첩 추론의 조합
- **Reference Type Guard** (`handler.ts:170-177`): `isHandlerResult()` — `value is Type` predicate, null 체크, `in` 연산자 사용
- **Discriminated Union** (`registry.ts:43-60`): `SchemaSummary` — `type` 리터럴 discriminator로 4개 variant 구분
- **Zero `any`** in 7/11 files (64%)
- `z.infer<T>`, `z.input<T>` 활용한 완전한 스키마-타입 통합

### 1.3 Issues Found

| Severity | Location | Issue |
|----------|----------|-------|
| HIGH | `define.ts:61` | `EndpointDefinition<any, any, any>` — 3개 unconstrained any가 20+ 파생 타입으로 전파 |
| HIGH | `normalize.ts:252,297,302-303,308,313` | Zod `_def` 접근 6회 산재 — 버전 변경에 취약 |
| HIGH | `define.ts:415,432` | Zod 내부 접근 2회 추가 — normalize.ts와 통합 필요 |
| LOW | `client.ts:195-196,285-286,294-295,302` | 불필요한 type assertion 4회 |

### 1.4 Recommendations

1. **P0**: `define.ts:61` → `EndpointDefinition<ZodTypeAny, ZodTypeAny, ZodTypeAny>` 교체 (5분)
2. **P0**: `zod-utils.ts` 유틸리티 모듈 신규 생성 → 8회 `as any` 1곳으로 중앙화 (30분)
3. **P2**: `client.ts` 불필요한 type assertion 제거 (10분)

---

## Domain 2: Runtime & SSR

**Scope**: `packages/core/src/runtime/`, `client/`, `island/` (12 files, ~5,000 LOC)
**Evaluating**: Discriminated unions, type guards, generic components

### 2.1 Current State

Runtime 시스템은 **프레임워크에서 가장 높은 타입 안전성**을 보인다. `any` 5회(0.1%)로 전체 중 최소이며, 모든 React 컴포넌트가 explicit Props 인터페이스를 가진다. `as const` 활용, discriminated union 패턴, type guard 구현 모두 모범 사례를 따른다.

### 2.2 Strengths

- **NavigationState**: `"idle" | "loading"` 리터럴 union으로 상태 머신 패턴 구현
- **Island Hydration**: `<TServerData, TSetupResult = TServerData>` — 2-parameter generic with default
- **Function Overloads** (`island.ts:236-244`): `wrapComponent` 2개 overload signature로 props 변환 분기
- **serialize.ts**: `as const` TYPE_MARKERS + circular reference 추적 — 완전한 직렬화 시스템
- **hooks.ts**: `useSyncExternalStore` 패턴, generic `useParams<T>` + `useLoaderData<T>` 제공
- **ErrorBoundary**: `Component<Props, State>` 정확한 class component 타이핑

### 2.3 Issues Found

| Severity | Location | Issue |
|----------|----------|-------|
| LOW | `streaming-ssr.ts:688,690` | `(globalThis as any).__MANDU_STREAMING_WARNED__` — 개발 전용 전역 플래그 |
| LOW | `server.ts:922` | dynamic import에서 `as any` fallback — legacy 호환성 경로 |
| LOW | `island/index.ts:177` | `deserializeIslandProps` switch에 default 케이스 누락 |

### 2.4 Recommendations

1. **P2**: `streaming-ssr.ts` — `StreamingWarnings` 클래스로 전역 플래그 대체 (10분)
2. **P3**: `island/index.ts` switch문에 explicit `default: return value;` 추가 (2분)
3. **P3**: EventListener 캐스팅을 위한 typed wrapper 유틸리티 (~15줄)

---

## Domain 3: Guard & Spec

**Scope**: `packages/core/src/guard/`, `spec/`, `filling/`, `generator/` (60+ files, ~15,000 LOC)
**Evaluating**: Record patterns, union exhaustiveness, literal types

### 3.1 Current State

Guard 시스템은 **`Record<UnionType, ...>` 패턴의 교과서적 활용**을 보인다. `GuardPreset` 6개 멤버, `FeatureCategory` 9개 멤버, `ViolationType` 6개 멤버 모두 Record로 전수 검사된다. Zod 기반 enum (`z.enum`) + `z.infer`로 런타임/컴파일타임 이중 안전성 확보.

`any` 3회만 사용 (생성 템플릿 2회 + 목 의존성 1회 — 모두 정당화)

### 3.2 Strengths

- **Record 전수 검사**: `Record<GuardPreset, PresetDefinition>` — 6개 프리셋 중 하나라도 누락 시 컴파일 에러
- **중첩 Record**: `Record<GuardPreset, Record<string, string>>` — 프리셋별 경로 매핑
- **6단계 Contract 타입 추론**: `InferZod` → `InferContractRequest` → `InferContract` 체인
- **Zod enum 이중 검증**: `const RouteKind = z.enum(["page", "api"])` + `type RouteKind = z.infer<typeof RouteKind>`
- **ViolationType → SeverityConfig 매핑**: `Record<ViolationType, keyof SeverityConfig>` 완벽한 전수 대응

### 3.3 Issues Found

| Severity | Location | Issue |
|----------|----------|-------|
| MEDIUM | `negotiation.ts:795-1002` | `generateFileContent` switch에 `controller`/`hook` 케이스 미처리 — default가 catch |
| MEDIUM | `spec/schema.ts:62-134` | `RouteSpec`가 `.refine()`으로 cross-field 검증 — `z.discriminatedUnion("kind")`이 더 적절 |
| LOW | `negotiation.ts:1175` | 새 프리셋 추가 시 매핑 로직 자동 감지 불가 |

### 3.4 Recommendations

1. **P1**: `generateFileContent()` — `never` 기반 exhaustiveness check 추가
   ```typescript
   default: { const _exhaustive: never = template; throw new Error(`Unhandled: ${_exhaustive}`); }
   ```
2. **P1**: `RouteSpec` → `z.discriminatedUnion("kind", [PageRoute, ApiRoute])` 리팩토링
3. **P3**: 프리셋 매핑 assertion guard 추가

---

## Domain 4: Plugin & Config

**Scope**: `packages/core/src/plugins/`, `config/`, `logging/`, `error/` + `packages/mcp/src/` (~20 files)
**Evaluating**: Generic constraints, type inference, plugin API safety

### 4.1 Current State

Plugin 시스템은 **강력한 에러 계층 설계**와 **Result<T> discriminated union**을 보유하나, **메타데이터 symbol 접근** (19회)과 **MCP 서버 타입 소실** (4회)이 집중된 약점이다. `any` 총 43회로 전체 도메인 중 최다.

### 4.2 Strengths

- **Error Class Hierarchy**: `ManduBaseError` abstract class + `errorType` discriminant → `FileError`, `RouterError`, `SSRError`, `SecurityError` 등 7개 하위 클래스
- **Result<T>**: `{ ok: true; value: T } | { ok: false; error: ManduError }` — 깔끔한 discriminated union
- **Plugin<TConfig>**: generic config 흐름이 등록→검증→API까지 타입 안전하게 전파
- **Config Validation**: `z.infer<typeof ManduConfigSchema>`로 single source of truth

### 4.3 Issues Found

| Severity | Location | Issue |
|----------|----------|-------|
| CRITICAL | `mcp/server.ts:116-123` | `request: any, _extra: any` — MCP SDK 타입 완전 소실 |
| HIGH | `config/metadata.ts` (19회) | `(schema as any)[symbol]` — symbol 메타데이터 접근 |
| HIGH | `config/mcp-ref.ts` (6회) | 동일 패턴 — metadata.ts와 통합 필요 |
| HIGH | `mcp/tools/ate.ts:248-299` | `args as any` 9회 — 도구 핸들러 타입 소실 |
| MEDIUM | `plugins/registry.ts:25-36` | `PluginState` string union이 state-specific 필드 미보장 |

### 4.4 Recommendations

1. **P0**: MCP `server.ts` — SDK의 `CallToolRequest` 타입 직접 사용 (2시간)
2. **P0**: `TypedSchemaMetadata` WeakMap 래퍼 클래스 생성 → 25회 `as any` 1곳으로 (4시간)
3. **P1**: ATE 도구 핸들러 — Zod 스키마로 args 검증 후 타입 주입 (3시간)
4. **P2**: `RegisteredPlugin` → discriminated union by state (1시간)
5. **P2**: `Result<T>` 에 `isOk()`, `isErr()` type guard 추가 (30분)

---

## Domain 5: Content & SEO

**Scope**: `packages/core/src/content/`, `seo/`, `openapi/`, `brain/` (50+ files)
**Evaluating**: Utility types, template literals, Zod integration

### 5.1 Current State

Content & SEO는 **프로덕션 코드에서 `any` 0회**로 프레임워크 최고 수준의 타입 안전성을 보인다. Conditional type(`InferEntryData<T>`), discriminated union(`Title = string | TemplateString | AbsoluteString`), type guard(`isTemplateString`, `isAbsoluteString`) 모두 모범 사례.

### 5.2 Strengths

- **Zero `any` in production** — 테스트 파일 2회만 존재
- **Conditional Type**: `InferEntryData<T> = T["schema"] extends ZodSchema<infer U> ? U : Record<string, unknown>`
- **Title 타입 시스템**: `TemplateString`/`AbsoluteString` 구조적 discriminator (tag 필드 없이 `default`/`absolute` 프로퍼티로 구분)
- **Type Guard 쌍**: `isTemplateString()`/`isAbsoluteString()` — null 체크 + 부정 조건 포함
- **Zod 통합**: `parseData<T>()` 제네릭 + `safeParseAsync` + `ZodError` 변환
- **SEO Metadata**: `Omit<Robots, 'googleBot'>` 재귀적 타입 배제

### 5.3 Issues Found

| Severity | Location | Issue |
|----------|----------|-------|
| HIGH | `openapi/generator.ts:127-251` | Zod private `_def` 직접 접근 — 버전 호환성 위험 |
| MEDIUM | `brain/types.ts:75-93` | `PatchSuggestion.type`의 필드 요구사항이 discriminant에 의해 강제되지 않음 |
| LOW | `content/types.ts:38` | `Record<string, unknown>` 기본값이 과도하게 허용적 |

### 5.4 Recommendations

1. **P1**: OpenAPI generator — `zod-to-openapi` 라이브러리 교체 또는 `zod-utils.ts` 공유 (2-3일)
2. **P2**: `PatchSuggestion` → conditional type으로 type별 필수 필드 강제
3. **P3**: Template literal type 도입 (`og:${string}`, `twitter:${string}`)
4. **P3**: Branded type 도입 (`CollectionId`, `EntryId`, `SafeHTML`)

---

## Domain 6: CLI & ATE

**Scope**: `packages/cli/src/`, `packages/ate/src/` (68 files)
**Evaluating**: Function overloads, discriminated unions, inference

### 6.1 Current State

CLI & ATE는 **InteractionGraph의 discriminated union 설계가 우수**하나, `catch (err: any)` 패턴이 **30회 이상** 반복되어 타입 안전성을 약화시킨다. function overload, mapped type, template literal type 등 고급 패턴의 활용이 부족하다.

`any` 37회 사용 (에러 핸들러 30회 + 타입 캐스팅 7회)

### 6.2 Strengths

- **InteractionGraph**: `InteractionNode` / `InteractionEdge` — `kind` discriminant 완벽 구현
- **Type Guard**: `isHttpMethod()` — `value is HttpMethod` predicate
- **Error Code Mapping**: `Record<CLIErrorCode, ErrorInfo>` 전수 검사
- **`as const` 활용**: `OracleLevel`, `HTTP_METHODS` 등 리터럴 타입 보존

### 6.3 Issues Found

| Severity | Location | Issue |
|----------|----------|-------|
| HIGH | 30+ files | `catch (err: any)` — `catch (err: unknown)` 일괄 교체 필요 |
| HIGH | `registry.ts:74-75` | `ctx.options.css as any, ui: ctx.options.ui as any` — unsafe cast |
| HIGH | `handlers.ts:52` | `importFn: (modulePath: string) => Promise<any>` |
| MEDIUM | `extractor.ts` | ts-morph 노드 11회 `any` — 인터페이스 정의 필요 |
| LOW | 전반 | function overload, mapped type, template literal 미활용 |

### 6.4 Recommendations

1. **P0**: `catch (err: any)` → `catch (err: unknown)` 일괄 교체 (1-2시간)
2. **P1**: `CommandContext<T>` 제네릭화 — 커맨드별 옵션 타입 안전성 확보
3. **P1**: `registry.ts` unsafe cast 제거 — parsing 함수 또는 type guard 추가
4. **P2**: function overload 도입 (report generation, command routing)
5. **P3**: mapped type으로 handler signature 자동 추론

---

## Cross-Cutting Concerns

### any 사용 현황

| 도메인 | 프로덕션 `any` | 테스트 `any` | 주요 패턴 |
|--------|---------------|-------------|----------|
| Contract | 11 | 1 | Zod `_def` 접근 (8), 타입 정의 (3) |
| Runtime & SSR | 5 | 0 | globalThis 접근 (2), dynamic import (2), EventListener (1) |
| Guard & Spec | 3 | 0 | 생성 템플릿 (2), mock (1) |
| Plugin & Config | 43 | 1 | symbol 메타데이터 (25), MCP SDK (4), 도구 핸들러 (9) |
| Content & SEO | 0 | 2 | 프로덕션 zero `any` |
| CLI & ATE | 37 | 0 | catch 블록 (30), unsafe cast (7) |
| **합계** | **~99** | **~4** | |

**패턴별 분류:**
- `catch (err: any)` → `unknown`: **~30회** (기계적 교체 가능)
- Zod `_def` 접근: **~25회** (중앙화 유틸리티로 통합)
- MCP/도구 타입 소실: **~15회** (SDK 타입 활용)
- symbol 메타데이터: **~19회** (WeakMap 래퍼로 통합)
- 기타 (정당화됨): **~10회**

### Type Guard 활용도

| 패턴 | 구현 수 | 품질 |
|------|--------|------|
| `value is Type` predicate | 15+ | A+ — `isHandlerResult`, `isTemplateString`, `isIsland` 등 모범 사례 |
| `instanceof` narrowing | 30+ | A — ErrorBoundary, Zod type 분기에서 적극 활용 |
| `typeof` guard | 20+ | A — SSR boundary, serialization에서 활용 |
| `in` operator | 10+ | A — property 존재 확인 |
| assertion function | 0 | N/A — `asserts value is T` 패턴 미활용 |

### Utility Type 활용도

| Utility | 사용 빈도 | 평가 |
|---------|----------|------|
| `Record<K, V>` | 40+ | A+ — 전수 검사 패턴의 핵심 |
| `Partial<T>` | 15+ | A |
| `Required<T>` | 5+ | A — config defaults에 활용 |
| `Omit<T, K>` | 10+ | A — LinkProps, SEO types |
| `Pick<T, K>` | 3 | B — 활용 부족 |
| `Extract<T, U>` | 5+ | A |
| `NonNullable<T>` | 3+ | B — client-safe.ts에서 우수 활용 |
| `ReturnType<T>` | 2 | B |
| `Parameters<T>` | 0 | N/A — 미활용 |

### 공통 개선 패턴

1. **Zod 내부 접근 중앙화**: `contract/normalize.ts`, `contract/define.ts`, `contract/registry.ts`, `openapi/generator.ts`에 산재된 `(schema as any)._def` → 공유 `zod-utils.ts`
2. **`catch (err: any)` → `catch (err: unknown)`**: CLI/ATE 전체 + 일부 core 파일
3. **Discriminated Union 강화**: `PluginState`, `PatchSuggestion`, `RouteSpec`
4. **`never` exhaustiveness check**: switch/case 문에 `default: { const _: never = x; }` 패턴

---

## Priority Action Items

### P0 — Critical (즉시 수정, ~1일)

| # | 작업 | 위치 | 효과 | 소요 |
|---|------|------|------|------|
| 1 | `catch (err: any)` → `catch (err: unknown)` 일괄 교체 | CLI/ATE 30+회 | 30회 `any` 제거 | 2시간 |
| 2 | `EndpointDefinition<any,any,any>` → `<ZodTypeAny,...>` | `contract/define.ts:61` | 3회 `any` 제거 + 파생 타입 안전성 | 5분 |
| 3 | MCP server handler SDK 타입 적용 | `mcp/server.ts:116-123` | 4회 `any` 제거 + IDE 자동완성 | 2시간 |
| 4 | `zod-utils.ts` 중앙화 유틸리티 생성 | 신규 파일 | 8회 `as any` 1곳으로 | 30분 |

**P0 완료 효과**: ~45회 `any` 제거 (99 → ~54)

### P1 — High (다음 릴리즈, ~3일)

| # | 작업 | 위치 | 효과 | 소요 |
|---|------|------|------|------|
| 5 | `TypedSchemaMetadata` WeakMap 래퍼 | `config/metadata.ts` | 25회 `as any` 중앙화 | 4시간 |
| 6 | ATE 도구 핸들러 Zod 스키마 추가 | `mcp/tools/ate.ts` | 9회 `as any` 제거 + 검증 | 3시간 |
| 7 | `generateFileContent` exhaustiveness check | `guard/negotiation.ts` | 새 FileTemplate 누락 방지 | 30분 |
| 8 | `RouteSpec` → `z.discriminatedUnion` | `spec/schema.ts` | kind별 필드 강제 | 2시간 |
| 9 | `CommandContext<T>` 제네릭화 | `cli/registry.ts` | 커맨드 옵션 타입 안전성 | 2시간 |
| 10 | OpenAPI generator Zod 접근 통합 | `openapi/generator.ts` | `zod-utils.ts` 활용 | 2시간 |

**P1 완료 효과**: ~34회 추가 `any` 제거 (54 → ~20)

### P2 — Medium (점진적 개선, ~1주)

| # | 작업 | 위치 | 효과 |
|---|------|------|------|
| 11 | `RegisteredPlugin` discriminated union by state | `plugins/registry.ts` | state-specific 필드 보장 |
| 12 | `Result<T>` type guard (`isOk`, `isErr`) 추가 | `error/result.ts` | 패턴 매칭 편의성 |
| 13 | `PatchSuggestion` conditional type 강화 | `brain/types.ts` | type별 필수 필드 강제 |
| 14 | `StreamingWarnings` 클래스화 | `streaming-ssr.ts` | globalThis `as any` 제거 |
| 15 | 불필요한 type assertion 정리 | `contract/client.ts` 등 | 코드 청결도 |

### P3 — Low (리팩토링 시 적용)

| # | 작업 | 위치 | 효과 |
|---|------|------|------|
| 16 | Branded type 도입 (`CollectionId`, `EntryId`, `SafeHTML`) | 각 도메인 | ID 혼동 방지 |
| 17 | Template literal type (`og:${string}`) | SEO types | IDE 자동완성 |
| 18 | Function overload (CLI command routing) | `cli/registry.ts` | 다형성 타입 안전성 |
| 19 | Mapped type (handler signature) | CLI/ATE | 자동 추론 |
| 20 | `assertion function` 패턴 도입 | 전반 | `asserts value is T` 활용 |

---

## Appendix

### A. any 사용 위치 전체 목록

**Contract (11회)**
- `define.ts:61` — `EndpointDefinition<any, any, any>`
- `normalize.ts:252,297,302-303,308,313` — Zod `_def` 접근 (6회)
- `define.ts:415,432` — Zod 내부 접근 (2회)

**Runtime & SSR (5회)**
- `streaming-ssr.ts:688,690` — globalThis 플래그
- `server.ts:922,926` — dynamic import fallback
- `island.ts:191` — EventListener 캐스팅

**Guard & Spec (3회)**
- `generator/templates.ts:307,336` — 생성 템플릿 코드
- `filling/deps.ts:166` — mock 의존성

**Plugin & Config (43회)**
- `config/metadata.ts` — symbol 접근 (19회)
- `config/mcp-ref.ts` — symbol 접근 (6회)
- `mcp/server.ts:116,123` — MCP SDK 타입 소실 (3회)
- `mcp/tools/ate.ts:248-299` — 도구 핸들러 (9회)
- `mcp/tools/index.ts:51,76` — 정의/핸들러 (3회)
- 기타 (3회)

**Content & SEO (0 프로덕션 + 2 테스트)**
- `content.test.ts:348,349` — 테스트 assertion

**CLI & ATE (37회)**
- `catch (err: any)` — 30회 (codegen, pipeline, impact, report, runner, fs, html 등)
- `registry.ts:74-75` — unsafe cast (2회)
- `handlers.ts:52` — import 반환 타입 (1회)
- `test-auto.ts:18` — impactInfo (1회)
- `extractor.ts` — ts-morph 타입 (3회)

### B. 타입 복잡도 높은 파일 Top 10

| # | 파일 | LOC | 복잡도 지표 |
|---|------|-----|-----------|
| 1 | `contract/types.ts` | 241 | 6단계 conditional type 체인, 20+ infer 사용 |
| 2 | `contract/client.ts` | 348 | Key remapping mapped type + 중첩 conditional |
| 3 | `contract/handler.ts` | 270 | Optional mapped type + 4-parameter conditional |
| 4 | `guard/negotiation.ts` | 1200+ | 3개 `Record<Union, ...>` + FileTemplate 14-variant switch |
| 5 | `seo/types.ts` | 500+ | 재귀 metadata 타입 + 다중 discriminated union |
| 6 | `client/serialize.ts` | 320 | 재귀 직렬화 + `as const` 마커 + circular reference |
| 7 | `contract/registry.ts` | 592 | ZodLike duck typing + SchemaSummary discriminated union |
| 8 | `contract/validator.ts` | 609 | Required<Omit<>> 패턴 + Result discriminated union |
| 9 | `runtime/streaming-ssr.ts` | 700+ | StreamingError/Metrics 인터페이스 + WeakSet cycle 감지 |
| 10 | `config/metadata.ts` | 290 | SymbolMetadataMap generic + 다중 symbol 접근 |

### C. 참고 패턴 (typescript-advanced-types skill)

**모범 사례 (이미 활용 중)**:
- Conditional Type with `infer`: `types.ts:22-29`
- Mapped Type with Key Filtering: `client.ts:97-102`
- Type Guard with `is`: `handler.ts:170-177`
- Discriminated Union: `registry.ts:43-60`
- `as const` for Literal Types: `serialize.ts:18-39`
- Generic with Default: `island.ts:96-111`
- Record Exhaustiveness: `presets/index.ts:266-273`

**도입 권장 패턴**:
- `asserts value is T` (assertion function)
- Template Literal Types (`${prefix}:${string}`)
- Branded Types (`string & { __brand: "ID" }`)
- `satisfies` operator (TypeScript 4.9+)
- `const` type parameter (TypeScript 5.0+)
- `using`/`Symbol.dispose` (TypeScript 5.2+)
