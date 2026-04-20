# Production OpenAPI Endpoint

Mandu can publish the OpenAPI 3.0.3 spec for your contracts at a stable
URL so API consumers (Postman, codegen, Swagger UI proxies, …) have a
canonical source of truth.

Unlike the dev-only Kitchen endpoint
(`/__kitchen/api/contracts/openapi`), the production endpoint is part
of `mandu start` / `mandu dev` and is designed for deploy-time
visibility. It is **disabled by default** — you must opt in explicitly
so an internet-facing deployment never leaks its API surface by
accident.

## Build-time artifacts

`mandu build` always emits the spec to disk whenever at least one
route carries a `contractModule`:

```
.mandu/openapi.json
.mandu/openapi.yaml
```

These files are deploy-time deliverables. You can copy them into a
release artifact, publish them alongside your frontend, or serve them
from an independent documentation site — they exist regardless of
whether the runtime endpoint is enabled.

The build log prints the SHA-256 of the JSON body, which matches the
runtime `ETag` (see below). Use it to verify that a running server is
serving the spec shipped with the current deploy.

## Enabling the runtime endpoint

### Config

```ts
// mandu.config.ts
import type { ManduConfig } from "@mandujs/core";

export default {
  openapi: {
    enabled: true,
    // Optional — defaults to "/__mandu/openapi". Must start with "/".
    // Serves "/__mandu/openapi.json" and "/__mandu/openapi.yaml".
    path: "/__mandu/openapi",
  },
} satisfies ManduConfig;
```

### Environment variable

For one-off probing (e.g., a staging environment that you want to
expose the spec on without editing config), set:

```
MANDU_OPENAPI_ENABLED=1
```

Explicit `openapi.enabled: false` always wins over the env var — the
config is the source of truth.

## Endpoint contract

| Aspect          | Value                                                  |
| --------------- | ------------------------------------------------------ |
| JSON URL        | `<path>.json` (default `/__mandu/openapi.json`)        |
| YAML URL        | `<path>.yaml` (default `/__mandu/openapi.yaml`)        |
| Methods         | `GET`, `HEAD` (405 for everything else)                |
| `Content-Type`  | `application/json` / `application/yaml`                |
| `Cache-Control` | `public, max-age=0, must-revalidate`                   |
| `ETag`          | `"<sha256-hex-of-json-body>"`                          |
| Conditional GET | `If-None-Match` returns 304 on a match                 |

The spec body is loaded from the build-time artifact on first
request and cached for the lifetime of the server instance. Re-deploy
to invalidate. In `mandu dev`, if the artifact is missing, the
endpoint falls back to live generation from the registered manifest
so the dev loop "just works" before your first `mandu build`.

## Serving Swagger UI externally

The framework intentionally does **not** ship a Swagger UI in production
— that would pull JavaScript onto your API surface and is a separate
concern. Front the spec with your existing reverse proxy + a standalone
Swagger UI bundle instead.

### Caddy

```
api.example.com {
  reverse_proxy /__mandu/openapi.* mandu-app:3000
  reverse_proxy /docs* swagger-ui:8080
}
```

### nginx

```nginx
server {
  listen 443 ssl http2;
  server_name api.example.com;

  location /__mandu/openapi.json {
    proxy_pass http://mandu-app:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /docs/ {
    proxy_pass http://swagger-ui:8080/;
  }
}
```

Then point Swagger UI's `url` at `/__mandu/openapi.json`.

## Security notes

- The endpoint is **default-off**. Turning it on exposes your API
  surface to anyone who can reach the server — reason about whether
  that is acceptable for your deployment before flipping the switch.
- Consider placing the endpoint behind your auth gateway (basic auth,
  IP allowlist, VPN, …) instead of serving it publicly.
- The `ETag` is a plain SHA-256 — it identifies the spec, not the
  requester. Treat the spec body as public info whenever the endpoint
  is reachable.
- The spec is regenerated on every `mandu build`. Stale routes/contracts
  that were pruned from your codebase will disappear from the spec on
  the next deploy, which is a feature — but if you depend on contract
  versioning for backwards-compat, pin a copy of the JSON at release
  time (ship a `docs/openapi-v<X>.json` alongside the tag).
