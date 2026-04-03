# Runtime Status Code Policy

This document fixes the current Mandu runtime boundary for server responses.

The goal is simple: the same class of failure should always map to the same HTTP status.

---

## Canonical Mapping

| Situation | Status | Meaning |
|---|---|---|
| Route is not present in the manifest/router | `404` | The runtime does not know this route |
| Static file request targets a known static prefix but the file does not exist | `404` | Known static area, missing file |
| Static file request contains malformed URL encoding or a null byte | `400` | Invalid request syntax |
| Static file request attempts to escape the allowed directory | `403` | Request is understood but forbidden |
| API route exists in the manifest but no runtime handler is registered | `500` | Runtime misconfiguration / framework-side failure |
| Registered handler throws during execution | `500` | Handler/runtime failure |

---

## Static File Scope

This policy applies to:

- `/.mandu/client/*`
- `/public/*`
- `/favicon.ico`
- `/robots.txt`
- `/sitemap.xml`
- `/manifest.json`

For requests outside these paths, normal route matching decides the response.

---

## Notes

- `400` is reserved for malformed static requests such as invalid percent-encoding or null-byte payloads.
- `403` is reserved for directory escape attempts after the request is recognized as a static file request.
- `404` is reserved for unknown routes and missing files inside a recognized static area.
- `500` is reserved for runtime failures, including a manifest route that exists without a registered handler.

Some HTTP clients normalize `/../` segments before the request reaches the server. In those cases an integration test may observe `404` because the normalized path no longer points at the static prefix. For that reason the security test suite uses encoded backslash escape cases to verify the `403` boundary at runtime.

---

## Source of Truth

- Runtime implementation: `packages/core/src/runtime/server.ts`
- Server behavior tests: `packages/core/tests/server/server-core.test.ts`
- Static path security tests: `packages/core/tests/security/path-traversal.test.ts`
- API handler error tests: `packages/core/tests/server/api-methods.test.ts`
