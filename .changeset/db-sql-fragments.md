---
"@mandujs/core": minor
---

Add composable SQL fragments to `@mandujs/core/db` for parameter-safe dynamic queries. New `db.sql` / `db.join` (and standalone `sql` / `join` / `isSqlFragment` / `SqlFragment` exports) build inert query fragments that flatten into the surrounding `db`/`db.one` call at execution time — static text inlines, every interpolated value stays a bound parameter. This removes the need to hand-synthesise a `TemplateStringsArray` or fall back to raw `Bun.SQL` for optional/conditional `WHERE` clauses, sort direction, and pagination.
