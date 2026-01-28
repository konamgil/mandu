# DNA 코드 차용 기획서

> **목적**: DNA 폴더 내 검증된 프레임워크에서 mandu 프로젝트에 적용할 패턴과 코드를 식별하고 구현 로드맵 수립

---

## 1. Executive Summary

### 1.1 분석 대상

| 프레임워크 | 언어 | 핵심 강점 | mandu 적용 영역 |
|-----------|------|---------|----------------|
| **Hono** | TypeScript | 초경량 라우터, 미들웨어 compose | 라우팅, 미들웨어 파이프라인 |
| **Elysia** | TypeScript | E2E 타입 안전성, 플러그인 시스템 | 타입 추론, 라이프사이클 훅 |
| **Fresh** | TypeScript/Deno | 아일랜드 아키텍처, SSR | 하이드레이션, 빌드 시스템 |
| **Astro** | TypeScript | 콘텐츠 컬렉션, 통합 시스템 | 데이터 로더, 플러그인 아키텍처 |
| **Qwik** | TypeScript | Resumable, QRL 시스템 | 직렬화, 지연 로딩 |
| **Bun** | Zig/C++ | 런타임 최적화 | 참고용 (저수준) |
| **Next.js** | JavaScript | 풀스택 패턴 | 참고용 (규모가 큼) |
| **FastAPI** | Python | OpenAPI 생성 | Contract/OpenAPI 패턴 |
| **Phoenix** | Elixir | 실시간 채널 | WebSocket 플랫폼 (향후) |

### 1.2 우선순위 매트릭스

```
높은 영향도 + 낮은 복잡도 (즉시 적용)
├─ Hono: 미들웨어 compose 패턴
├─ Elysia: 라이프사이클 훅 체계
└─ Fresh: 아일랜드 props 직렬화

높은 영향도 + 높은 복잡도 (Phase 2)
├─ Qwik: Resumable 아키텍처
├─ Astro: 콘텐츠 컬렉션 로더
└─ Elysia: E2E 타입 안전성

낮은 영향도 + 낮은 복잡도 (선택적)
├─ Hono: SmartRouter 패턴
└─ Fresh: 파일 기반 라우팅 정렬

낮은 영향도 + 높은 복잡도 (향후 검토)
├─ Qwik: QRL 시스템
└─ Phoenix: 채널 기반 실시간
```

---

## 2. 상세 분석 및 적용 계획

### 2.1 미들웨어 시스템 개선 (from Hono)

#### 현재 mandu 상태
```typescript
// packages/core/src/filling/filling.ts
// Guard + Handler 분리, 에러 처리를 ManduContext.error로 위임
```

#### Hono의 compose 패턴
```typescript
// DNA/hono/src/compose.ts
export const compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1

    async function dispatch(i) {
      if (i <= index) throw new Error('next() called multiple times')
      index = i

      const handler = middleware[i]?.[0]?.[0]
      if (handler) {
        const res = await handler(context, () => dispatch(i + 1))
        // 에러 처리 통합
      }
      return context
    }

    return dispatch(0)
  }
}
```

#### 적용 코드
```typescript
// packages/core/src/runtime/compose.ts (신규)
import type { ManduContext, Handler, Guard } from '../filling/types'

export type MiddlewareEntry = {
  fn: Handler | Guard
  type: 'guard' | 'handler'
  isAsync: boolean
}

export const compose = <Env = any>(
  middleware: MiddlewareEntry[],
  onError?: (err: Error, ctx: ManduContext<Env>) => Response | Promise<Response>,
  onNotFound?: (ctx: ManduContext<Env>) => Response
) => {
  return async (context: ManduContext<Env>): Promise<Response> => {
    let index = -1

    const dispatch = async (i: number): Promise<Response | void> => {
      if (i <= index) {
        throw new Error('next() called multiple times')
      }
      index = i

      const entry = middleware[i]
      if (!entry) {
        // 모든 미들웨어 통과 후 notFound
        return onNotFound?.(context) ?? context.notFound()
      }

      try {
        const result = await entry.fn(context, () => dispatch(i + 1))

        // Guard가 Response를 반환하면 체인 중단
        if (result instanceof Response) {
          return result
        }

        // 다음으로 진행
        return dispatch(i + 1)
      } catch (err) {
        if (onError) {
          return onError(err as Error, context)
        }
        throw err
      }
    }

    const result = await dispatch(0)
    return result ?? context.notFound()
  }
}
```

