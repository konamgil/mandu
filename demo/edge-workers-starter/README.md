# Mandu Edge — Cloudflare Workers starter

Minimal Mandu app deployed to Cloudflare Workers through
`@mandujs/edge/workers`. Phase 15.1 MVP.

## What's inside

```
app/
├── layout.tsx          — root layout (body wrapper)
├── page.tsx            — "/"  (SSR'd on the Worker)
└── api/
    └── health/
        └── route.ts    — "/api/health" JSON endpoint
mandu.config.ts         — standard Mandu config (Bun dev server)
wrangler.toml           — generated; edit to add bindings, routes, crons
```

## Install

```bash
bun install
```

## Develop locally (two options)

**Option 1 — Bun dev server (recommended for iteration)**

```bash
bun run dev
```

Opens `http://localhost:3333` against Mandu's built-in Bun server, with
full HMR + Kitchen dashboard.

**Option 2 — Wrangler dev (the real Workers runtime)**

```bash
bun run build:workers    # emit .mandu/workers/worker.js
bun run preview          # runs `wrangler dev`
```

## Deploy

```bash
bun run build:workers
bun run deploy           # runs `wrangler deploy`
```

## Bun API compatibility

This demo uses **only runtime-neutral APIs** (JSON responses, filling
`ctx.ok`, WebCrypto). The Workers adapter ships with automatic polyfills
for `Bun.CookieMap` and `Bun.CSRF`; Bun-only APIs (`Bun.sql`, `Bun.s3`,
`Bun.cron`, `Bun.password`) will throw a friendly 500 response until Phase
15.2 ships the HTTP-based replacements.

See the `@mandujs/edge` README for the full compatibility matrix.
