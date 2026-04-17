---
"@mandujs/core": major
"@mandujs/cli": major
"@mandujs/mcp": major
"@mandujs/ate": major
"@mandujs/skills": major
---

# Mandu v1.0 — "Battery included"

First stable release. Public APIs are frozen — breaking changes from this point require a **major version bump** (SemVer).

## What's new in v1.0

### Auth primitives (`@mandujs/core/auth/*`)
- `hashPassword` / `verifyPassword` — argon2id via `Bun.password`
- `loginUser` / `logoutUser` / `currentUserId` / `loggedAt`
- `createEmailVerification` — signed token → email → consume
- `createPasswordReset` — single-use reset tokens

### Middleware bundle (`@mandujs/core/middleware/*`)
- `session()` — attaches `ctx.session` from pluggable `SessionStorage`
- `csrf()` — double-submit cookie (Bun.CSRF native or HMAC fallback)
- `oauth()` — OAuth 2.0 + PKCE with GitHub + Google presets
- `rateLimit()` — sliding-window limiter (in-memory + SQLite stores)
- `secure()` — Helmet-equivalent header bundle (CSP, HSTS, frame-options, permissions-policy)

### Data + storage
- `@mandujs/core/db` — `Bun.sql` wrapper: Postgres/MySQL/SQLite unified
- `@mandujs/core/filling/session-sqlite` — SQLite-backed `SessionStorage`
- `@mandujs/core/storage/s3` — `Bun.s3` wrapper (AWS/R2/MinIO)
- `@mandujs/core/email` — abstract `EmailSender` + Resend/memory adapters

### Operations
- `@mandujs/core/scheduler` — in-process cron (`Bun.cron`)
- `@mandujs/core/perf` — `Bun.nanoseconds` instrumentation
- `@mandujs/core/id` — `newId()` UUID v7 (time-ordered)

### Runtime helpers
- `redirect()` / `notFound()` / `unauthorized()` / `forbidden()` / `badRequest()`
- `app/not-found.tsx` routing convention
- `app/error.tsx` boundary receives `{ error, digest }` with stack redaction in production

### Template
- `mandu init --template auth-starter` — official reference app (signup/login/logout/avatar upload/CSRF/session-gc cron)

### Infrastructure
- Bun minimum: **1.3.12** (required for `Bun.cron`, `Bun.CSRF`, `Bun.CookieMap`, `Bun.sql` full coverage)
- `bunfig.toml` `linker = "isolated"` (phantom-dep prevention)
- `workspaces.catalog` dependency centralization
- CI `--randomize --retry=2` on every suite (bundler gated for cross-worker isolation)

## Breaking changes (see `docs/migration/v0-to-v1.md`)
- Bun 1.3.12 engines minimum
- `ctx.cookies.get()` now reflects same-request Set-Cookie writes
- Layout slot cookies propagate to response (previously dropped)

## Stats
- ~460 tests added since Phase 0
- 15+ new public subpath exports
- 0 external npm runtime deps added
- `@aws-sdk/*`, `bcrypt`, `pg`, `better-sqlite3`, `node-cron`, `ioredis`, `helmet`, `nodemailer`, `passport-*` all replaceable with Mandu + Bun natives

Full migration guide: `docs/migration/v0-to-v1.md`
