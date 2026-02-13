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

## Mandu.sse()

Create a first-class SSE connection helper for realtime routes.

```ts
const sse = Mandu.sse(request.signal);
sse.event("ready", { ok: true });
const stop = sse.heartbeat(15000);
sse.onClose(() => stop());
return sse.response;
```

### SSEConnection

| Method | Description |
|--------|-------------|
| `sse.response` | Streaming `Response` with SSE-safe headers |
| `sse.send(data, options?)` | Send `data:` event payload |
| `sse.event(name, data, options?)` | Send named event (`event:`) |
| `sse.comment(text)` | Send SSE comment line (`: text`) |
| `sse.heartbeat(intervalMs?, comment?)` | Auto-send comment pings |
| `sse.onClose(handler)` | Register teardown callback |
| `sse.close()` | Close stream + run cleanup hooks |

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
| `ctx.sse(setup?, options?)` | Create SSE response with setup hook |

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

---

## SEO (`@mandujs/core`)

### Metadata Types

```typescript
import type { Metadata, MetadataParams, GenerateMetadata } from '@mandujs/core'

// Static metadata (page.tsx or layout.tsx)
export const metadata: Metadata = {
  title: 'Page Title',
  description: 'Page description',
}

// Dynamic metadata
export const generateMetadata: GenerateMetadata = async ({ params }) => ({
  title: `Article: ${params.slug}`,
})
```

### Metadata API

| API | Description |
|-----|-------------|
| `resolveMetadata(items, params?, searchParams?)` | Resolve metadata chain |
| `mergeMetadata(parent, child)` | Merge two metadata objects |
| `createDefaultMetadata()` | Create default resolved metadata |
| `resolveTitle(title, parentTemplate)` | Resolve title with template |
| `renderMetadata(resolved)` | Render to HTML string |

### Open Graph & Twitter

| API | Description |
|-----|-------------|
| `resolveOpenGraph(og, metadataBase)` | Resolve Open Graph metadata |
| `resolveTwitter(twitter, metadataBase)` | Resolve Twitter Card metadata |
| `renderOpenGraph(metadata)` | Render OG tags |
| `renderTwitter(metadata)` | Render Twitter Card tags |

### JSON-LD Helpers

| API | Description |
|-----|-------------|
| `createArticleJsonLd(options)` | Article structured data |
| `createWebSiteJsonLd(options)` | WebSite with search action |
| `createOrganizationJsonLd(options)` | Organization info |
| `createBreadcrumbJsonLd(items)` | Breadcrumb navigation |
| `createFAQJsonLd(questions)` | FAQ page |
| `createProductJsonLd(options)` | Product with offers/ratings |
| `createLocalBusinessJsonLd(options)` | Local business info |
| `createVideoJsonLd(options)` | Video object |
| `createReviewJsonLd(options)` | Review with ratings |
| `createCourseJsonLd(options)` | Course/education content |
| `createEventJsonLd(options)` | Event (physical/virtual) |
| `createSoftwareAppJsonLd(options)` | Software application |

### Sitemap & Robots

| API | Description |
|-----|-------------|
| `renderSitemap(entries)` | Generate sitemap.xml content |
| `renderSitemapIndex(sitemaps)` | Generate sitemap index |
| `renderRobots(config)` | Generate robots.txt content |
| `createSitemapHandler(fn)` | Create sitemap route handler |
| `createRobotsHandler(fn)` | Create robots route handler |
| `createDefaultRobots(sitemapUrl)` | Default robots config |

### SSR Integration

| API | Description |
|-----|-------------|
| `resolveSEO(options)` | Resolve SEO for SSR (async) |
| `resolveSEOSync(metadata)` | Resolve SEO synchronously |
| `injectSEOIntoOptions(options, seoOptions)` | Inject SEO into streaming options |
| `layoutEntriesToMetadataItems(entries)` | Convert layout entries to items |

### Google SEO Rendering

| API | Description |
|-----|-------------|
| `renderGoogle(metadata)` | Google-specific meta (nositelinkssearchbox, notranslate) |
| `renderViewport(metadata)` | Viewport meta tag |
| `renderThemeColor(metadata)` | Theme color with media query support |
| `renderFormatDetection(metadata)` | iOS Safari format detection |
| `renderResourceHints(metadata)` | preconnect, dns-prefetch, preload, prefetch |
| `renderAppLinks(metadata)` | iOS/Android app link meta tags |

---

## MCP SEO Tools (`@mandujs/mcp`)

### SEO Tools

| Tool | Description |
|------|-------------|
| `mandu_preview_seo` | Preview rendered SEO HTML for given metadata |
| `mandu_generate_sitemap_preview` | Generate sitemap.xml preview from entries |
| `mandu_generate_robots_preview` | Generate robots.txt preview from configuration |
| `mandu_create_jsonld` | Create JSON-LD structured data (Article, WebSite, Organization, etc.) |
| `mandu_write_seo_file` | Write sitemap.ts or robots.ts to app directory |
| `mandu_seo_analyze` | Analyze SEO metadata for common issues and recommendations |

### MCP SEO Guides

| Guide | Description |
|-------|-------------|
| `seo` | Complete SEO guide (metadata, Open Graph, JSON-LD, Sitemap) |
