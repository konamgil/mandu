---
"@mandujs/core": patch
---

Fix dynamically composed Bun.SQL queries on Bun 1.4.4 by matching the native template literal shape. Legacy synthesized templates remain reusable, and their values continue to be passed as bound parameters.
