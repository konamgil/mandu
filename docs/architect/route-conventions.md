---
title: Route Conventions
phase: 18.β
status: stable
audience: framework-users, contributors
---

# Route Conventions

Mandu's file-system router recognises the same per-route convention files
as Next.js App Router: `loading.tsx`, `error.tsx`, `not-found.tsx`, plus
`(group)/` route groups and `[[...slug]]` optional catch-all segments.

Each convention attaches a UI behaviour to the *nearest* route up the
segment tree — no manual wiring, no config entries.

## Convention file matrix

| File             | Scope       | Runtime surface                            | SSR wrap                                            |
| ---------------- | ----------- | ------------------------------------------ | --------------------------------------------------- |
| `page.tsx`       | route body  | default export renders at this URL         | inside layout chain                                 |
| `layout.tsx`     | subtree     | wraps every descendant's page              | outer-most of the body                              |
| `loading.tsx`    | subtree     | Suspense fallback while the page suspends  | `<Suspense fallback={<Loading/>}>` around page body |
| `error.tsx`      | subtree     | SSR error boundary (render failures → 500) | swaps page body on throw, layouts preserved         |
| `not-found.tsx`  | subtree     | 404 surface for `notFound()` / no match    | status 404 body, layouts preserved                  |
| `route.ts`       | leaf        | HTTP handler (`GET`/`POST`/…)              | no SSR — returns a `Response`                       |

**Nearest-ancestor resolution.** Each page route carries three resolved
module paths after scanning: `loadingModule`, `errorModule`,
`notFoundModule`. At scan time the scanner walks from the route's own
directory up to `app/` and uses the **first match it finds**. A deeply
nested route silently inherits the parent's UI unless it declares its
own.

## Inheritance diagram

```
app/
  layout.tsx        ← root layout (wraps all)
  loading.tsx       ← fallback for /,   /raw,   /shop/:sku (no local loading)
  error.tsx         ← boundary for /,  /raw,   /dashboard/:id
  not-found.tsx     ← 404 for   /,    /raw,   /docs/*  (no local not-found)
  page.tsx          ← /

  (marketing)/              ← group — stripped from URL, keeps root layout
    pricing/page.tsx        ← /pricing

  docs/
    loading.tsx             ← overrides root for /docs/*
    error.tsx               ← overrides root for /docs/*
    [[...slug]]/page.tsx    ← /docs  and  /docs/a/b/c  (optional catch-all)

  dashboard/
    not-found.tsx           ← overrides root for /dashboard/*
    [id]/page.tsx           ← /dashboard/:id

  raw/page.tsx              ← inherits all three from root
```

Resolved modules per route:

| Route              | loading                | error                | notFound               |
| ------------------ | ---------------------- | -------------------- | ---------------------- |
| `/`                | `app/loading.tsx`      | `app/error.tsx`      | `app/not-found.tsx`    |
| `/pricing`         | `app/loading.tsx`      | `app/error.tsx`      | `app/not-found.tsx`    |
| `/docs/*` *(opt)*  | `app/docs/loading.tsx` | `app/docs/error.tsx` | `app/not-found.tsx`    |
| `/dashboard/:id`   | `app/loading.tsx`      | `app/error.tsx`      | `app/dashboard/not-found.tsx` |
| `/raw`             | `app/loading.tsx`      | `app/error.tsx`      | `app/not-found.tsx`    |

## Route groups — `(name)/`

A directory wrapped in parentheses is stripped from the URL. It **keeps**
the layout chain, so multiple sections can share a layout without
polluting the URL:

```
app/
  (marketing)/
    layout.tsx        ← wraps /pricing and /about, not /dashboard
    pricing/page.tsx  ← URL: /pricing
    about/page.tsx    ← URL: /about
  (app)/
    layout.tsx        ← separate layout for the signed-in app
    dashboard/page.tsx
```

Multiple nested groups compose — `(a)/(b)/c/page.tsx` serves `/c`.

## Optional catch-all — `[[...slug]]`

`[[...param]]` matches both the bare prefix and anything below it:

```
app/docs/[[...slug]]/page.tsx
```

| URL                     | `params.slug`         |
| ----------------------- | --------------------- |
| `/docs`                 | `undefined`           |
| `/docs/intro`           | `"intro"`             |
| `/docs/intro/getting`   | `"intro/getting"`     |

Compared to the required form `[...slug]`, which does **not** match
`/docs` with no remainder.

The router internally emits `:slug*?` for optional and `:slug*` for
required; the Trie's wildcard-with-optional handling covers both.

## SSR wrap order

For a page route with all three convention files present, the rendered
tree at SSR time is:

```
<Layout_1>  … <Layout_N>        ← layout chain (outer-most)
  <ErrorBoundary errorModule>   ← catches render-time throws
    <IslandWrapper?>             ← only if hydration != none
      <Suspense loadingModule>   ← fallback while the page suspends
        <Page params loaderData>
      </Suspense>
    </IslandWrapper>
  </ErrorBoundary>
</Layout_1>
```

- **Error priority**: the error boundary sits *inside* the layout chain
  so layouts stay visible on error. This matches Next.js semantics.
- **Loading priority**: Suspense wraps the page (and island host) so
  async server components / React.lazy islands can suspend without
  blanking the layout.
- **Not-found priority**: per-route `not-found.tsx` wins over the global
  `registerNotFoundHandler()`. The scanner resolved the nearest ancestor
  at scan time; runtime just imports it.

## Next.js App Router parity

| Convention                  | Next.js App Router | Mandu (Phase 18.β) |
| --------------------------- | :---: | :---: |
| `loading.tsx`               | ✅    | ✅    |
| `error.tsx` (client)        | ✅    | ✅ (SSR + dev overlay) |
| `not-found.tsx`             | ✅    | ✅    |
| `global-error.tsx`          | ✅    | via `registerNotFoundHandler` (global) |
| `(group)/`                  | ✅    | ✅    |
| `[param]`                   | ✅    | ✅    |
| `[...slug]` (required)      | ✅    | ✅    |
| `[[...slug]]` (optional)    | ✅    | ✅    |
| `@slot/` (parallel routes)  | ✅    | ⏳ (scanner-only; runtime pending) |
| `default.tsx`               | ✅    | ❌    |
| `template.tsx`              | ✅    | ❌    |
| `interceptors` / `(..)X`    | ✅    | ❌    |
| `loading.tsx` streaming     | ✅    | ✅ (Bun `ReadableStream` via React 19) |

## Backward compatibility

Routes without any convention file are serialised without the optional
keys — existing manifests round-trip unchanged. The `RouteSpec` Zod
schema adds each of `loadingModule` / `errorModule` / `notFoundModule`
as optional, so older tooling that never reads these fields stays
compatible.

A project authored before Phase 18.β picks up the new behaviour on the
next `mandu dev` restart with zero code changes.

## Related

- `packages/core/src/router/fs-patterns.ts` — segment + file detection.
- `packages/core/src/router/fs-scanner.ts` — nearest-ancestor walk
  (`findClosestSpecialFile`).
- `packages/core/src/runtime/server.ts` — Suspense / error / 404 wrap.
- `packages/core/tests/router/route-conventions.test.ts` — regression
  matrix (12 cases).