#### 예상 효과
- **이중 호출 방지**: `index` 추적으로 `next()` 중복 호출 감지
- **에러 처리 중앙화**: compose 레벨에서 통합 관리
- **Guard 조기 종료**: Response 반환 시 체인 즉시 중단

---

### 2.2 라이프사이클 훅 체계 (from Elysia)

#### Elysia의 라이프사이클
```typescript
// DNA/elysia/src/types.ts
interface LifeCycleStore {
  start: HookContainer[]      // 서버 시작
  request: HookContainer[]    // 요청 시작
  parse: HookContainer[]      // 바디 파싱
  transform: HookContainer[]  // 컨텍스트 변환
  beforeHandle: HookContainer[]  // 핸들러 전
  afterHandle: HookContainer[]   // 핸들러 후
  mapResponse: HookContainer[]   // 응답 변환
  afterResponse: HookContainer[] // 응답 후
  error: HookContainer[]         // 에러
  stop: HookContainer[]          // 서버 정지
}
```

#### 적용 코드
```typescript
// packages/core/src/runtime/lifecycle.ts (신규)
export type HookScope = 'global' | 'scoped' | 'local'

export interface HookContainer<T extends Function = Function> {
  fn: T
  scope: HookScope
  checksum?: number  // 중복 제거용
}

export interface ManduLifecycle {
  // 서버 레벨
  onStart: HookContainer<() => void | Promise<void>>[]
  onStop: HookContainer<() => void | Promise<void>>[]

  // 요청 레벨
  onRequest: HookContainer<(ctx: ManduContext) => void | Promise<void>>[]
  onParse: HookContainer<(ctx: ManduContext) => void | Promise<void>>[]

  // 핸들러 레벨
  beforeHandle: HookContainer<(ctx: ManduContext) => Response | void | Promise<Response | void>>[]
  afterHandle: HookContainer<(ctx: ManduContext, response: Response) => Response | Promise<Response>>[]

  // 응답 레벨
  mapResponse: HookContainer<(ctx: ManduContext, response: Response) => Response | Promise<Response>>[]
  afterResponse: HookContainer<(ctx: ManduContext) => void | Promise<void>>[]

  // 에러 레벨
  onError: HookContainer<(ctx: ManduContext, error: Error) => Response | void | Promise<Response | void>>[]
}

export const createLifecycle = (): ManduLifecycle => ({
  onStart: [],
  onStop: [],
  onRequest: [],
  onParse: [],
  beforeHandle: [],
  afterHandle: [],
  mapResponse: [],
  afterResponse: [],
  onError: [],
})

// 훅 실행 순서
export const executeLifecycle = async (
  lifecycle: ManduLifecycle,
  ctx: ManduContext,
  handler: () => Promise<Response>
): Promise<Response> => {
  // 1. onRequest
  for (const hook of lifecycle.onRequest) {
    await hook.fn(ctx)
  }

  // 2. onParse (바디가 있는 경우)
  if (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD') {
    for (const hook of lifecycle.onParse) {
      await hook.fn(ctx)
    }
  }

  // 3. beforeHandle (Guard 역할)
  for (const hook of lifecycle.beforeHandle) {
    const result = await hook.fn(ctx)
    if (result instanceof Response) {
      return result  // 조기 종료
    }
  }

  // 4. 핸들러 실행
  let response: Response
  try {
    response = await handler()
  } catch (err) {
    // onError 처리
    for (const hook of lifecycle.onError) {
      const result = await hook.fn(ctx, err as Error)
      if (result instanceof Response) {
        response = result
        break
      }
    }
    if (!response!) throw err
  }

  // 5. afterHandle
  for (const hook of lifecycle.afterHandle) {
    response = await hook.fn(ctx, response)
  }

  // 6. mapResponse
  for (const hook of lifecycle.mapResponse) {
    response = await hook.fn(ctx, response)
  }

  // 7. afterResponse (비동기, 응답 후 실행)
  queueMicrotask(async () => {
    for (const hook of lifecycle.afterResponse) {
      await hook.fn(ctx)
    }
  })

  return response
}
```

