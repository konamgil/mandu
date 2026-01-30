# Mandu API Reference

This document provides a concise reference for the core Mandu APIs.

---

## Mandu.filling()

### HTTP Methods

| Method | Description |
|--------|-------------|
| `.get(handler)` | Handle GET |
| `.post(handler)` | Handle POST |
| `.put(handler)` | Handle PUT |
| `.patch(handler)` | Handle PATCH |
| `.delete(handler)` | Handle DELETE |
| `.head(handler)` | Handle HEAD |
| `.options(handler)` | Handle OPTIONS |
| `.all(handler)` | Handle all methods |

### Lifecycle Hooks

| Method | Description |
|--------|-------------|
| `.onRequest(fn)` | Runs at request start |
| `.onParse(fn)` | Runs before handler for body methods |
| `.beforeHandle(fn)` | Guard hook (return Response to block) |
| `.afterHandle(fn)` | Post-handler hook |
| `.mapResponse(fn)` | Final response mapping |
| `.afterResponse(fn)` | Runs after response (async) |
| `.onError(fn)` | Error hook (return Response to handle) |

### Guard Aliases

| Method | Description |
|--------|-------------|
| `.guard(fn)` | Alias of `beforeHandle` |
| `.use(fn)` | Alias of `guard` |

### Compose-style Middleware

| Method | Description |
|--------|-------------|
| `.middleware(fn, name?)` | Koa/Hono-style middleware chain around handler |

**Middleware signature:**

```ts
type Middleware = (ctx: ManduContext, next: () => Promise<void>) =>
  Response | void | Promise<Response | void>;
```

### Loader (SSR)

| Method | Description |
|--------|-------------|
| `.loader(fn)` | Register SSR loader for page routes |

### Execution

| Method | Description |
|--------|-------------|
| `.handle(request, params?, routeContext?, options?)` | Execute lifecycle + handler |

---

## ManduContext

### Request

| Property | Description |
|----------|-------------|
| `ctx.req` | Request object |
| `ctx.method` | HTTP method |
| `ctx.url` | Request URL |
| `ctx.params` | Route params |
| `ctx.query` | Query string params |
| `ctx.headers` | Request headers |
| `ctx.cookies` | Cookie manager |

### Body

| Method | Description |
|--------|-------------|
| `ctx.body<T>(schema?)` | Parse request body (optional Zod validation) |

> If you need to read the body in `onParse`, use `ctx.req.clone()`.

### Responses

| Method | Description |
|--------|-------------|
| `ctx.ok(data)` | 200 OK |
| `ctx.created(data)` | 201 Created |
| `ctx.noContent()` | 204 No Content |
| `ctx.error(message, details?)` | 400 Bad Request |
| `ctx.unauthorized(message?)` | 401 Unauthorized |
| `ctx.forbidden(message?)` | 403 Forbidden |
| `ctx.notFound(message?)` | 404 Not Found |
| `ctx.fail(message?)` | 500 Internal Server Error |
| `ctx.json(data, status?)` | Custom JSON response |
| `ctx.text(data, status?)` | Text response |
| `ctx.html(data, status?)` | HTML response |
| `ctx.redirect(url, status?)` | Redirect |

### Store

| Method | Description |
|--------|-------------|
| `ctx.set(key, value)` | Store data |
| `ctx.get<T>(key)` | Read data |
| `ctx.has(key)` | Check existence |

---

## Trace

| API | Description |
|-----|-------------|
| `enableTrace(ctx)` | Enable trace collection |
| `getTrace(ctx)` | Read raw trace data |
| `buildTraceReport(trace)` | Build normalized report |
| `formatTraceReport(report)` | JSON pretty-print |
| `TRACE_KEY` | Storage key for ctx store |

---

## Serialization (Islands)

| API | Description |
|-----|-------------|
| `serializeProps(props)` | Serialize with advanced types |
| `deserializeProps(json)` | Deserialize props |
| `isSerializable(value)` | Check serializability |
| `generatePropsScript(id, props)` | SSR script tag |
| `parsePropsScript(id)` | Client-side parser |

---

## Mandu Client (`@mandujs/core/client`)

### Islands

| API | Description |
|-----|-------------|
| `ManduClient.island(definition)` | Define a client island (setup + render) |
| `ManduClient.wrapComponent(Component, options?)` | Wrap existing React component as island |
| `useServerData(key, fallback)` | Read SSR data safely |
| `useHydrated()` | Hydration state (client-only) |
| `useIslandEvent(name, handler)` | Simple island event bus |

### Client-side Router

| API | Description |
|-----|-------------|
| `Link`, `NavLink` | Client-side navigation components |
| `useRouter()` | Router state + navigation helpers |
| `useParams()` | Current route params |
| `usePathname()`, `useSearchParams()` | URL helpers |
| `navigate(url, options?)` | Imperative navigation |
| `prefetch(url)` | Preload route data |

### Runtime helpers

| API | Description |
|-----|-------------|
| `getHydrationState()` | Aggregate island hydration status |
| `unmountIsland(id)` | Unmount a specific island |
| `unmountAllIslands()` | Unmount all islands |

---

## Errors

| Error | Description |
|-------|-------------|
| `ValidationError` | Schema validation errors |
| `AuthenticationError` | Auth required |
| `AuthorizationError` | Permission denied |
