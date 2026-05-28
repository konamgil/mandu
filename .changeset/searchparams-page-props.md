---
"@mandujs/core": patch
---

Pass `searchParams` (query string) to server page components, matching the value `generateMetadata` already receives. Previously only `params` was injected, so query-driven pages (search/filter/compare) rendered empty without any error.
