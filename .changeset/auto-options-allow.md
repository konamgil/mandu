---
"@mandujs/core": patch
---

Auto-respond to plain `OPTIONS` requests with `204 No Content` + an `Allow` header (RFC 7231 §4.3.7) when no explicit OPTIONS handler is registered — for both `Mandu.filling()` routes and `route.ts` method-export modules. Previously a plain OPTIONS request returned `405`. CORS preflight requests (carrying `Access-Control-Request-Method`) are left to the normal flow so CORS middleware can attach its `Access-Control-*` headers. Proactive follow-up to the HTTP method-handling cluster (#319 HEAD-as-GET, #321 Allow header).