#### Mandu.filling() 확장
```typescript
// packages/core/src/filling/filling.ts 수정
export class ManduFilling<LoaderData = unknown> {
  private lifecycle: Partial<ManduLifecycle> = {}

  // 기존 메서드들...

  // 새로운 라이프사이클 훅
  onRequest(fn: (ctx: ManduContext) => void | Promise<void>) {
    this.lifecycle.onRequest ??= []
    this.lifecycle.onRequest.push({ fn, scope: 'local' })
    return this
  }

  beforeHandle(fn: (ctx: ManduContext) => Response | void | Promise<Response | void>) {
    this.lifecycle.beforeHandle ??= []
    this.lifecycle.beforeHandle.push({ fn, scope: 'local' })
    return this
  }

  afterHandle(fn: (ctx: ManduContext, res: Response) => Response | Promise<Response>) {
    this.lifecycle.afterHandle ??= []
    this.lifecycle.afterHandle.push({ fn, scope: 'local' })
    return this
  }

  onError(fn: (ctx: ManduContext, err: Error) => Response | void | Promise<Response | void>) {
    this.lifecycle.onError ??= []
    this.lifecycle.onError.push({ fn, scope: 'local' })
    return this
  }
}
```

---

### 2.3 아일랜드 Props 직렬화 개선 (from Fresh)

#### Fresh의 직렬화 방식
```typescript
// DNA/fresh/packages/fresh/src/runtime/server/preact_hooks.ts
// 지원 타입: 원시형, URL, Date, RegExp, Map, Set, Preact Signals
// 원형 참조 지원, JSX 전달 가능
```

#### 현재 mandu 상태
```typescript
// packages/core/src/client/island.ts
// 기본 JSON.stringify 사용
```

