---
"@mandujs/core": minor
---

feat(openapi): hoist shared schemas into `components.schemas` with `$ref`

The OpenAPI generator now performs a post-processing pass that detects
structurally-identical object schemas appearing in two or more
requestBody/response sites and hoists them into `components.schemas`,
replacing inline usage with a `$ref` pointer. Result: smaller specs,
deduplicated codegen output.

Behavior:
- Only `type: "object"` schemas with at least one property are hoisted;
  primitives, enums, and unions of primitives stay inline.
- Parameter schemas (path/query/header) are never hoisted.
- Names are derived from `contract.name` (falling back to the route id)
  with method/status qualification. Structurally-different schemas that
  would collide on name get deterministic `_v2` / `_v3` suffixes.
- Hint-less schemas fall back to `Schema_<first-8-hex-of-hash>`.

New generator options (both optional, on by default):
- `hoistSchemas: boolean` (default `true`) — set to `false` to restore
  the previous fully-inline output.
- `hoistThreshold: number` (default `2`, clamps to a minimum of `2`) —
  minimum occurrence count required to hoist.

A new `hoistSharedSchemas(doc, options?)` helper is exported for
callers who want to run the pass against a hand-built document.

Note: projects with shared schemas will see a new `components.schemas`
section in their spec, which changes the SHA-256 ETag served by the
runtime OpenAPI endpoint. This is intentional.
