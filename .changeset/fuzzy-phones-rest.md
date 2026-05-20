---
"@mandujs/core": patch
---

Fix route-level default `.client` page wrappers so nested routes hydrate through the real page module instead of generated placeholders or empty island sources.