#### 적용 코드
```typescript
// packages/core/src/client/serialize.ts (신규)
type SerializableValue =
  | null
  | boolean
  | number
  | string
  | Date
  | URL
  | RegExp
  | Map<SerializableValue, SerializableValue>
  | Set<SerializableValue>
  | SerializableValue[]
  | { [key: string]: SerializableValue }

interface SerializeContext {
  seen: Map<object, number>  // 순환 참조 감지
  refs: object[]             // 참조 테이블
}

const TYPE_MARKERS = {
  DATE: '\x00D',
  URL: '\x00U',
  REGEXP: '\x00R',
  MAP: '\x00M',
  SET: '\x00S',
  REF: '\x00$',
  UNDEFINED: '\x00_',
  BIGINT: '\x00B',
  SIGNAL: '\x00G',
} as const

export const serializeProps = (props: Record<string, unknown>): string => {
  const ctx: SerializeContext = { seen: new Map(), refs: [] }

  const serialize = (value: unknown): unknown => {
    // 원시형
    if (value === null) return null
    if (value === undefined) return TYPE_MARKERS.UNDEFINED
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      return value
    }
    if (typeof value === 'bigint') {
      return TYPE_MARKERS.BIGINT + value.toString()
    }

    // 순환 참조 체크
    if (typeof value === 'object') {
      const existing = ctx.seen.get(value)
      if (existing !== undefined) {
        return TYPE_MARKERS.REF + existing
      }
      const idx = ctx.refs.length
      ctx.seen.set(value, idx)
      ctx.refs.push(value)
    }

    // 특수 타입
    if (value instanceof Date) {
      return TYPE_MARKERS.DATE + value.toISOString()
    }
    if (value instanceof URL) {
      return TYPE_MARKERS.URL + value.href
    }
    if (value instanceof RegExp) {
      return TYPE_MARKERS.REGEXP + value.toString()
    }
    if (value instanceof Map) {
      return [TYPE_MARKERS.MAP, ...Array.from(value.entries()).map(([k, v]) => [serialize(k), serialize(v)])]
    }
    if (value instanceof Set) {
      return [TYPE_MARKERS.SET, ...Array.from(value).map(serialize)]
    }

    // Signal (mandu 자체 Signal 지원)
    if (value && typeof value === 'object' && '__signal__' in value) {
      return TYPE_MARKERS.SIGNAL + serialize((value as any).value)
    }

    // 배열
    if (Array.isArray(value)) {
      return value.map(serialize)
    }

    // 일반 객체
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as object)) {
      result[k] = serialize(v)
    }
    return result
  }

  return JSON.stringify(serialize(props))
}

export const deserializeProps = (json: string): Record<string, unknown> => {
  const refs: unknown[] = []

  const deserialize = (value: unknown): unknown => {
    if (value === null) return null
    if (value === TYPE_MARKERS.UNDEFINED) return undefined

    if (typeof value === 'string') {
      // 타입 마커 체크
      if (value.startsWith(TYPE_MARKERS.DATE)) {
        return new Date(value.slice(2))
      }
      if (value.startsWith(TYPE_MARKERS.URL)) {
        return new URL(value.slice(2))
      }
      if (value.startsWith(TYPE_MARKERS.REGEXP)) {
        const match = value.slice(2).match(/^\/(.*)\/([gimsuy]*)$/)
        return match ? new RegExp(match[1], match[2]) : value
      }
      if (value.startsWith(TYPE_MARKERS.REF)) {
        return refs[parseInt(value.slice(2))]
      }
      if (value.startsWith(TYPE_MARKERS.BIGINT)) {
        return BigInt(value.slice(2))
      }
      if (value.startsWith(TYPE_MARKERS.SIGNAL)) {
        return { __signal__: true, value: deserialize(value.slice(2)) }
      }
      return value
    }

    if (Array.isArray(value)) {
      // Map/Set 마커 체크
      if (value[0] === TYPE_MARKERS.MAP) {
        const map = new Map()
        refs.push(map)
        for (let i = 1; i < value.length; i++) {
          const [k, v] = value[i] as [unknown, unknown]
          map.set(deserialize(k), deserialize(v))
        }
        return map
      }
      if (value[0] === TYPE_MARKERS.SET) {
        const set = new Set()
        refs.push(set)
        for (let i = 1; i < value.length; i++) {
          set.add(deserialize(value[i]))
        }
        return set
      }

      const arr: unknown[] = []
      refs.push(arr)
      for (const item of value) {
        arr.push(deserialize(item))
      }
      return arr
    }

    if (typeof value === 'object') {
      const obj: Record<string, unknown> = {}
      refs.push(obj)
      for (const [k, v] of Object.entries(value)) {
        obj[k] = deserialize(v)
      }
      return obj
    }

    return value
  }

  return deserialize(JSON.parse(json)) as Record<string, unknown>
}
```

---

### 2.4 타입 안전성 강화 (from Elysia)

#### Elysia의 타입 추론 패턴
```typescript
// DNA/elysia/src/types.ts
// TypeBox 기반 스키마 → 타입 자동 추론
export type UnwrapSchema<Schema> = Schema extends TSchema
  ? TImport<Schema>['static']
  : unknown
```

#### 적용: Contract 기반 타입 추론
```typescript
// packages/core/src/contract/infer.ts (신규)
import { z } from 'zod'

// Contract 정의에서 타입 추론
export type InferContractInput<T extends ContractDefinition> =
  T['request'] extends z.ZodType ? z.infer<T['request']> : never

export type InferContractOutput<T extends ContractDefinition> =
  T['response'] extends z.ZodType ? z.infer<T['response']> : never

// Handler에 타입 바인딩
export type TypedHandler<C extends ContractDefinition> = (
  ctx: ManduContext<{
    body: InferContractInput<C>
    response: InferContractOutput<C>
  }>
) => Promise<InferContractOutput<C>> | InferContractOutput<C>

// 사용 예시
const userContract = {
  request: z.object({
    name: z.string(),
    email: z.string().email(),
  }),
  response: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
} satisfies ContractDefinition

// 자동 타입 추론
export default Mandu.filling<typeof userContract>()
  .contract(userContract)
  .post(async (ctx) => {
    // ctx.body는 { name: string, email: string }으로 추론
    const { name, email } = await ctx.body()

    // 반환 타입도 { id: string, name: string, email: string }으로 강제
    return ctx.ok({
      id: crypto.randomUUID(),
      name,
      email,
    })
  })
```

