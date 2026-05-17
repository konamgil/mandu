---
"@mandujs/cli": patch
---

Fix 8 issues blocking the first-resource workflow (#263–#270):

- **#263/#264/#265 `generate resource`**: emit `spec/resources/<name>.resource.ts` (flat layout) with `export default defineResource(...)` so the parser's default-export contract is satisfied. Generated definitions now include an `id: uuid` primary-key field and an `options.persistence` block (provider auto-detected from `DATABASE_URL`, defaults to `sqlite`) so the new resource is immediately picked up by `mandu db plan`.
- **#266 `db plan` silent fail**: surface a `warning:` line when resources are parsed but every one is dropped by `snapshotFromResources` (missing `options.persistence`). The message names each dropped resource and prints the exact `persistence: { provider, primaryKey }` snippet to paste in.
- **#267 tsconfig invalid pattern**: replace `*/__generated__/*` (TS rejects two wildcards) in the `default`, `auth-starter`, and `realtime-chat` templates with three explicit layer paths (`client/`, `server/`, `shared/__generated__/*`). Eliminates the stderr warning that prefixed every `mandu` command.
- **#268 dev port conflicts**: stop treating the `PORT` environment variable as an *explicit* port. It now seeds the preferred port but auto-falls back to the next free one if taken, so a stray `PORT=3000` from another project no longer crashes `mandu dev`. CLI flag and `mandu.config.ts` `server.port` remain strict.
- **#269 subcommand `--help` fallback**: the router now always prints the command's registered `help` block (or a synthesized summary built from `description` / `subcommands` / `aliases`) instead of dumping the global help, so `mandu create --help`, `mandu db --help`, `mandu db plan --help`, `mandu generate --help`, and `mandu generate resource --help` all show relevant usage. Added a rich `help` block to `mandu generate`.
- **#270 `DATABASE_URL` provider**: `mandu db plan` now parses the URL scheme (`postgres://`, `mysql://`, `sqlite://`) to derive the provider. Empty snapshots inherit the URL-derived provider (was hardcoded `postgres`). When a resource's declared `persistence.provider` disagrees with `DATABASE_URL`, the command exits with a usage error instead of silently producing a useless plan.
