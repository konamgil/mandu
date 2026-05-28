---
"@mandujs/core": patch
---

Fix three HTTP correctness bugs:

- **#318**: `ctx.body()` now returns **400 Bad Request** for an empty or malformed JSON body instead of a 500 framework-bug error (`MANDU_F999`). A new `BadRequestError` is mapped to a `CLIENT_ERROR` / `MANDU_C400` response.
- **#319**: a route with only a `GET` handler now serves **HEAD** requests per RFC 7231 §4.3.2 — it runs the GET handler and returns the status/headers with an empty body instead of `405`. Explicit HEAD handlers still take precedence; the 405 `Allow` list includes HEAD when GET exists. Applies to both `Mandu.filling()` and `route.ts` method exports.
- **#320**: the built-in default 404 (no `app/not-found.tsx`) now does content negotiation — it returns an HTML page when the request `Accept` includes `text/html` (browser navigation) and keeps the JSON envelope for API/fetch clients.