---

### 2.5 콘텐츠 로더 시스템 (from Astro)

#### Astro의 로더 패턴
```typescript
// DNA/astro/src/content/loaders/types.ts
interface Loader {
  name: string
  load: (context: LoaderContext) => Promise<void>
  schema?: ZodSchema
}
```

#### 적용: 데이터 소스 통합
```typescript
// packages/core/src/loader/types.ts (신규)
import { z } from 'zod'

export interface LoaderContext {
  store: DataStore
  logger: Logger
  parseData: <T>(entry: RawEntry) => Promise<T>
  generateId: (entry: RawEntry) => string
}

export interface Loader<T = unknown> {
  name: string
  schema?: z.ZodType<T>
  load: (context: LoaderContext) => Promise<void>
}

export interface DataStore {
  set: (entry: { id: string; data: unknown }) => void
  get: (id: string) => unknown | undefined
  has: (id: string) => boolean
  delete: (id: string) => boolean
  clear: () => void
  entries: () => IterableIterator<[string, unknown]>
}

// packages/core/src/loader/loaders/file-loader.ts (신규)
export const fileLoader = (options: {
  pattern: string
  parser?: (content: string) => unknown
}): Loader => ({
  name: '@mandu/file-loader',

  async load(ctx) {
    const files = await glob(options.pattern)

    for (const file of files) {
      const content = await Bun.file(file).text()
      const data = options.parser?.(content) ?? JSON.parse(content)
      const id = ctx.generateId({ filePath: file, data })

      const parsed = await ctx.parseData({ id, data, filePath: file })
      ctx.store.set({ id, data: parsed })
    }
  }
})

// packages/core/src/loader/loaders/api-loader.ts (신규)
export const apiLoader = <T>(options: {
  url: string
  transform?: (response: unknown) => T[]
  idField?: string
}): Loader<T> => ({
  name: '@mandu/api-loader',

  async load(ctx) {
    const response = await fetch(options.url)
    const raw = await response.json()
    const items = options.transform?.(raw) ?? raw

    for (const item of items) {
      const id = (item as any)[options.idField ?? 'id']
      const parsed = await ctx.parseData({ id, data: item, filePath: options.url })
      ctx.store.set({ id, data: parsed })
    }
  }
})
```

---

### 2.6 Resumable 패턴 검토 (from Qwik)

#### Qwik의 핵심 개념
```
전통적 SSR: 서버 렌더링 → 클라이언트 전체 리하이드레이션
Qwik Resumable: 서버 상태 Pause → 클라이언트에서 필요시 Resume
```

#### mandu 적용 가능성 분석

**현재 mandu 아일랜드 방식:**
- 전략: `island` | `full` | `none` | `progressive`
- 우선순위: `immediate` | `visible` | `idle` | `interaction`

**Qwik 방식의 장점:**
- Zero JS 전송 가능 (이벤트 발생 전까지)
- 함수 단위 지연 로딩 (QRL)
- 상태 완전 직렬화/역직렬화

**적용 검토:**
```typescript
// packages/core/src/client/resumable.ts (실험적)

// Qwik의 QRL 개념 단순화
type ManduQRL = `${string}#${string}[${string}]`

export const createQRL = (
  chunk: string,
  symbol: string,
  captures: string[] = []
): ManduQRL => {
  return `${chunk}#${symbol}[${captures.join(' ')}]`
}

