# Mandu Framework Roadmap v1.0

> 6대 프레임워크(Next.js, Astro, Remix, Hono, SvelteKit, Nuxt) 전문가 분석 기반 개선 로드맵
> 
> 기반: **Bun + React** | 날짜: 2026-04-11

> 상태 업데이트 (2026-04-12):
> - `adapter` 설정과 `adapter.build()` 훅은 현재 구현되어 `mandu.config.ts`와 `mandu build`에서 동작한다.
> - `Route-level ErrorBoundary`, `shouldRevalidate()`, `Cookie/Session Storage`, `useHead/useSeoMeta`는 이미 코드에 반영되었다.
> - 테스트 유틸은 `testFilling`, `createTestRequest`, `createTestContext`가 우선 제공되며, `testApp`은 후순위로 유지한다.
> - Content API는 `defineContentConfig()`를 기본으로 쓰고, `defineCollection()` alias를 함께 제공한다.
> - `Image`는 루트 export와 `placeholder="blur"`를 지원한다.

---

## 목차

- [Phase 1: 즉시 — 프로덕션 배포 가능 수준](#phase-1-즉시--프로덕션-배포-가능-수준)
- [Phase 2: Mutation 해결](#phase-2-mutation-해결)
- [Phase 3: 캐싱 / 렌더링 전략](#phase-3-캐싱--렌더링-전략)
- [Phase 4: 배포 유연성](#phase-4-배포-유연성)
- [Phase 5: DX 혁신](#phase-5-dx-혁신)
- [Phase 6: 장기 차별화](#phase-6-장기-차별화)

---

## Phase 1: 즉시 — 프로덕션 배포 가능 수준

### 1-1. navigate()에 AbortController 추가

**문제**: 빠른 연속 네비게이션 시 이전 fetch가 취소되지 않아 응답 순서가 뒤바뀌면 잘못된 데이터가 렌더링됨 (Remix 전문가 P0 지적)

**수정 파일**: `packages/core/src/client/router.ts`

**구현**:

```typescript
// 모듈 레벨에 추가
let activeNavigationController: AbortController | null = null;

async function navigate(to: string, options?: NavigateOptions): Promise<void> {
  // 이전 네비게이션 취소
  if (activeNavigationController) {
    activeNavigationController.abort();
  }
  const controller = new AbortController();
  activeNavigationController = controller;

  try {
    // 기존 navigation.state = "loading" 로직...
    
    const response = await fetch(`${pathname}?_data=1`, {
      signal: controller.signal,  // ← 추가
    });

    // abort된 경우 조용히 종료
    if (controller.signal.aborted) return;
    
    // 기존 로직...
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return; // 취소된 네비게이션은 무시
    }
    // 기존 에러 처리...
  } finally {
    if (activeNavigationController === controller) {
      activeNavigationController = null;
    }
  }
}
```

**난이도**: 하 (1일) | **영향도**: 높음 — race condition 버그 원천 차단

---

### 1-2. Zero-JS 모드 (Island 없는 페이지에서 번들 제거)

**문제**: island이 없는 순수 정적 페이지에서도 Runtime/Vendor JS 번들이 포함됨 (Astro 전문가 P1 지적)

**수정 파일**: `packages/core/src/runtime/ssr.ts`, `packages/core/src/runtime/streaming-ssr.ts`

**현재 동작**: `renderToHTML()`이 `needsHydration(route)`과 무관하게 hydration 스크립트/번들을 항상 삽입

**구현**:

```typescript
// ssr.ts — renderToHTML 수정
function renderToHTML(element: ReactElement, options: SSROptions): string {
  const html = getRenderToString()(element);
  
  // island 없는 페이지: 순수 HTML만 반환
  const hasIslands = options.hydration?.strategy !== 'none' 
    && options.bundleManifest 
    && options.routeId;
  
  if (!hasIslands) {
    return buildHTMLDocument({
      lang: options.lang,
      title: options.title,
      headTags: options.headTags,
      cssPath: options.cssPath,
      body: html,
      bodyEndTags: options.bodyEndTags,
      // hydrationScripts: 없음
      // serverDataScript: 없음
      // vendorPreload: 없음
      // runtimeScript: 없음
    });
  }
  
  // 기존 hydration 로직...
}
```

**`streaming-ssr.ts`도 동일 패턴 적용**: `htmlTail` 생성 시 `hasIslands` 분기

**결과**:
- island 없는 페이지: HTML + CSS만 전송 (0 KB JS)
- island 있는 페이지: 기존과 동일

**난이도**: 중-하 (2-3일) | **영향도**: 극대 — 정적 페이지 LCP/TTI 극적 개선

---

### 1-3. 정적 파일 ETag / 304 지원

**문제**: 정적 파일 서빙에 ETag/conditional request 처리 없음 (Hono 전문가 지적)

**수정 파일**: `packages/core/src/runtime/server.ts`

**구현**:

```typescript
// server.ts — 정적 파일 핸들러 수정

function generateETag(file: BunFile): string {
  // weak ETag: 파일 크기 + 마지막 수정 시간
  return `W/"${file.size}-${file.lastModified}"`;
}

async function serveStaticFile(
  request: Request,
  filePath: string,
  isDev: boolean
): Promise<Response | null> {
  const file = Bun.file(filePath);
  if (!await file.exists()) return null;
  
  const etag = generateETag(file);
  const ifNoneMatch = request.headers.get("If-None-Match");
  
  // 304 Not Modified
  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: { "ETag": etag },
    });
  }
  
  const headers: Record<string, string> = {
    "Content-Type": getMimeType(filePath),
    "ETag": etag,
  };
  
  // 프로덕션: 해시된 번들은 immutable 캐시
  if (!isDev && filePath.includes(".mandu/client/")) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  } else if (!isDev) {
    headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400";
  }
  
  return new Response(file, { headers });
}
```

**난이도**: 하 (1일) | **영향도**: 중 — 반복 방문 시 네트워크 절약

---

## Phase 2: Mutation 해결

### 2-1. filling.action() + 자동 Revalidation

**문제**: POST 후 데이터 재로딩을 클라이언트가 수동 처리해야 함. action/loader revalidation 패턴 부재 (Remix P0, SvelteKit P1 지적)

**수정 파일**: `packages/core/src/filling/filling.ts`, `packages/core/src/filling/context.ts`

**API 설계**:

```typescript
// 사용자 코드 — app/api/todos/route.ts
export default Mandu.filling()
  .loader(async (ctx) => {
    return { todos: await db.getTodos() };
  })
  .action("create", async (ctx) => {
    const { title } = await ctx.body<{ title: string }>();
    await db.createTodo(title);
    // action 완료 후 같은 라우트의 loader가 자동 재실행됨
  })
  .action("delete", async (ctx) => {
    const { id } = await ctx.body<{ id: string }>();
    await db.deleteTodo(id);
  })
  .get((ctx) => ctx.ok({ message: "todos page" }))
  .post((ctx) => ctx.ok({ message: "fallback post" }));
```

**ManduFilling 확장**:

```typescript
class ManduFilling<TLoaderData> {
  // 기존 필드
  private actions = new Map<string, Handler>();
  
  // action 등록 — 이름 기반 디스패치
  action(name: string, handler: Handler): this {
    this.actions.set(name, handler);
    return this;
  }
  
  // handle() 수정 — POST 요청에서 _action 파라미터로 디스패치
  async handle(request: Request, params?: Record<string, string>, ...): Promise<Response> {
    // ... 기존 라이프사이클 ...
    
    if (request.method === "POST" && this.actions.size > 0) {
      const actionName = await this.resolveActionName(request);
      const actionHandler = this.actions.get(actionName);
      
      if (actionHandler) {
        const ctx = new ManduContext(request, params);
        const actionResponse = await actionHandler(ctx);
        
        // action 성공 후: loader 재실행 + revalidation 응답
        if (actionResponse.ok && this.hasLoader()) {
          const freshData = await this.executeLoader(ctx);
          return ctx.json({
            _action: actionName,
            _revalidated: true,
            loaderData: freshData,
          });
        }
        
        return actionResponse;
      }
    }
    
    // 기존 메서드별 핸들러 실행...
  }
  
  private async resolveActionName(request: Request): string {
    // 1. URL search param: ?_action=create
    const url = new URL(request.url);
    const fromQuery = url.searchParams.get("_action");
    if (fromQuery) return fromQuery;
    
    // 2. Form hidden field: <input name="_action" value="create">
    // 3. JSON body: { _action: "create", ... }
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.clone().json();
      return body._action ?? "default";
    }
    if (contentType.includes("form")) {
      const formData = await request.clone().formData();
      return formData.get("_action")?.toString() ?? "default";
    }
    
    return "default";
  }
}
```

**클라이언트 연동** (`client/router.ts` 수정):

```typescript
// action 응답에 _revalidated 플래그가 있으면 loaderData 자동 갱신
async function submitAction(
  url: string,
  data: FormData | Record<string, unknown>,
  actionName: string
): Promise<{ ok: boolean; loaderData?: unknown }> {
  const body = data instanceof FormData ? data : JSON.stringify({ _action: actionName, ...data });
  const headers: Record<string, string> = {};
  if (!(data instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  
  const response = await fetch(url, { method: "POST", body, headers });
  const result = await response.json();
  
  if (result._revalidated && result.loaderData) {
    // 전역 상태 갱신 → 구독자들에게 알림
    updateLoaderData(result.loaderData);
    notifyListeners();
  }
  
  return { ok: response.ok, loaderData: result.loaderData };
}
```

**난이도**: 중 (1주) | **영향도**: 극대 — mutation 워크플로우의 근본 해결

---

### 2-2. `<Form>` 컴포넌트 (Progressive Enhancement)

**문제**: JS 없이 form 동작 불가 (Remix/SvelteKit 공통 지적)

**신규 파일**: `packages/core/src/client/components/Form.tsx`
**수정 파일**: `packages/core/src/client/index.ts` (re-export)

**API 설계**:

```tsx
// 사용자 코드
import { Form } from "@mandujs/core/client";

function TodoForm() {
  return (
    <Form action="/api/todos" actionName="create" onSuccess={(data) => {
      // loaderData가 자동 갱신된 후 호출
      console.log("Created!", data);
    }}>
      <input name="title" required />
      <button type="submit">추가</button>
    </Form>
  );
}
```

**구현**:

```tsx
interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  action: string;
  actionName?: string;
  method?: "post" | "put" | "patch" | "delete";
  /** JS 환경에서 fetch 방식으로 전환 (기본: true) */
  enhance?: boolean;
  /** action 성공 후 콜백 */
  onSuccess?: (data: unknown) => void;
  /** action 실패 후 콜백 */
  onError?: (error: Error) => void;
  /** 제출 중 상태 */
  children: React.ReactNode | ((state: FormState) => React.ReactNode);
}

interface FormState {
  submitting: boolean;
  error: string | null;
}

export function Form({
  action,
  actionName = "default",
  method = "post",
  enhance = true,
  onSuccess,
  onError,
  children,
  ...rest
}: FormProps) {
  const [state, setState] = useState<FormState>({ submitting: false, error: null });
  
  const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    if (!enhance) return; // 기본 form 동작 유지 (Progressive Enhancement)
    
    e.preventDefault();
    setState({ submitting: true, error: null });
    
    try {
      const formData = new FormData(e.currentTarget);
      formData.set("_action", actionName);
      
      const result = await submitAction(action, formData, actionName);
      
      if (result.ok) {
        onSuccess?.(result.loaderData);
      } else {
        throw new Error("Action failed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "요청 실패";
      setState(prev => ({ ...prev, error: message }));
      onError?.(error instanceof Error ? error : new Error(message));
    } finally {
      setState(prev => ({ ...prev, submitting: false }));
    }
  }, [action, actionName, enhance, onSuccess, onError]);
  
  return (
    <form action={action} method={method} onSubmit={handleSubmit} {...rest}>
      <input type="hidden" name="_action" value={actionName} />
      {typeof children === "function" ? children(state) : children}
    </form>
  );
}
```

**Progressive Enhancement 보장**:
- JS 꺼짐 → 일반 HTML form POST → 서버에서 `_action` hidden field 읽음 → 응답 (리다이렉트 or HTML)
- JS 켜짐 → `onSubmit` 가로채서 fetch → loaderData 자동 갱신 → SPA 유지

**난이도**: 중-하 (3-4일) | **영향도**: 높음

---

### 2-3. `useMandu()` — 클라이언트 라우트 상태 훅

**문제**: 클라이언트에서 현재 라우트 정보에 접근하는 표준 방법 없음. `window.__MANDU_DATA__` 직접 접근 필요 (SvelteKit 전문가 지적)

**현재**: `useRouter`, `useParams` 등 개별 훅이 이미 있으나 통합 인터페이스 부재

**신규 파일**: `packages/core/src/client/hooks/useMandu.ts`

**API 설계**:

```typescript
interface ManduState {
  // 라우트 정보
  url: URL;
  params: Record<string, string>;
  routeId: string;
  pattern: string;
  
  // 데이터
  loaderData: unknown;
  actionData: unknown;     // 마지막 action 결과
  
  // 네비게이션 상태
  navigation: {
    state: "idle" | "loading" | "submitting";
    location?: string;
    formAction?: string;    // 현재 제출 중인 action URL
    formMethod?: string;
  };
  
  // 에러
  error: Error | null;
}

function useMandu(): ManduState {
  const router = useRouterState();      // 기존 훅 활용
  const params = useParams();
  const loaderData = useLoaderData();
  const navigation = useNavigation();
  const [actionData, setActionData] = useState(null);
  const [error, setError] = useState(null);
  
  // actionData 전역 구독
  useEffect(() => {
    return subscribeActionData((data) => setActionData(data));
  }, []);
  
  return useMemo(() => ({
    url: new URL(window.location.href),
    params: params ?? {},
    routeId: router.currentRoute?.id ?? "",
    pattern: router.currentRoute?.pattern ?? "",
    loaderData,
    actionData,
    navigation: {
      state: navigation.state,
      location: navigation.location,
    },
    error,
  }), [router, params, loaderData, actionData, navigation, error]);
}
```

**내보내기**: `packages/core/src/client/index.ts`에 `useMandu` 추가

**난이도**: 하 (2-3일) | **영향도**: 중 — DX 즉시 개선

---

## Phase 3: 캐싱 / 렌더링 전략

### 3-1. ISR + 시간 기반 Revalidation

**문제**: 매 요청마다 SSR 수행, 프로덕션 성능에 치명적 (Next.js 전문가 P1 지적)

**수정 파일**: `packages/core/src/filling/filling.ts`, `packages/core/src/runtime/server.ts`, `packages/core/src/runtime/cache.ts` (신규)

**API 설계**:

```typescript
// 사용자 코드 — 시간 기반 ISR
export default Mandu.filling()
  .loader(async (ctx) => {
    const posts = await db.getPosts();
    return { posts };
  }, {
    revalidate: 60,         // 60초 후 stale → 백그라운드 재생성
    fallback: "stale",      // stale 상태에서 이전 캐시 반환 (vs "blocking")
  })
  .get((ctx) => ctx.ok({}));
```

```typescript
// 사용자 코드 — 온디맨드 revalidation
import { revalidatePath, revalidateTag } from "@mandujs/core";

export default Mandu.filling()
  .loader(async (ctx) => {
    return { posts: await db.getPosts() };
  }, {
    revalidate: 3600,
    tags: ["posts"],        // 태그 기반 무효화
  })
  .action("create", async (ctx) => {
    await db.createPost(/* ... */);
    revalidateTag("posts");   // "posts" 태그 캐시 즉시 무효화
  });
```

**캐시 레이어** (`packages/core/src/runtime/cache.ts` 신규):

```typescript
interface CacheEntry {
  html: string;                // 렌더링된 HTML
  loaderData: unknown;         // 직렬화된 데이터
  createdAt: number;           // 생성 시간 (ms)
  revalidateAfter: number;     // stale이 되는 시간 (ms)
  tags: string[];              // 무효화 태그
  headers: Record<string, string>;
}

type CacheStatus = "HIT" | "STALE" | "MISS";

interface CacheStore {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByTag(tag: string): Promise<void>;
  clear(): Promise<void>;
}

// 기본: 메모리 캐시 (LRU)
class MemoryCacheStore implements CacheStore {
  private cache = new Map<string, CacheEntry>();
  private tagIndex = new Map<string, Set<string>>();  // tag → cache keys
  private maxEntries: number;
  
  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = options?.maxEntries ?? 1000;
  }
  
  async get(key: string): Promise<CacheEntry | null> {
    return this.cache.get(key) ?? null;
  }
  
  async set(key: string, entry: CacheEntry): Promise<void> {
    // LRU eviction
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.delete(oldest);
    }
    this.cache.set(key, entry);
    for (const tag of entry.tags) {
      if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
      this.tagIndex.get(tag)!.add(key);
    }
  }
  
  async delete(key: string): Promise<void> {
    const entry = this.cache.get(key);
    if (entry) {
      for (const tag of entry.tags) {
        this.tagIndex.get(tag)?.delete(key);
      }
    }
    this.cache.delete(key);
  }
  
  async deleteByTag(tag: string): Promise<void> {
    const keys = this.tagIndex.get(tag);
    if (keys) {
      for (const key of keys) this.cache.delete(key);
      this.tagIndex.delete(tag);
    }
  }
  
  async clear(): Promise<void> {
    this.cache.clear();
    this.tagIndex.clear();
  }
}
```

**서버 통합** (`server.ts` 수정):

```typescript
// handleRequest에서 페이지 렌더링 전 캐시 확인
async function handlePageRequest(
  request: Request,
  route: RouteSpec,
  params: Record<string, string>,
  registry: ServerRegistry,
  cache: CacheStore,
  options: ServerOptions
): Promise<Response> {
  const cacheKey = `${route.id}:${new URL(request.url).pathname}`;
  const cached = await cache.get(cacheKey);
  
  if (cached) {
    const age = Date.now() - cached.createdAt;
    
    if (age < cached.revalidateAfter) {
      // FRESH — 캐시 반환
      return new Response(cached.html, {
        headers: {
          ...cached.headers,
          "X-Mandu-Cache": "HIT",
          "Age": String(Math.floor(age / 1000)),
        },
      });
    }
    
    // STALE — 이전 캐시 반환 + 백그라운드 재생성
    queueMicrotask(() => {
      regenerateAndCache(route, params, registry, cache, cacheKey, options);
    });
    
    return new Response(cached.html, {
      headers: {
        ...cached.headers,
        "X-Mandu-Cache": "STALE",
        "Age": String(Math.floor(age / 1000)),
      },
    });
  }
  
  // MISS — 렌더링 + 캐싱
  return await regenerateAndCache(route, params, registry, cache, cacheKey, options);
}
```

**`revalidatePath` / `revalidateTag` API**:

```typescript
// packages/core/src/runtime/cache.ts
let globalCache: CacheStore | null = null;

export function setCacheStore(store: CacheStore): void {
  globalCache = store;
}

export async function revalidatePath(path: string): Promise<void> {
  if (!globalCache) return;
  // path → 해당 라우트의 모든 캐시 키 삭제
  await globalCache.delete(path);
}

export async function revalidateTag(tag: string): Promise<void> {
  if (!globalCache) return;
  await globalCache.deleteByTag(tag);
}
```

**LoaderOptions 확장**:

```typescript
interface LoaderOptions<T> {
  timeout?: number;
  fallback?: T;
  // 신규
  revalidate?: number;       // 초 단위 (0 = 캐시 안 함, Infinity = 영구)
  tags?: string[];            // 온디맨드 무효화 태그
}
```

**난이도**: 중 (1-2주) | **영향도**: 극대 — 프로덕션 성능의 근간

---

### 3-2. 라우트별 렌더링 전략

**문제**: 전역 `streaming: boolean`만 있고 라우트별 SSR/SSG/SWR 선택 불가 (Nuxt 전문가 지적)

**수정 파일**: `packages/core/src/spec/schema.ts`, `packages/core/src/filling/filling.ts`, `packages/core/src/runtime/server.ts`

**API 설계**:

```typescript
// 사용자 코드 — mandu.config.ts
export default {
  routeRules: {
    "/":              { render: "isr", revalidate: 60 },
    "/about":         { render: "static" },           // 빌드 타임 생성
    "/api/**":        { render: "dynamic" },           // 항상 SSR
    "/blog/**":       { render: "swr", revalidate: 300, tags: ["blog"] },
    "/dashboard/**":  { render: "dynamic", streaming: true },
  },
};

// 또는 라우트 파일에서 직접
export default Mandu.filling()
  .render("isr", { revalidate: 120 })
  .loader(async (ctx) => { /* ... */ });
```

**`RenderStrategy` 타입**:

```typescript
type RenderMode = "dynamic" | "static" | "isr" | "swr";

interface RenderStrategy {
  render: RenderMode;
  revalidate?: number;    // isr/swr: 초 단위
  tags?: string[];         // 온디맨드 무효화
  streaming?: boolean;     // dynamic 모드에서 스트리밍 SSR 사용 여부
}

// ManduFilling 확장
class ManduFilling<T> {
  private renderStrategy?: RenderStrategy;
  
  render(mode: RenderMode, options?: Omit<RenderStrategy, "render">): this {
    this.renderStrategy = { render: mode, ...options };
    return this;
  }
  
  getRenderStrategy(): RenderStrategy {
    return this.renderStrategy ?? { render: "dynamic" };
  }
}
```

**서버 디스패치 로직** (의사코드):

```
요청 → 라우트 매칭 → renderStrategy 확인
  ├── "static"  → 사전 생성된 HTML 파일 반환 (없으면 빌드 시 생성)
  ├── "isr"     → 캐시 확인 → HIT/STALE/MISS (Phase 3-1 캐시 레이어 활용)
  ├── "swr"     → stale-while-revalidate 패턴 (항상 캐시 반환 + 백그라운드 갱신)
  └── "dynamic" → 매 요청 SSR (streaming 옵션에 따라 일반/스트리밍)
```

**난이도**: 중 (1주) | **영향도**: 대 — Phase 3-1 캐시와 자연스럽게 통합

---

### 3-3. 글로벌 Middleware (`middleware.ts`)

**문제**: 라우트 매칭 전 실행되는 글로벌 미들웨어 없음. 인증 리다이렉트/geo 라우팅/A/B 테스트 처리 불가 (Next.js, SvelteKit 지적)

**수정 파일**: `packages/core/src/runtime/server.ts`
**규약**: 프로젝트 루트 `middleware.ts`

**API 설계**:

```typescript
// 사용자 코드 — middleware.ts
import type { MiddlewareContext, MiddlewareNext } from "@mandujs/core";

export default async function middleware(ctx: MiddlewareContext, next: MiddlewareNext) {
  // 인증 체크
  const token = ctx.cookies.get("session");
  if (ctx.url.pathname.startsWith("/dashboard") && !token) {
    return ctx.redirect("/login");
  }
  
  // 국가별 리다이렉트
  const country = ctx.request.headers.get("CF-IPCountry");
  if (country === "KR" && ctx.url.pathname === "/") {
    return ctx.redirect("/ko");
  }
  
  // 다음 핸들러로 진행
  const response = await next();
  
  // 응답 헤더 수정
  response.headers.set("X-Custom-Header", "value");
  return response;
}

// 선택적: 특정 경로에만 적용
export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
  // 제외 패턴
  exclude: ["/api/health", "/_next/static/:path*"],
};
```

**`MiddlewareContext` 타입**:

```typescript
interface MiddlewareContext {
  request: Request;
  url: URL;
  cookies: CookieManager;
  params: Record<string, string>;  // matcher에서 추출된 파라미터
  
  // 응답 헬퍼
  redirect(url: string, status?: 301 | 302 | 307 | 308): Response;
  rewrite(url: string): Request;   // 내부 라우트 재작성
  json(data: unknown, status?: number): Response;
  
  // 다음 핸들러에 데이터 전달
  set(key: string, value: unknown): void;
  get<T>(key: string): T | undefined;
}

type MiddlewareNext = () => Promise<Response>;
```

**서버 통합**:

```typescript
// server.ts — fetchHandler 수정
async function fetchHandler(request: Request): Promise<Response> {
  // 1. 미들웨어 실행 (라우트 매칭 전)
  if (middlewareFn) {
    const url = new URL(request.url);
    
    if (matchesMiddlewareConfig(url.pathname, middlewareConfig)) {
      const mwCtx = createMiddlewareContext(request);
      const response = await middlewareFn(mwCtx, async () => {
        // next() — 실제 라우트 핸들러 실행
        return handleRequest(request, router, registry);
      });
      return response;
    }
  }
  
  // 2. 미들웨어 미적용 경로: 기존 로직
  return handleRequest(request, router, registry);
}
```

**미들웨어 로딩** (`startServer` 수정):

```typescript
// startServer에서 middleware.ts 자동 감지
const middlewarePath = path.join(rootDir, "middleware.ts");
let middlewareFn: MiddlewareFn | null = null;
let middlewareConfig: MiddlewareConfig | null = null;

if (await Bun.file(middlewarePath).exists()) {
  const mod = await import(middlewarePath);
  middlewareFn = mod.default;
  middlewareConfig = mod.config ?? null;
}
```

**난이도**: 중 (1주) | **영향도**: 높음 — 인증/리다이렉트 패턴의 표준화

---

## Phase 4: 배포 유연성

### 4-1. Adapter 시스템

**문제**: `Bun.serve()` 하드코딩으로 Edge/서버리스/Node 배포 불가 (Hono, SvelteKit, Nuxt 공통 지적)

**현재 상태 (2026-04-12)**:
- `packages/core/src/runtime/adapter.ts` 인터페이스와 `packages/core/src/runtime/adapter-bun.ts` 기본 구현은 이미 존재
- `mandu.config.ts`의 `adapter` 설정이 검증 스키마에 포함됨
- `mandu build`는 `adapter.build()` 훅을 호출함
- 외부 패키지 분리(`@mandujs/adapter-*`)는 아직 문서상 제안 단계

**현재 구현 파일**:
- `packages/core/src/runtime/adapter.ts` — 어댑터 인터페이스
- `packages/core/src/runtime/adapter-bun.ts` — 기본 Bun 어댑터
- `packages/core/src/runtime/handler.ts` — 런타임 중립 fetch handler
- 향후 분리 후보: `packages/adapter-node/`, `packages/adapter-static/`

**어댑터 인터페이스**:

```typescript
// packages/core/src/runtime/adapter.ts

interface AdapterOptions {
  manifest: RoutesManifest;
  bundleManifest?: BundleManifest;
  rootDir: string;
  serverOptions: ServerOptions;
}

interface AdapterServer {
  /** 서버 시작 */
  listen(port: number, hostname?: string): Promise<void>;
  /** 서버 중지 */
  close(): Promise<void>;
  /** fetch handler (런타임 중립) */
  fetch: (request: Request) => Promise<Response>;
  /** 서버 주소 */
  address?: { port: number; hostname: string };
}

interface ManduAdapter {
  name: string;
  /** 빌드 타임: 배포 산출물 생성 */
  build?(options: AdapterOptions): Promise<void>;
  /** 런타임: 서버 인스턴스 생성 */
  createServer(options: AdapterOptions): Promise<AdapterServer>;
}
```

**핵심: fetch handler 추출**

현재 `server.ts`의 `Bun.serve({ fetch: fetchHandler })`에서 `fetchHandler`를 런타임 중립적으로 분리:

```typescript
// packages/core/src/runtime/handler.ts (신규 — 런타임 중립 핸들러)

export function createFetchHandler(
  router: Router,
  registry: ServerRegistry,
  options: HandlerOptions
): (request: Request) => Promise<Response> {
  return async function fetchHandler(request: Request): Promise<Response> {
    // 미들웨어 → 정적 파일 → 라우트 매칭 → API/SSR 디스패치
    // (현재 server.ts 내부 로직을 여기로 이동)
  };
}
```

**Bun 어댑터** (기존 동작 유지):

```typescript
// packages/core/src/runtime/adapter-bun.ts
import { adapterBun } from "@mandujs/core";

export default {
  adapter: adapterBun(),
};
```

**Node.js 어댑터**:

```typescript
// packages/adapter-node/index.ts
import { createServer } from "node:http";

export default function adapterNode(): ManduAdapter {
  return {
    name: "adapter-node",
    async createServer(options) {
      const fetch = createFetchHandler(router, registry, options);
      const server = createServer(async (req, res) => {
        const request = toWebRequest(req);       // Node → Web Request 변환
        const response = await fetch(request);
        await writeWebResponse(res, response);   // Web Response → Node 변환
      });
      return {
        listen: async (port, hostname) => {
          return new Promise(resolve => server.listen(port, hostname, resolve));
        },
        close: async () => new Promise(resolve => server.close(resolve)),
        fetch,
      };
    },
  };
}
```

**설정**:

```typescript
// mandu.config.ts
import { adapterBun } from "@mandujs/core";

export default {
  adapter: adapterBun(),
};
```

**난이도**: 상 (2-3주) | **영향도**: 극대 — 배포 타겟 확장의 기반

---

### 4-2. Prerendering / SSG

**문제**: 빌드 타임 HTML 사전 생성 불가, CDN 배포 불가 (Astro, SvelteKit, Nuxt 공통 지적)

**수정 파일**: `packages/core/src/bundler/build.ts`, `packages/cli/src/commands/build.ts`

**API 설계**:

```typescript
// mandu.config.ts
export default {
  routeRules: {
    "/about": { render: "static" },
    "/blog/:slug": { render: "static" },
  },
  prerender: {
    // 동적 라우트의 slug 목록 제공
    routes: async () => {
      const posts = await db.getAllPosts();
      return posts.map(p => `/blog/${p.slug}`);
    },
    // 또는 크롤링 모드
    crawl: true,  // 링크를 따라가며 자동 발견
  },
};
```

```typescript
// 또는 라우트 파일에서 직접
export default Mandu.filling()
  .render("static")
  .loader(async () => ({ content: "static content" }));

// 동적 경로 사전 생성
export async function generateStaticParams() {
  const posts = await db.getAllPosts();
  return posts.map(p => ({ slug: p.slug }));
}
```

**빌드 프로세스**:

```typescript
// packages/core/src/bundler/prerender.ts (신규)

interface PrerenderOptions {
  manifest: RoutesManifest;
  rootDir: string;
  outDir: string;                     // 기본: ".mandu/static/"
  routes?: string[] | (() => Promise<string[]>);
  crawl?: boolean;
}

async function prerenderRoutes(options: PrerenderOptions): Promise<PrerenderResult> {
  const { manifest, rootDir, outDir } = options;
  const results: PrerenderResult[] = [];
  
  // 1. static 렌더링 대상 라우트 수집
  const staticRoutes = manifest.routes.filter(r => 
    getRouteRenderStrategy(r).render === "static"
  );
  
  // 2. 동적 파라미터 해결
  const resolvedPaths: string[] = [];
  for (const route of staticRoutes) {
    if (route.pattern.includes(":")) {
      // generateStaticParams() 호출
      const mod = await import(path.join(rootDir, route.module));
      if (mod.generateStaticParams) {
        const params = await mod.generateStaticParams();
        for (const p of params) {
          resolvedPaths.push(resolvePattern(route.pattern, p));
        }
      }
    } else {
      resolvedPaths.push(route.pattern);
    }
  }
  
  // 3. 각 경로를 SSR → HTML 파일로 저장
  for (const pathname of resolvedPaths) {
    const request = new Request(`http://localhost${pathname}`);
    const response = await fetchHandler(request);
    const html = await response.text();
    
    const filePath = path.join(outDir, pathname, "index.html");
    await Bun.write(filePath, html);
    results.push({ path: pathname, size: html.length });
  }
  
  // 4. 크롤링 모드: 생성된 HTML에서 <a href> 추출 → 재귀
  if (options.crawl) {
    // ... 링크 추출 + 큐 기반 크롤링 ...
  }
  
  return { generated: results.length, routes: results };
}
```

**`mandu build` 수정**:

```
mandu build
  1. 클라이언트 번들 빌드 (기존)
  2. CSS 빌드 (기존)
  3. static 라우트 프리렌더링 (신규)
  4. manifest.json 업데이트 (static 라우트에 prerendered: true 추가)
```

**난이도**: 상 (2주) | **영향도**: 대 — CDN 배포 가능, 정적 사이트 시장 진입

---

### 4-3. Nested Route 병렬 Loader

**문제**: layout별 독립 loader 없음, leaf 라우트만 데이터 로딩 (Remix 전문가 지적)

**수정 파일**: `packages/core/src/runtime/server.ts`, `packages/core/src/spec/schema.ts`

**API 설계**:

```typescript
// app/layout.tsx — 레이아웃에도 slot/loader 가능
export default function RootLayout({ children, user }: { children: ReactNode; user: User }) {
  return (
    <div>
      <nav>Welcome, {user.name}</nav>
      {children}
    </div>
  );
}

// app/layout.slot.ts — 레이아웃 전용 데이터 로더
export default Mandu.filling()
  .loader(async (ctx) => {
    const user = await getUser(ctx.cookies.get("session"));
    return { user };
  });
```

**서버 렌더링 수정**:

```typescript
// server.ts — 페이지 렌더링 시 layout chain의 모든 loader 병렬 실행

async function loadRouteData(
  route: RouteSpec,
  registry: ServerRegistry,
  ctx: ManduContext
): Promise<{ layoutData: Record<string, unknown>; pageData: unknown }> {
  const layoutChain = route.layoutChain ?? [];
  
  // 모든 loader를 병렬로 실행
  const [pageData, ...layoutResults] = await Promise.all([
    // 페이지 loader
    registry.getPageLoader(route.id)?.executeLoader(ctx),
    // 레이아웃 loaders (독립적으로 병렬 실행)
    ...layoutChain.map(layoutPath => 
      registry.getLayoutLoader(layoutPath)?.executeLoader(ctx)
    ),
  ]);
  
  // layout 데이터를 경로별로 매핑
  const layoutData: Record<string, unknown> = {};
  layoutChain.forEach((layoutPath, i) => {
    layoutData[layoutPath] = layoutResults[i];
  });
  
  return { layoutData, pageData };
}
```

**난이도**: 중 (1주) | **영향도**: 높음 — 공통 데이터(인증, 설정)를 layout에서 한번만 로드

---

## Phase 5: DX 혁신

### 5-1. RPC 클라이언트 (Contract → 타입 안전 클라이언트)

**문제**: Contract 정의에서 클라이언트 SDK 자동 생성 없음 (Hono 전문가 지적)

**신규 파일**: `packages/core/src/client/rpc.ts`

**API 설계**:

```typescript
// 사용자 코드 — 서버: spec/contracts/api-todos.contract.ts
import { z } from "zod";

export default Mandu.contract({
  description: "Todo API",
  request: {
    GET: { query: z.object({ page: z.coerce.number().default(1) }) },
    POST: { body: z.object({ title: z.string().min(1) }) },
  },
  response: {
    200: z.object({ todos: z.array(z.object({ id: z.string(), title: z.string() })) }),
    201: z.object({ id: z.string() }),
  },
});
```

```typescript
// 사용자 코드 — 클라이언트: 타입 안전한 API 호출
import { createClient } from "@mandujs/core/client";
import type todoContract from "../spec/contracts/api-todos.contract";

const api = createClient<typeof todoContract>("/api/todos");

// 타입 추론 완벽하게 동작
const { todos } = await api.get({ query: { page: 2 } });
//    ^? { id: string; title: string }[]

const { id } = await api.post({ body: { title: "New todo" } });
//    ^? string
```

**`createClient` 구현**:

```typescript
// packages/core/src/client/rpc.ts

type InferRequest<C, M extends string> = C extends { request: { [K in M]: infer R } } ? R : never;
type InferResponse<C, S extends number> = C extends { response: { [K in S]: infer R } } ? z.infer<R> : never;

interface ClientOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;          // 커스텀 fetch (테스트용)
}

function createClient<TContract>(
  path: string,
  options?: ClientOptions
) {
  const baseFetch = options?.fetch ?? globalThis.fetch;
  const baseUrl = options?.baseUrl ?? "";
  
  function makeRequest(method: string) {
    return async (input?: { query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> }) => {
      const url = new URL(`${baseUrl}${path}`, window.location.origin);
      
      if (input?.query) {
        for (const [key, value] of Object.entries(input.query)) {
          url.searchParams.set(key, String(value));
        }
      }
      
      const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers: {
          ...options?.headers,
          ...input?.headers,
        },
      };
      
      if (input?.body) {
        fetchOptions.body = JSON.stringify(input.body);
        (fetchOptions.headers as Record<string, string>)["Content-Type"] = "application/json";
      }
      
      const response = await baseFetch(url.toString(), fetchOptions);
      
      if (!response.ok) {
        throw new ClientError(response.status, await response.text());
      }
      
      return response.json();
    };
  }
  
  return {
    get: makeRequest("GET"),
    post: makeRequest("POST"),
    put: makeRequest("PUT"),
    patch: makeRequest("PATCH"),
    delete: makeRequest("DELETE"),
  } as ClientMethods<TContract>;
}

class ClientError extends Error {
  constructor(public status: number, public body: string) {
    super(`API Error ${status}: ${body}`);
  }
}
```

**난이도**: 중 (1-2주) | **영향도**: 높음 — end-to-end 타입 안전성

---

### 5-2. 미들웨어 플러그인 분리

**문제**: CORS/Rate Limit 하드코딩, 재사용 불가 (Hono 전문가 지적)

**API 설계**:

```typescript
// 사용자 코드
import { cors } from "@mandujs/core/middleware";
import { jwt } from "@mandujs/core/middleware";
import { compress } from "@mandujs/core/middleware";

export default Mandu.filling()
  .use(cors({ origin: "https://example.com" }))
  .use(jwt({ secret: process.env.JWT_SECRET }))
  .use(compress())
  .get((ctx) => ctx.ok({ data: "protected" }));
```

**미들웨어 팩토리 패턴**:

```typescript
// packages/core/src/middleware/cors.ts
export function cors(options?: CorsOptions): Guard {
  return async (ctx: ManduContext) => {
    const origin = ctx.headers.get("Origin");
    // ... CORS 로직 (현재 server.ts에서 추출) ...
    
    if (ctx.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    
    // afterResponse에서 CORS 헤더 추가하도록 ctx.set
    ctx.set("_cors_headers", corsHeaders);
  };
}

// packages/core/src/middleware/jwt.ts
export function jwt(options: JwtOptions): Guard {
  return async (ctx: ManduContext) => {
    const token = ctx.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return ctx.unauthorized("Missing token");
    
    try {
      const payload = await verifyJwt(token, options.secret);
      ctx.set("user", payload);
    } catch {
      return ctx.unauthorized("Invalid token");
    }
  };
}

// packages/core/src/middleware/compress.ts
export function compress(options?: CompressOptions): AfterHandleHandler {
  return async (ctx, response) => {
    const encoding = ctx.headers.get("Accept-Encoding") ?? "";
    if (!encoding.includes("gzip")) return response;
    
    const body = await response.arrayBuffer();
    const compressed = Bun.gzipSync(new Uint8Array(body));
    return new Response(compressed, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        "Content-Encoding": "gzip",
        "Vary": "Accept-Encoding",
      },
    });
  };
}
```

**내보내기 구조**:

```typescript
// packages/core/src/middleware/index.ts
export { cors } from "./cors";
export { jwt } from "./jwt";
export { compress } from "./compress";
export { logger } from "./logger";
export { etag } from "./etag";
export { csrf } from "./csrf";
export { timeout } from "./timeout";
```

**난이도**: 낮 (3-5일) | **영향도**: 중 — 생태계 기반 마련

---

### 5-3. `useFetch` Composable

**문제**: 클라이언트에서 데이터 fetch 시 SSR 중복 호출 방지, pending/error 상태 관리 없음 (Nuxt 전문가 지적)

**신규 파일**: `packages/core/src/client/hooks/useFetch.ts`

**API 설계**:

```typescript
// 사용자 코드
import { useFetch } from "@mandujs/core/client";

function PostList() {
  const { data, error, loading, refresh, mutate } = useFetch<Post[]>("/api/posts", {
    query: { page: 1 },
    // SSR에서 이미 로드된 데이터가 있으면 재요청 안 함
    dedupe: true,
    // 5분 캐시
    cacheTime: 300_000,
  });
  
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return (
    <ul>
      {data?.map(post => <li key={post.id}>{post.title}</li>)}
    </ul>
  );
}
```

**구현**:

```typescript
interface UseFetchOptions<T> {
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
  /** SSR 데이터 있으면 클라이언트 fetch 생략 */
  dedupe?: boolean;
  /** 캐시 유지 시간 (ms) */
  cacheTime?: number;
  /** 자동 실행 여부 (기본: true) */
  immediate?: boolean;
  /** 의존성 변경 시 자동 재실행 */
  watch?: unknown[];
  /** 변환 함수 */
  transform?: (data: unknown) => T;
}

interface UseFetchReturn<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  /** 수동 재요청 */
  refresh(): Promise<void>;
  /** 로컬 데이터 수정 (낙관적 업데이트) */
  mutate(data: T | ((prev: T | null) => T)): void;
}

