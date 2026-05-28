---
"@mandujs/core": patch
---

DevTools (dev-only "Kitchen") security & correctness fixes found in a thorough audit:

- **Path traversal (security)**: the source-context provider's `resolveSafePath` used a prefix `startsWith(root)` check, so a sibling directory sharing the root's prefix (e.g. `/app/project-secrets` vs root `/app/project`) and absolute-path inputs could escape the project root. Now rejects absolute inputs and compares against `root + path.sep` (allowing the root itself). Added a security regression test.
- **PII leak (worker redaction)**: the inline redaction Web Worker's `PII_PATTERNS` was missing the `CARD` and `SSN` patterns present in the real `redaction-worker` module, so credit-card and SSN values were not redacted on the worker path. Patterns are now in sync.
- **Self-tracking loop**: the network proxy did not ignore DevTools' own `/__kitchen/` error-report requests, so error reports were tracked as network events (and a failing report could feed back into more reports). Added `/__kitchen/` to the ignore list.