export const parseQRL = (qrl: ManduQRL) => {
  const [chunk, rest] = qrl.split('#')
  const [symbol, captureStr] = rest.split('[')
  const captures = captureStr.slice(0, -1).split(' ').filter(Boolean)
  return { chunk, symbol, captures }
}

// 이벤트 핸들러 지연 로딩
export const qrlHandler = async (
  qrl: ManduQRL,
  event: Event,
  containerState: ContainerState
) => {
  const { chunk, symbol, captures } = parseQRL(qrl)

  // 1. 청크 로드
  const module = await import(/* @vite-ignore */ chunk)

  // 2. 심볼 추출
  const handler = module[symbol]

  // 3. 캡처 복원
  const capturedValues = captures.map(id => containerState.getObject(id))

  // 4. 핸들러 실행
  return handler(event, ...capturedValues)
}
```

**결론:** Qwik의 완전한 Resumable은 복잡도가 높아 Phase 3+ 검토 대상. 현재는 아일랜드 방식 유지하되, props 직렬화 개선에 집중.

---

## 3. 구현 로드맵

### Phase 1: 기반 개선 (1-2주)

| 작업 | 소스 | 파일 | 우선순위 |
|------|-----|------|---------|
| 미들웨어 compose 패턴 | Hono | `runtime/compose.ts` | P0 |
| 라이프사이클 훅 체계 | Elysia | `runtime/lifecycle.ts` | P0 |
| Props 직렬화 개선 | Fresh | `client/serialize.ts` | P1 |

```
✅ 구현 완료 기준:
- compose 패턴이 기존 Guard + Handler를 대체
- 라이프사이클 훅이 Mandu.filling()에 통합
- 아일랜드 props가 Date, Map, Set 등 지원
```

### Phase 2: 타입 강화 (2-3주)

| 작업 | 소스 | 파일 | 우선순위 |
|------|-----|------|---------|
| Contract 타입 추론 | Elysia | `contract/infer.ts` | P1 |
| 응답 타입 정밀화 | Hono | `filling/types.ts` | P1 |
| Context 제네릭 확장 | Hono | `filling/context.ts` | P2 |

```
✅ 구현 완료 기준:
- Contract 정의에서 입출력 타입 자동 추론
- ctx.ok(), ctx.created() 등에 타입 바인딩
- 개발 시 IDE 자동완성 지원
```

### Phase 3: 데이터 계층 (3-4주)

| 작업 | 소스 | 파일 | 우선순위 |
|------|-----|------|---------|
| Loader 인터페이스 | Astro | `loader/types.ts` | P2 |
| File Loader | Astro | `loader/loaders/file-loader.ts` | P2 |
| API Loader | Astro | `loader/loaders/api-loader.ts` | P2 |
| DataStore 구현 | Astro | `loader/store.ts` | P2 |

```
✅ 구현 완료 기준:
- Loader 인터페이스로 다양한 데이터 소스 통합
- 빌드 타임 데이터 수집 및 검증
- 타입 안전한 데이터 접근
```

### Phase 4: 빌드 최적화 (4-5주)

| 작업 | 소스 | 파일 | 우선순위 |
|------|-----|------|---------|
| 빌드 훅 체계 | Astro | `bundler/hooks.ts` | P2 |
| 플러그인 시스템 | Astro | `bundler/plugins.ts` | P3 |
| 번들 분석 | Fresh | `bundler/analyze.ts` | P3 |

```
✅ 구현 완료 기준:
- 빌드 단계별 훅 (start, setup, done)
- 플러그인으로 기능 확장 가능
- 번들 크기 및 의존성 리포트
```

### Phase 5: 고급 기능 (향후)

| 작업 | 소스 | 검토 시기 |
|------|-----|---------|
| Resumable 아키텍처 | Qwik | v1.0 이후 |
| QRL 시스템 | Qwik | v1.0 이후 |
| 실시간 채널 | Phoenix | WebSocket 플랫폼 추가 시 |
| SmartRouter | Hono | 성능 이슈 발생 시 |

---

## 4. 파일 구조 변경안

```
packages/core/src/
├── runtime/
│   ├── server.ts          # 기존
│   ├── router.ts          # 기존
│   ├── ssr.ts             # 기존
│   ├── compose.ts         # 신규 (Hono)
│   └── lifecycle.ts       # 신규 (Elysia)
│
├── filling/
│   ├── filling.ts         # 수정 (라이프사이클 통합)
│   ├── context.ts         # 수정 (제네릭 확장)
│   └── types.ts           # 수정 (타입 정밀화)
│
├── contract/
│   ├── schema.ts          # 기존
│   ├── validator.ts       # 기존
│   └── infer.ts           # 신규 (타입 추론)
│
├── client/
│   ├── island.ts          # 기존
│   ├── runtime.ts         # 기존
│   └── serialize.ts       # 신규 (Fresh 직렬화)
│
├── loader/                # 신규 디렉토리
│   ├── types.ts           # Loader 인터페이스
│   ├── store.ts           # DataStore 구현
│   └── loaders/
│       ├── file-loader.ts
│       └── api-loader.ts
│
└── bundler/
    ├── build.ts           # 기존
    ├── dev.ts             # 기존
    ├── hooks.ts           # 신규 (빌드 훅)
    └── plugins.ts         # 신규 (플러그인)