const fetchCache = new Map<string, { data: unknown; timestamp: number }>();

function useFetch<T = unknown>(
  url: string,
  options?: UseFetchOptions<T>
): UseFetchReturn<T> {
  const [data, setData] = useState<T | null>(() => {
    // SSR 데이터 확인 (dedupe)
    if (options?.dedupe) {
      const serverData = getServerData();
      if (serverData) return serverData as T;
    }
    // 캐시 확인
    const cacheKey = buildCacheKey(url, options?.query);
    const cached = fetchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < (options?.cacheTime ?? 0)) {
      return cached.data as T;
    }
    return null;
  });
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!data);
  
  const fetchData = useCallback(async () => {
    const cacheKey = buildCacheKey(url, options?.query);
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(buildUrl(url, options?.query), {
        method: options?.method ?? "GET",
        headers: options?.headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });
      
      if (!response.ok) throw new Error(`${response.status}`);
      
      let result = await response.json();
      if (options?.transform) result = options.transform(result);
      
      setData(result);
      fetchCache.set(cacheKey, { data: result, timestamp: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [url, JSON.stringify(options?.query)]);
  
  // 자동 실행
  useEffect(() => {
    if (options?.immediate === false) return;
    if (data && options?.dedupe) return; // SSR 데이터 있으면 스킵
    fetchData();
  }, [fetchData, ...(options?.watch ?? [])]);
  
  const mutate = useCallback((updater: T | ((prev: T | null) => T)) => {
    setData(prev => typeof updater === "function" ? (updater as Function)(prev) : updater);
  }, []);
  
  return { data, error, loading, refresh: fetchData, mutate };
}
```

**난이도**: 중 (1주) | **영향도**: 높음

---

### 5-4. WebSocket 핸들러

**문제**: SSE만 지원, 양방향 실시간 통신 불가 (Hono 전문가 지적)

**수정 파일**: `packages/core/src/filling/filling.ts`, `packages/core/src/runtime/server.ts`

**API 설계**:

```typescript
// 사용자 코드 — app/api/ws/route.ts
export default Mandu.filling()
  .ws({
    open(ws) {
      console.log("Connected:", ws.id);
      ws.subscribe("chat");       // 토픽 구독
    },
    message(ws, message) {
      ws.publish("chat", message);  // 같은 토픽 구독자에게 브로드캐스트
    },
    close(ws) {
      console.log("Disconnected:", ws.id);
    },
  });
```

**ManduFilling 확장**:

```typescript
interface WSHandlers {
  open?(ws: ManduWebSocket): void;
  message?(ws: ManduWebSocket, message: string | ArrayBuffer): void;
  close?(ws: ManduWebSocket, code: number, reason: string): void;
  drain?(ws: ManduWebSocket): void;
}

interface ManduWebSocket {
  id: string;
  data: Record<string, unknown>;
  send(data: string | ArrayBuffer): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  publish(topic: string, data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

class ManduFilling<T> {
  private wsHandlers?: WSHandlers;
  
  ws(handlers: WSHandlers): this {
    this.wsHandlers = handlers;
    return this;
  }
  
  getWSHandlers(): WSHandlers | undefined {
    return this.wsHandlers;
  }
}
```

**서버 통합** (`server.ts`):

```typescript
// Bun.serve의 websocket 옵션 활용
const server = Bun.serve({
  port,
  fetch: async (req, server) => {
    const match = router.match(url.pathname);
    
    // WS 업그레이드 요청 처리
    if (req.headers.get("upgrade") === "websocket" && match) {
      const wsHandlers = registry.getWSHandlers(match.route.id);
      if (wsHandlers) {
        const upgraded = server.upgrade(req, {
          data: { routeId: match.route.id, params: match.params, id: crypto.randomUUID() },
        });
        return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
      }
    }
    
    return fetchHandler(req);
  },
  websocket: {
    open(ws) {
      const handlers = registry.getWSHandlers(ws.data.routeId);
      handlers?.open?.(wrapBunWS(ws));
    },
    message(ws, message) {
      const handlers = registry.getWSHandlers(ws.data.routeId);
      handlers?.message?.(wrapBunWS(ws), message);
    },
    close(ws, code, reason) {
      const handlers = registry.getWSHandlers(ws.data.routeId);
      handlers?.close?.(wrapBunWS(ws), code, reason);
    },
  },
});
```

**난이도**: 낮-중 (3-5일) | **영향도**: 중 — 실시간 기능 확장

---

### 5-5. 테스트 헬퍼

**문제**: 서버 없이 라우트 단위 테스트 불가 (Hono 전문가 지적)

**현재 상태 (2026-04-12)**:
- `testFilling`, `createTestRequest`, `createTestContext`는 구현 완료
- `testApp(rootDir)` 수준의 프로젝트 통합 헬퍼는 아직 후순위

**신규 파일**: `packages/core/src/testing/index.ts`

**API 설계**:

```typescript
// 사용자 테스트 코드
import { testApp } from "@mandujs/core/testing";

const app = await testApp("./app");  // 프로젝트 루트 기준

// 마치 fetch처럼 API 테스트
const res = await app.request("/api/todos", { method: "GET" });
expect(res.status).toBe(200);

const { todos } = await res.json();
expect(todos).toHaveLength(3);

// POST + action 테스트
const createRes = await app.request("/api/todos", {
  method: "POST",
  body: { _action: "create", title: "Test" },
});
expect(createRes.status).toBe(201);

// 특정 filling 직접 테스트
import todoRoute from "./app/api/todos/route";

const res = await testFilling(todoRoute, {
  method: "GET",
  query: { page: "2" },
});
```

**구현**:

```typescript
// packages/core/src/testing/index.ts

interface TestAppOptions {
  rootDir?: string;
}

async function testApp(rootDir: string = ".", options?: TestAppOptions) {
  const manifest = await loadManifest(rootDir);
  const registry = await loadRegistry(manifest, rootDir);
  const router = createRouter(manifest.routes);
  const fetchHandler = createFetchHandler(router, registry, { isDev: true });
  
  return {
    async request(path: string, init?: RequestInit & { body?: unknown }) {
      const url = `http://localhost${path}`;
      const requestInit: RequestInit = { ...init };
      
      if (init?.body && typeof init.body === "object" && !(init.body instanceof FormData)) {
        requestInit.body = JSON.stringify(init.body);
        requestInit.headers = {
          "Content-Type": "application/json",
          ...init?.headers,
        };
      }
      
      return fetchHandler(new Request(url, requestInit));
    },
  };
}

async function testFilling(
  filling: ManduFilling,
  options: { method?: string; query?: Record<string, string>; body?: unknown; params?: Record<string, string> }
) {
  const url = new URL("http://localhost/test");
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) url.searchParams.set(k, v);
  }
  
  const request = new Request(url.toString(), {
    method: options.method ?? "GET",
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: options.body ? { "Content-Type": "application/json" } : {},
  });
  
  return filling.handle(request, options.params ?? {});
}
```

**난이도**: 낮 (2-3일) | **영향도**: 중 — 테스트 DX 대폭 개선

---

## Phase 6: 장기 차별화

### 6-1. Island 단위 코드 분할

**문제**: 페이지 단위 번들링으로 한 페이지의 모든 island이 하나의 번들에 묶임 (Astro 전문가 지적)

**현재**: `buildIsland(routeId, clientModule)` → 라우트당 1개 번들
**목표**: island 파일당 1개 번들 → 페이지에 3개 island이면 3개 독립 번들

**수정 파일**: `packages/core/src/bundler/build.ts`, `packages/core/src/runtime/ssr.ts`

**변경 사항**:

```typescript
// BundleManifest 구조 변경
interface BundleManifest {
  bundles: Record<string, {     // 키: island ID (라우트 ID가 아님)
    js: string;
    css?: string;
    size: number;
  }>;
  routes: Record<string, {      // 라우트 → island 매핑
    islands: string[];           // 이 라우트가 사용하는 island ID 목록
  }>;
  shared: { runtime: string; vendor: string };
}

// SSR에서 island별 개별 <script> 태그 삽입
// data-mandu-src가 island별 번들 URL을 가리킴
```

**구현 접근**:
1. FS 스캐너가 `*.island.tsx` 파일을 독립 엔트리로 수집
2. `Bun.build`에 각 island을 개별 엔트리포인트로 전달 (splitting: true)
3. SSR에서 `data-mandu-src`를 island별 번들 URL로 설정
4. 런타임 hydration 스크립트는 각 island을 개별 dynamic import

**난이도**: 상 (2-3주) | **영향도**: 극대 — 부분 하이드레이션의 본질적 완성

---

### 6-2. View Transitions

**문제**: 페이지 전환 시 애니메이션 없음 (Astro 전문가 지적)

**수정 파일**: `packages/core/src/client/router.ts`

**구현**:

```typescript
// client/router.ts — navigate 수정
async function navigate(to: string, options?: NavigateOptions): Promise<void> {
  // View Transitions API 지원 확인
  if ("startViewTransition" in document && !options?.skipTransition) {
    const transition = document.startViewTransition(async () => {
      await performNavigation(to, options);
    });
    await transition.finished;
  } else {
    await performNavigation(to, options);
  }
}
```

```css
/* 기본 CSS (프레임워크 제공) */
::view-transition-old(root) {
  animation: fade-out 150ms ease-out;
}
::view-transition-new(root) {
  animation: fade-in 150ms ease-in;
}
```

**사용자 커스터마이징**:

```typescript
// mandu.config.ts
export default {
  viewTransition: {
    enabled: true,          // 기본: true (브라우저 미지원 시 자동 fallback)
    defaultAnimation: "fade",  // "fade" | "slide" | "none"
  },
};
```

**난이도**: 하 (2-3일) | **영향도**: 중 — 사용자 체감 품질 향상

---

### 6-3. Content Collections

**문제**: Markdown/MDX 기반 콘텐츠 관리 레이어 없음 (Astro 전문가 지적)

**신규 파일**: `packages/core/src/content/index.ts`

**API 설계**:

```typescript
// content/blog/hello-world.md
---
title: "Hello World"
date: 2026-04-11
tags: ["mandu", "intro"]
draft: false
---

# Hello World
This is my first post.
```

```typescript
// content/config.ts — 스키마 정의
import { z, defineCollection } from "@mandujs/core/content";

export const collections = {
  blog: defineCollection({
    schema: z.object({
      title: z.string(),
      date: z.coerce.date(),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
  }),
};
```

```typescript
// 사용자 코드 — 라우트에서 사용
import { getCollection, getEntry } from "@mandujs/core/content";

export default Mandu.filling()
  .loader(async () => {
    const posts = await getCollection("blog", (entry) => !entry.data.draft);
    return { posts };
  });
```

**핵심 함수**:

```typescript
interface CollectionEntry<T> {
  id: string;            // 파일명 (확장자 제외)
  slug: string;          // URL-safe 슬러그
  data: T;               // frontmatter (Zod 검증됨)
  body: string;          // 본문 (raw markdown)
  render(): Promise<{ html: string; headings: Heading[] }>;
}

function getCollection<T>(
  name: string,
  filter?: (entry: CollectionEntry<T>) => boolean
): Promise<CollectionEntry<T>[]>;

function getEntry<T>(
  name: string,
  id: string
): Promise<CollectionEntry<T> | null>;
```

**Markdown 처리**: `@mandujs/core/content`에서 `marked` 또는 `remark` 기반 파이프라인 제공. MDX는 옵트인.

**난이도**: 중 (2주) | **영향도**: 중 — 블로그/문서 사이트 시장 진입

---

### 6-4. Image 최적화 컴포넌트

**문제**: 이미지 최적화 전무, Core Web Vitals에 영향 (Next.js 전문가 지적)

**신규 파일**:
- `packages/core/src/components/Image.tsx` — 서버 컴포넌트
- `packages/core/src/runtime/image-handler.ts` — 온디맨드 리사이즈

**API 설계**:

```tsx
import { Image } from "@mandujs/core";

<Image
  src="/photos/hero.jpg"
  alt="Hero image"
  width={800}
  height={400}
  sizes="(max-width: 768px) 100vw, 800px"
  priority          // LCP 이미지: preload 힌트 삽입
  placeholder="blur" // 블러 플레이스홀더
/>
```

**서버 렌더링 출력**:

```html
<!-- priority일 때 -->
<link rel="preload" as="image" href="/_mandu/image?url=/photos/hero.jpg&w=800&q=80" imagesrcset="..." />

<img
  src="/_mandu/image?url=/photos/hero.jpg&w=800&q=80"
  srcset="
    /_mandu/image?url=/photos/hero.jpg&w=640&q=80 640w,
    /_mandu/image?url=/photos/hero.jpg&w=800&q=80 800w,
    /_mandu/image?url=/photos/hero.jpg&w=1200&q=80 1200w
  "
  sizes="(max-width: 768px) 100vw, 800px"
  alt="Hero image"
  width="800"
  height="400"
  loading="lazy"
  decoding="async"
  style="aspect-ratio: 800/400"
/>
```

**이미지 핸들러** (`/_mandu/image` 라우트):

```typescript
// packages/core/src/runtime/image-handler.ts
async function handleImageRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const src = url.searchParams.get("url")!;
  const width = Number(url.searchParams.get("w") ?? 800);
  const quality = Number(url.searchParams.get("q") ?? 80);
  const format = negotiateFormat(request);  // Accept 헤더 → webp/avif/jpeg
  
  const cacheKey = `${src}-${width}-${quality}-${format}`;
  const cached = imageCache.get(cacheKey);
  if (cached) return cached;
  
  // sharp 또는 Bun의 내장 이미지 처리 사용
  const original = Bun.file(path.join(publicDir, src));
  const optimized = await processImage(await original.arrayBuffer(), { width, quality, format });
  
  const response = new Response(optimized, {
    headers: {
      "Content-Type": `image/${format}`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Vary": "Accept",
    },
  });
  
  imageCache.set(cacheKey, response.clone());
  return response;
}
```

**난이도**: 중 (1-2주) | **영향도**: 높음 — LCP/CLS 직접 개선

---

## 우선순위 매트릭스

```
영향도 ↑
극대 │  ISR(3-1)        Adapter(4-1)
     │  Action(2-1)     Island분할(6-1)
     │  Zero-JS(1-2)
     │
 대  │  렌더전략(3-2)   Prerender(4-2)    Image(6-4)
     │  Middleware(3-3)  병렬Loader(4-3)
     │
 높  │  AbortCtrl(1-1)  Form(2-2)         RPC(5-1)
     │  useFetch(5-3)
     │
 중  │  ETag(1-3)       useMandu(2-3)     View Trans(6-2)
     │  WS(5-4)         Test(5-5)         Content(6-3)
     │  MW플러그인(5-2)
     │
     └────────────────────────────────────────────→ 난이도
          하              중              상
```

---

## 비고

- **React 전용 유지**: Vue/Svelte 멀티프레임워크 지원은 Phase 6에서도 제외. Mandu의 차별점(Guard, MCP, Contract)은 React 생태계에서 충분히 경쟁력 있음
- **Bun 우선**: adapter-bun이 기본값. adapter-node는 호환성 목적으로만 제공
- **각 Phase 내 순서**: 번호순이 구현 권장 순서
- **의존 관계**: Phase 3-1(ISR)은 Phase 3-2(렌더전략)의 전제 조건. Phase 4-1(Adapter)은 Phase 4-2(Prerender)의 전제 조건

---

## 부록: 초기 기획에서 누락된 항목

> 6명 전문가 분석 재검토 결과 로드맵 본문에 포함되지 않은 항목들.
> 각 항목에 삽입 적절 Phase를 표기함.

### A-1. Route-level ErrorBoundary (Remix P1)

**상태 (2026-04-12)**: 구현됨. `error.tsx` 기반 route-level SSR fallback이 이미 동작함.

**문제**: 중첩 라우트에서 자식 에러가 부모 UI 전체를 파괴함. 현재 `boundary.tsx`는 전역 수준.

**삽입 위치**: Phase 4-3 (Nested Route 병렬 Loader) 와 함께 구현

**API**:
```typescript
// app/dashboard/error.tsx — 이 라우트 이하의 에러만 격리
export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <h2>Dashboard Error: {error.message}</h2>
      <button onClick={reset}>재시도</button>
    </div>
  );
}
```

SSR에서 라우트별 `try/catch` → 해당 라우트의 `error.tsx` 렌더링. 부모 layout은 정상 유지.

**난이도**: 중 | **영향도**: 높음

---

### A-2. shouldRevalidate() 훅 (Remix P2)

**상태 (2026-04-12)**: 구현됨. `navigate()` skip 경로에서 URL/route state 동기화까지 반영됨.

**문제**: 네비게이션마다 모든 loader가 재실행됨. 변경되지 않은 데이터도 불필요하게 재요청.

**삽입 위치**: Phase 3-1 (ISR) 이후

**API**:
```typescript
// app/dashboard/route.ts
export function shouldRevalidate({ currentUrl, nextUrl, formAction, defaultShouldRevalidate }) {
  // 같은 탭 내 이동이면 loader 재실행 안 함
  if (currentUrl.searchParams.get("tab") !== nextUrl.searchParams.get("tab")) {
    return true;
  }
  return false;
}
```

클라이언트 라우터의 `navigate()`에서 `shouldRevalidate()` 호출 → false면 기존 `loaderData` 유지.

**난이도**: 낮 | **영향도**: 중

---

### A-3. Cookie/Session Storage 추상화 (Remix P3)

**상태 (2026-04-12)**: 구현됨. `createCookieSessionStorage()`와 flash/session API 제공.

**문제**: `ctx.cookies`는 있지만 서버 사이드 세션 관리(flash message, 세션 저장소) 추상화 없음.

**삽입 위치**: Phase 5 (DX 혁신)

**API**:
```typescript
import { createCookieSessionStorage } from "@mandujs/core";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__session",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24, // 1일
    secrets: [process.env.SESSION_SECRET],
  },
});

