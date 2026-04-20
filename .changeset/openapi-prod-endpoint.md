---
"@mandujs/core": minor
"@mandujs/cli": patch
---

feat(core,cli): production-grade OpenAPI endpoint (opt-in, ETag'd)

- `mandu build` now emits `.mandu/openapi.json` + `.mandu/openapi.yaml`
  whenever any route carries a `contractModule`.
- New `ManduConfig.openapi: { enabled?, path? }` block exposes the spec
  at `/__mandu/openapi.json` / `.yaml` (default-off). Opt-in via config
  or `MANDU_OPENAPI_ENABLED=1`.
- Response carries `Cache-Control: public, max-age=0, must-revalidate`
  + a SHA-256 ETag; `If-None-Match` short-circuits with 304.
- Replaced the naive regex YAML converter with a conservative YAML 1.2
  subset emitter (stable round-trip through Swagger UI / yq / codegen).
- Kitchen's dev endpoint (`/__kitchen/api/contracts/openapi*`) and the
  new prod endpoint share the same generator module.
- Docs: `docs/runtime/openapi.md`.