```

---

## 5. 테스트 계획

### 5.1 단위 테스트

```typescript
// tests/compose.test.ts
import { describe, test, expect } from 'bun:test'
import { compose } from '../packages/core/src/runtime/compose'

describe('compose', () => {
  test('미들웨어 순차 실행', async () => {
    const order: number[] = []

    const middleware = [
      { fn: async (ctx, next) => { order.push(1); await next() }, type: 'guard' },
      { fn: async (ctx, next) => { order.push(2); await next() }, type: 'handler' },
    ]

    const handler = compose(middleware)
    await handler(mockContext)

    expect(order).toEqual([1, 2])
  })

  test('next() 이중 호출 감지', async () => {
    const middleware = [
      { fn: async (ctx, next) => { await next(); await next() }, type: 'guard' },
    ]

    const handler = compose(middleware)

    expect(handler(mockContext)).rejects.toThrow('next() called multiple times')
  })

  test('Guard가 Response 반환 시 체인 중단', async () => {
    const middleware = [
      { fn: async (ctx) => new Response('Unauthorized', { status: 401 }), type: 'guard' },
      { fn: async (ctx) => new Response('OK'), type: 'handler' },  // 실행 안 됨
    ]

    const handler = compose(middleware)
    const response = await handler(mockContext)

    expect(response.status).toBe(401)
  })
})
```

### 5.2 통합 테스트

```typescript
// tests/lifecycle.test.ts
import { describe, test, expect } from 'bun:test'
import { Mandu } from '../packages/core/src'

describe('lifecycle hooks', () => {
  test('전체 라이프사이클 실행 순서', async () => {
    const order: string[] = []

    const filling = Mandu.filling()
      .onRequest(() => order.push('request'))
      .beforeHandle(() => order.push('beforeHandle'))
      .get(() => {
        order.push('handler')
        return { ok: true }
      })
      .afterHandle((ctx, res) => {
        order.push('afterHandle')
        return res
      })

    const response = await filling.handle(mockRequest)

    expect(order).toEqual(['request', 'beforeHandle', 'handler', 'afterHandle'])
  })
})
```

### 5.3 직렬화 테스트

```typescript
// tests/serialize.test.ts
import { describe, test, expect } from 'bun:test'
import { serializeProps, deserializeProps } from '../packages/core/src/client/serialize'