// filling 내에서 사용
.action("login", async (ctx) => {
  const session = await sessionStorage.getSession(ctx.cookies);
  session.set("userId", user.id);
  session.flash("message", "로그인 성공!");
  return ctx.redirect("/dashboard", {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
});
```

**난이도**: 중 | **영향도**: 중

---

### A-4. useHead / useSeoMeta 컴포저블 (Nuxt P5)

**상태 (2026-04-12)**: 구현됨. 일반 SSR뿐 아니라 Streaming SSR에서도 head 수집이 반영됨.

**문제**: SSR에서 `<head>` 태그를 선언적으로 제어하는 API 없음. title 외에 og:tags, canonical 등 동적 제어 불가.

**삽입 위치**: Phase 5 (DX 혁신)

**API**:
```tsx
import { useHead, useSeoMeta } from "@mandujs/core/client";

function BlogPost({ post }) {
  useHead({
    title: post.title,
    link: [{ rel: "canonical", href: `https://example.com/blog/${post.slug}` }],
  });

  useSeoMeta({
    ogTitle: post.title,
    ogDescription: post.excerpt,
    ogImage: post.coverImage,
    twitterCard: "summary_large_image",
  });

  return <article>{/* ... */}</article>;
}
```

서버: `renderToHTML` 시 컴포넌트 트리에서 수집된 head 태그를 `<head>`에 삽입.
클라이언트: `document.head`에 직접 DOM 조작.

**난이도**: 중 | **영향도**: 중 — SEO 필수 기능

---

### A-5. `island('never')` 번들 제외 보장 (Astro P2)

**문제**: `island('never', Component)` (SSR-only)로 선언해도 해당 컴포넌트 JS가 클라이언트 번들에서 tree-shaken되는 보장 없음.

**삽입 위치**: Phase 6-1 (Island 단위 코드 분할) 과 함께

**구현**: `buildClientBundles()`에서 `needsHydration(route)`이 false인 라우트의 `clientModule`을 번들 엔트리에서 제외. `island('never')` 등록 시 `islandRegistry`에서 `hydrate: 'never'` 플래그 확인 → 번들러가 이 island을 skip.

**난이도**: 낮 | **영향도**: 중 — Zero-JS 모드의 논리적 완성

---

### A-6. Parallel Routes / Named Slots (Next.js P4)

**문제**: 같은 레이아웃에 여러 독립 콘텐츠 영역(모달, 사이드패널)을 동시 렌더링하는 패턴 없음.

**삽입 위치**: Phase 6 (장기)

**API**:
```
app/
├── layout.tsx              → props: { children, modal }
├── page.tsx
├── @modal/
│   └── login/
│       └── page.tsx        → /login 접근 시 모달로 렌더링
```

`fs-scanner.ts`에서 `@` 프리픽스 디렉토리를 named slot으로 인식 → `layout.tsx`에 named props로 주입.

**난이도**: 상 | **영향도**: 대

---

### 누락 항목 우선순위 요약

| 항목 | 삽입 Phase | 난이도 | 영향도 |
|------|-----------|--------|--------|
| Route-level ErrorBoundary | 완료 | 중 | 높 |
| shouldRevalidate() | 완료 | 낮 | 중 |
| Cookie/Session Storage | 완료 | 중 | 중 |
| useHead/useSeoMeta | 완료 | 중 | 중 |
| `never` 번들 제외 | 6-1과 함께 | 낮 | 중 |
| Parallel Routes (@slot) | 6 | 상 | 대 |
