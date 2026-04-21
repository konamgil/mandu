---
"@mandujs/ate": patch
---

fix(ate/oracle): #231 replace invalid toHaveCount({ min: N }) with count()+toBeGreaterThanOrEqual

Playwright's `toHaveCount(count: number)` takes a number, not an object.
The L1 domain-aware assertion generator was emitting
`await expect(locator).toHaveCount({ min: 1 })` in 10 sites, which
fails at runtime with "expectedNumber: expected float, got object".
Every L2 smoke spec (L2 builds on L1) tripped on this line before any
L2-specific assertion ran.

Replaced with the canonical:
`expect(await locator.count()).toBeGreaterThanOrEqual(N)`

New regression guard in `packages/ate/tests/oracle.test.ts` scans
generated assertions for `toHaveCount(` followed by `{` / `"` / `[`
across every domain × route combo — prevents this class of regression
from shipping again.