describe('props serialization', () => {
  test('Date 직렬화/역직렬화', () => {
    const original = { date: new Date('2025-01-28') }
    const serialized = serializeProps(original)
    const deserialized = deserializeProps(serialized)

    expect(deserialized.date).toBeInstanceOf(Date)
    expect((deserialized.date as Date).toISOString()).toBe('2025-01-28T00:00:00.000Z')
  })

  test('Map 직렬화/역직렬화', () => {
    const original = { map: new Map([['key', 'value']]) }
    const serialized = serializeProps(original)
    const deserialized = deserializeProps(serialized)

    expect(deserialized.map).toBeInstanceOf(Map)
    expect((deserialized.map as Map<string, string>).get('key')).toBe('value')
  })

  test('순환 참조 처리', () => {
    const obj: any = { name: 'test' }
    obj.self = obj

    const serialized = serializeProps({ obj })
    const deserialized = deserializeProps(serialized)

    expect((deserialized.obj as any).self).toBe(deserialized.obj)
  })
})
```

---

## 6. 마이그레이션 가이드

### 6.1 기존 Guard → 라이프사이클 훅

**Before:**
```typescript
export default Mandu.filling()
  .guard(async (ctx) => {
    if (!ctx.user) return ctx.unauthorized()
    return ctx.next()
  })
  .get((ctx) => ctx.ok({ data: 'hello' }))
```

**After:**
```typescript
export default Mandu.filling()
  .beforeHandle(async (ctx) => {
    if (!ctx.user) return ctx.unauthorized()
    // void 반환 시 자동으로 next()
  })
  .get((ctx) => ctx.ok({ data: 'hello' }))
```

### 6.2 기존 에러 핸들링 → onError 훅

**Before:**
```typescript
try {
  const result = await handler(ctx)
} catch (err) {
  ctx.error = err
  return ctx.internalServerError()
}
```

**After:**
```typescript
export default Mandu.filling()
  .onError((ctx, err) => {
    console.error(err)
    return ctx.json({ error: err.message }, 500)
  })
  .get(async (ctx) => {
    throw new Error('Something went wrong')
  })
```

---

## 7. 참조 파일 목록

### Hono
- `DNA/hono/src/compose.ts` - 미들웨어 조합
- `DNA/hono/src/hono-base.ts` - 라우팅/핸들러
- `DNA/hono/src/context.ts` - 컨텍스트 인터페이스
- `DNA/hono/src/router/smart-router/router.ts` - SmartRouter

### Elysia
- `DNA/elysia/src/types.ts` - 라이프사이클, 타입
- `DNA/elysia/src/schema.ts` - 스키마 검증
- `DNA/elysia/src/index.ts` - 플러그인 시스템

### Fresh
- `DNA/fresh/packages/fresh/src/context.ts` - 아일랜드
- `DNA/fresh/packages/fresh/src/runtime/server/preact_hooks.ts` - RenderState
- `DNA/fresh/packages/fresh/src/runtime/client/reviver.ts` - 하이드레이션

### Astro
- `DNA/astro/packages/astro/src/content/loaders/types.ts` - Loader
- `DNA/astro/packages/astro/src/integrations/hooks.ts` - 통합 훅
- `DNA/astro/packages/astro/src/core/build/pipeline.ts` - 빌드 파이프라인

### Qwik
- `DNA/qwik/packages/qwik/src/core/container/pause.ts` - Pause
- `DNA/qwik/packages/qwik/src/core/container/resume.ts` - Resume
- `DNA/qwik/packages/qwik/src/core/qrl/qrl-class.ts` - QRL
- `DNA/qwik/packages/qwik/src/core/container/serializers.ts` - 직렬화

---

## 8. 결론

### 즉시 적용 (Quick Wins)
1. **Hono compose 패턴** → 미들웨어 체인 안정성 향상
2. **Elysia 라이프사이클** → 명확한 요청 처리 단계
3. **Fresh 직렬화** → 아일랜드 props 타입 확장

### 중기 목표
1. **E2E 타입 안전성** → Contract 기반 자동 타입 추론
2. **콘텐츠 로더** → 다양한 데이터 소스 통합
3. **빌드 최적화** → 플러그인 기반 확장성

### 장기 비전
1. **Resumable 검토** → 진정한 Zero-JS 초기 로드
2. **실시간 기능** → WebSocket 플랫폼 확장

---

> **작성일**: 2026-01-28
> **버전**: 1.0
> **다음 리뷰**: Phase 1 완료 후
