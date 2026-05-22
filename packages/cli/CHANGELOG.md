# @mandujs/cli

## 0.44.20

### Patch Changes

- Capture inline client component props through SSR server wrappers and infer missing client export names at runtime.

- Updated dependencies []:
  - @mandujs/core@0.54.17
  - @mandujs/mcp@0.38.9
  - @mandujs/edge@0.4.65

## 0.44.19

### Patch Changes

- Update internal Mandu dependency ranges for the hydration payload fix release.

- Updated dependencies []:
  - @mandujs/mcp@0.38.8

## 0.44.18

### Patch Changes

- Refresh internal dependency ranges for the route-level named client bundle fix.

- Updated dependencies []:
  - @mandujs/core@0.54.13
  - @mandujs/mcp@0.38.7
  - @mandujs/edge@0.4.61

## 0.44.17

### Patch Changes

- Refresh internal dependency ranges for the fast-refresh island bundle fix.

- Updated dependencies []:
  - @mandujs/core@0.54.12
  - @mandujs/mcp@0.38.6
  - @mandujs/edge@0.4.60

## 0.44.16

### Patch Changes

- Refresh internal dependency ranges for the route client entry resolution fix.

- Updated dependencies []:
  - @mandujs/core@0.54.11
  - @mandujs/mcp@0.38.5
  - @mandujs/edge@0.4.59

## 0.44.15

### Patch Changes

- Refresh internal dependency ranges for the core route client detection fix.

- Updated dependencies []:
  - @mandujs/core@0.54.10
  - @mandujs/mcp@0.38.4
  - @mandujs/edge@0.4.58

## 0.44.14

### Patch Changes

- Refresh internal Mandu dependency metadata for the route-level hydration wrapper fix.

- Updated dependencies []:
  - @mandujs/mcp@0.38.3

## 0.44.13

### Patch Changes

- Refresh internal dependency ranges for the unified runtime status diagnostics release.

- Updated dependencies []:
  - @mandujs/core@0.54.8
  - @mandujs/mcp@0.38.2
  - @mandujs/edge@0.4.56

## 0.44.12

### Patch Changes

- Refresh internal dependency ranges for the core passthrough client page fix release.

- Updated dependencies []:
  - @mandujs/mcp@0.38.1

## 0.44.11

### Patch Changes

- Updated dependencies []:
  - @mandujs/mcp@0.38.0
  - @mandujs/core@0.54.6
  - @mandujs/edge@0.4.54

## 0.44.10

### Patch Changes

- Fix standalone Windows SSR prerender imports by writing each generated SSR bundle to its own cache directory.

## 0.44.9

### Patch Changes

- Keep the external Bun SSR fallback from externalizing app dependencies while preserving Mandu and React runtime externals.

## 0.44.8

### Patch Changes

- Add `mandu agent context|manifest|plan|apply|verify|repair|sync` as the canonical agent-native CLI workflow and wire it to the shared core agent reports.

- Updated dependencies []:
  - @mandujs/core@0.54.5
  - @mandujs/mcp@0.37.4

## 0.44.7

### Patch Changes

- [`23502f8`](https://github.com/konamgil/mandu/commit/23502f89d7036e032ea129058dfbcd569d56a806) Thanks [@konamgil](https://github.com/konamgil)! - Align guard policy between CLI and MCP, make one-shot guard/check commands exit cleanly, generate init lockfiles from validated config, and keep lefthook templates Windows-portable.

- Updated dependencies [[`8dbdc20`](https://github.com/konamgil/mandu/commit/8dbdc20ac04f5ace48eb579f9f50619d1e6a67fc), [`fbfbf36`](https://github.com/konamgil/mandu/commit/fbfbf36c404edb2831dd1080427d8071cfe1690d), [`9ecb049`](https://github.com/konamgil/mandu/commit/9ecb049add40f51c0113b4acb866d7806b82f717), [`23502f8`](https://github.com/konamgil/mandu/commit/23502f89d7036e032ea129058dfbcd569d56a806)]:
  - @mandujs/core@0.54.3
  - @mandujs/mcp@0.37.3
  - @mandujs/edge@0.4.52

## 0.44.6

### Patch Changes

- Fix issue #273 dogfooding regressions across SSR data documentation, island guidance, dev routing, generators, diagnostics, deploy inference, generated import guards, metadata routes, and JSX title hoisting.

- Updated dependencies []:
  - @mandujs/core@0.54.2
  - @mandujs/mcp@0.37.2
  - @mandujs/ate@0.26.1
  - @mandujs/skills@0.20.1
  - @mandujs/edge@0.4.51

## 0.44.2

### Patch Changes

- [`4d76fae`](https://github.com/konamgil/mandu/commit/4d76faea1c6d1bee0fab512f219e2386a1f33c3e) Thanks [@konamgil](https://github.com/konamgil)! - Fix 8 issues blocking the first-resource workflow (#263–#270):

  - **#263/#264/#265 `generate resource`**: emit `spec/resources/<name>.resource.ts` (flat layout) with `export default defineResource(...)` so the parser's default-export contract is satisfied. Generated definitions now include an `id: uuid` primary-key field and an `options.persistence` block (provider auto-detected from `DATABASE_URL`, defaults to `sqlite`) so the new resource is immediately picked up by `mandu db plan`.
  - **#266 `db plan` silent fail**: surface a `warning:` line when resources are parsed but every one is dropped by `snapshotFromResources` (missing `options.persistence`). The message names each dropped resource and prints the exact `persistence: { provider, primaryKey }` snippet to paste in.
  - **#267 tsconfig invalid pattern**: replace `*/__generated__/*` (TS rejects two wildcards) in the `default`, `auth-starter`, and `realtime-chat` templates with three explicit layer paths (`client/`, `server/`, `shared/__generated__/*`). Eliminates the stderr warning that prefixed every `mandu` command.
  - **#268 dev port conflicts**: stop treating the `PORT` environment variable as an _explicit_ port. It now seeds the preferred port but auto-falls back to the next free one if taken, so a stray `PORT=3000` from another project no longer crashes `mandu dev`. CLI flag and `mandu.config.ts` `server.port` remain strict.
  - **#269 subcommand `--help` fallback**: the router now always prints the command's registered `help` block (or a synthesized summary built from `description` / `subcommands` / `aliases`) instead of dumping the global help, so `mandu create --help`, `mandu db --help`, `mandu db plan --help`, `mandu generate --help`, and `mandu generate resource --help` all show relevant usage. Added a rich `help` block to `mandu generate`.
  - **#270 `DATABASE_URL` provider**: `mandu db plan` now parses the URL scheme (`postgres://`, `mysql://`, `sqlite://`) to derive the provider. Empty snapshots inherit the URL-derived provider (was hardcoded `postgres`). When a resource's declared `persistence.provider` disagrees with `DATABASE_URL`, the command exits with a usage error instead of silently producing a useless plan.

- Updated dependencies [[`b96f439`](https://github.com/konamgil/mandu/commit/b96f439a246a26edaf50104522cacb4d49a533e8), [`48743ed`](https://github.com/konamgil/mandu/commit/48743edec9708e16e73a57e0b11061fe452f04eb)]:
  - @mandujs/core@0.54.0
  - @mandujs/mcp@0.37.0
  - @mandujs/ate@1.0.0
  - @mandujs/edge@0.4.49
  - @mandujs/skills@1.0.0

## 0.44.1

### Patch Changes

- [`72345c3`](https://github.com/konamgil/mandu/commit/72345c38c55ec2418a94ec686de49700e6f5b8bd) Thanks [@konamgil](https://github.com/konamgil)! - Fix MCP boot regressions and DevTools dev-mode UX.

  - `mandu diagnose` adds a `nested_internal_core` check that flags stale `@mandujs/core` installs nested under sibling `@mandujs/*` packages, the root cause behind `Cannot find module @mandujs/core/...` boot failures (#261). Emits a copy-pastable `rm -rf` fix.
  - Dev-mode SSR now injects `_devtools.js` even on SSR-only pages so Kitchen panels work on island-free landing/marketing routes; production builds remain 0 bytes (#259). Explicit `dev.devtools: false` still opts out.
  - `@mandujs/skills` `peerDependencies.@mandujs/core` narrowed from the effectively-wildcard `">=0.1.0"` to `^0.53.0`, and `@mandujs/ate` now declares the same peer (it imports `@mandujs/core/observability` at runtime) — both contributed to package-manager resolver decisions that kept stale cores around (#262).
  - `mandu` project templates make the `prepare` script git-tolerant so `bun install` no longer fails on machines without git in PATH (e.g. GitHub Desktop users on Windows) (#258).

- Updated dependencies [[`72345c3`](https://github.com/konamgil/mandu/commit/72345c38c55ec2418a94ec686de49700e6f5b8bd)]:
  - @mandujs/core@0.53.3
  - @mandujs/skills@0.19.1
  - @mandujs/ate@0.25.2
  - @mandujs/edge@0.4.48
  - @mandujs/mcp@0.36.3

## 0.44.0

### Minor Changes

- [`b5b4598`](https://github.com/konamgil/mandu/commit/b5b45980457f56628721bb3b4e0fad416e56e1bd) Thanks [@konamgil](https://github.com/konamgil)! - Split `mandu init` and `mandu create` semantics, matching the npm/bun ecosystem convention. `mandu create <name>` is now the canonical new-folder scaffold path; `mandu init` (no positional) is a _retrofit_ that drops Mandu structure into the current directory — `package.json` is merged (existing entries preserved unless `--force`) and `app/page.tsx` is created if absent.

  The retrofit flow refuses to run on top of foreign frameworks (Next.js / Vite / Remix detected via config files or deps) and an existing Mandu project (`@mandujs/core` already in deps). For polyglot directories where partial Mandu structure exists, `--force` is required. `--dry-run` prints the planned changes without writing.

  For one deprecation cycle, `mandu init <name>` continues to work — it prints a warning and forwards to `mandu create <name>`. The forwarding will be removed in a future major.

### Patch Changes

- [`be8da02`](https://github.com/konamgil/mandu/commit/be8da023df338d24badb21ffdf213a39b04df016) Thanks [@konamgil](https://github.com/konamgil)! - Add `aliases` field to CommandRegistration so a single registration can be bound under multiple names. Use it to make `mandu create` a true alias of `mandu init` (closes #256 — docs advertised `mandu create` while only `init` was bound). Also makes `mandu g` actually dispatch to `mandu guard` — the `g` alias was previously documented in `--help` but never wired up.

- [`63d8575`](https://github.com/konamgil/mandu/commit/63d8575c9a9a67585e8bde6116fa0aa681950489) Thanks [@konamgil](https://github.com/konamgil)! - Stabilize production hydration gates and client bundle output. Production builds now use explicit build modes, default client output resolves to `.mandu/client`, and the perf harness reports hydration failures without overwriting HTTP-derived metrics.

- Updated dependencies [[`a472bdf`](https://github.com/konamgil/mandu/commit/a472bdf3d565efe7744d993cb899360a78372e43), [`63d8575`](https://github.com/konamgil/mandu/commit/63d8575c9a9a67585e8bde6116fa0aa681950489)]:
  - @mandujs/core@0.53.2
  - @mandujs/edge@0.4.47

## 0.43.0

### Minor Changes

- [`4a3379f`](https://github.com/konamgil/mandu/commit/4a3379f6fc98ad64732caab26a84a7eea32cbec1) Thanks [@konamgil](https://github.com/konamgil)! - feat(#245 M5): Agent Loop & DX — `init --design`, `design link`, `design lint`

  Closes the design-system mechanism initiative. New surfaces wire
  DESIGN.md into the project bootstrap and agent guides so coding
  agents pre-warm with the design context every session.

  **`mandu init --design[=<slug>]`**

  - Bare flag → empty 9-section DESIGN.md skeleton.
  - With slug → import an awesome-design-md brand spec (e.g.
    `--design=stripe`).
  - Always wires AGENTS.md (creating it when missing) so agents see
    the design block immediately. CLAUDE.md is updated when present.

  **`mandu design link [--create]`**

  - Idempotently inserts a markered `## Design System` block into
    AGENTS.md / CLAUDE.md. The block lists all 8 MCP design tools
    with one-line descriptions and spells out the §3.5 5-step
    workflow as a prompt agents follow verbatim.
  - Re-runs replace the markered region only — hand-written prose
    outside the markers is preserved.

  **`mandu design lint`**

  - DESIGN.md self-consistency check: malformed hex, missing values,
    slug collisions in palette/typography/layout/shadows, duplicate
    component H3 names. Three severities (error / warning / info);
    errors fail the command.

  **New core exports** (`@mandujs/core/design`)

  - `linkAgentsToDesignMd({ rootDir, createIfMissing? })` — pure
    helper backing the CLI command. Markered, idempotent.
  - `buildAgentsDesignBlock(filename?)` — generates the markered
    block payload (used by tests and external tooling).
  - `lintDesignSpec(spec)` — pure lint engine.
  - `DESIGN_LINK_MARKER_START` / `DESIGN_LINK_MARKER_END` constants.

  23 new core tests (linker insert/replace/idempotent/create-if-
  missing + lint rules across all 4 token sections + clean spec
  sanity). End-to-end smoke on a tmp project verified `lint` reports
  both warning categories and `link` inserts the block under an
  existing AGENTS.md.

  Closes #245 — Phase 1 milestone set complete: M1 (parser/scaffold)
  → M2 (Guard) → M3 (Tailwind theme) → M4 (8 MCP tools) → M5 (agent
  loop / lint / link).

### Patch Changes

- Updated dependencies [[`4a3379f`](https://github.com/konamgil/mandu/commit/4a3379f6fc98ad64732caab26a84a7eea32cbec1)]:
  - @mandujs/core@0.53.0
  - @mandujs/edge@0.4.45
  - @mandujs/mcp@0.36.1

## 0.42.2

### Patch Changes

- Updated dependencies [[`aeb9657`](https://github.com/konamgil/mandu/commit/aeb9657e3eaf59c012530ec5bf3577c90514e03d)]:
  - @mandujs/core@0.52.0
  - @mandujs/mcp@0.36.0
  - @mandujs/edge@0.4.44

## 0.42.1

### Patch Changes

- Updated dependencies [[`274e7a3`](https://github.com/konamgil/mandu/commit/274e7a3a47cdd5ad736e02f1301d7f434f4de93b)]:
  - @mandujs/core@0.51.0
  - @mandujs/mcp@0.35.0
  - @mandujs/edge@0.4.43

## 0.42.0

### Minor Changes

- [`e41e3af`](https://github.com/konamgil/mandu/commit/e41e3af8cf6f7cb5fb552ca3a402c3e9cf1a89e7) Thanks [@konamgil](https://github.com/konamgil)! - feat(#245 M3): DESIGN.md → Tailwind v4 `@theme` Token Bridge

  `mandu design sync` reads a parsed DESIGN.md and compiles its
  structured tokens (color palette, typography, layout/spacing, depth
  & elevation) into a Tailwind v4 `@theme` block, then merges that
  block into `globals.css` between `@mandu-design-sync` markers — so
  hand-written CSS outside the markers is preserved verbatim.

  **New core surface** (`@mandujs/core/design`)

  - `compileTailwindTheme(spec)` — pure compiler returning
    `{ entries, warnings, cssBody }`. Variable naming follows Tailwind
    v4 convention: `--color-<slug>`, `--font-<slug>`, `--text-<slug>`,
    `--spacing-<slug>`, `--shadow-<slug>`.
  - `mergeThemeIntoCss(existingCss, compiled)` — replaces the
    markered region; falls back to inserting a fresh block when none
    exists. Surfaces conflicts when a DESIGN.md token contradicts a
    hand-written `@theme` declaration.
  - `slugifyTokenName()` / `THEME_MARKER_START` / `THEME_MARKER_END`
    for tooling that needs to introspect the same naming rules.

  **New CLI subcommand**: `mandu design sync`

  - `--dry-run` — print compiled `@theme` without writing.
  - `--css-path <path>` — override the auto-detected CSS file
    (defaults walk `app/globals.css` → `src/globals.css` → `src/app/globals.css`
    → `src/styles/globals.css`).
  - Surfaces compile warnings (missing values, slug collisions) and
    merge conflicts inline.

  15 new tests cover the slug normaliser, every section's emit shape,
  the markered merge (insert / replace / strip), and a Stripe-like
  end-to-end DESIGN.md.

  Closes #245 M3 (Team E — Token Bridge).

### Patch Changes

- Updated dependencies [[`e41e3af`](https://github.com/konamgil/mandu/commit/e41e3af8cf6f7cb5fb552ca3a402c3e9cf1a89e7)]:
  - @mandujs/core@0.50.0
  - @mandujs/edge@0.4.42
  - @mandujs/mcp@0.34.2

## 0.41.1

### Patch Changes

- [`0eb7ce7`](https://github.com/konamgil/mandu/commit/0eb7ce723004dcc1be08232ec6e7a818d0e73cb2) Thanks [@konamgil](https://github.com/konamgil)! - feat(#250 M5): `.deploy()` DSL on Mandu.filling() — explicit override path

  The Filling builder gains a chainable `.deploy(intent)` method that
  pins the DeployIntent for a route. The build-time extractor flows
  captured intents into `.mandu/deploy.intent.json` as
  `source: "explicit"`, which the M1 planner protects from inference.
  Result: the user's `.deploy()` always wins over heuristic + brain.

  ```ts
  // app/api/embed/route.ts
  export default Mandu.filling()
    .deploy({ runtime: "bun", regions: ["icn1"] })
    .post(async (ctx) => Response.json({ ok: true }));
  ```

  **New API**

  - `ManduFilling.deploy(intent)` — chainable, validates immediately
    (a typo like `runtime: "lambdda"` fails at module load).
  - `ManduFilling.getDeployIntent()` — read accessor used by the
    extractor and tests.

  **New core exports** (`@mandujs/core/deploy`)

  - `extractExplicitIntents(rootDir, manifest, options?)` — dynamic-
    imports each route, captures `getDeployIntent()` returns.
    Errors are non-fatal and surfaced per-route.
  - `mergeExplicitIntents(cache, entries, rootDir, manifest)` — folds
    captured intents into a cache as `source: "explicit"` with the
    current file hash so drift detection still works.

  **CLI integration**

  - `mandu deploy:plan` runs the extractor BEFORE `planDeploy`. The
    user's `.deploy()` overrides land as explicit cache rows ahead of
    inference, so the heuristic/brain only sees the routes the user
    hasn't pinned. Errors surface as `(filling.deploy) <route>: ...`
    in the plan output.

  10 new unit tests cover the chainable method, immediate validation,
  the extractor's import-failure / non-filling-default / missing-file
  paths, and the merge step's source-hash recomputation.

  Closes the #250 RFC Phase 1 milestone set: M1 (schema + cache +
  heuristic) → M2 (deploy:plan CLI) → M3 (Vercel compiler) → M4
  (brain inference) → M5 (Filling DSL).

- Updated dependencies [[`0eb7ce7`](https://github.com/konamgil/mandu/commit/0eb7ce723004dcc1be08232ec6e7a818d0e73cb2)]:
  - @mandujs/core@0.49.0
  - @mandujs/edge@0.4.41
  - @mandujs/mcp@0.34.1

## 0.41.0

### Minor Changes

- [`fcaa77d`](https://github.com/konamgil/mandu/commit/fcaa77d7d01353fd63a1c69f0a61bde674a78d4f) Thanks [@konamgil](https://github.com/konamgil)! - feat(#250 M4): brain-validated deploy intent inference

  `mandu deploy:plan --use-brain` (and the MCP `mandu.deploy.plan`
  tool with `use_brain: true`) wraps the offline heuristic with the
  OAuth-backed brain adapter. The brain confirms or refines each
  route's intent without ever blocking the pipeline:

  **Wrap-not-replace shape**

  - Heuristic runs first (cost cap: ~80% of routes correct, $0).
  - Brain weighs in on the same context and writes its own JSON.
  - Output is parsed → Zod-validated → re-checked against route shape
    (`isStaticIntentValidFor`). Any failure falls back to heuristic
    with a rationale prefix that explains why.

  **Failure modes (all silent fall-back)**

  - LLM throws (network, auth, rate limit) — heuristic survives.
  - LLM returns empty / non-JSON — heuristic survives.
  - LLM returns JSON that fails the Zod schema — heuristic survives.
  - LLM returns `runtime: "static"` on a dynamic page without
    `generateStaticParams` — heuristic survives.

  **Surfacing the brain status**

  - CLI: `🧠 Using brain (openai) to refine heuristic intents.` plus
    a clear "Run `mandu brain login --provider=openai`" hint when
    `--use-brain` is passed without a token.
  - MCP: response carries `brain_status` (`used:openai`,
    `unavailable:needs_login`, `unavailable:opted_out`,
    `not_requested`) so agents can drive the login flow programmatically.

  **New core export**: `inferDeployIntentWithBrain({ adapter })` —
  the same wrapper kitchen / future MCP surfaces can plug in.

  9 brain inferer tests cover happy path, partial-output merging,
  fenced-JSON stripping, every fallback class, and `failOnError`
  propagation. CLI and MCP gain integration tests for the
  no-token / brain-active branches.

### Patch Changes

- Updated dependencies [[`fcaa77d`](https://github.com/konamgil/mandu/commit/fcaa77d7d01353fd63a1c69f0a61bde674a78d4f)]:
  - @mandujs/core@0.48.0
  - @mandujs/mcp@0.34.0
  - @mandujs/edge@0.4.40

## 0.40.1

### Patch Changes

- Updated dependencies [[`1672c27`](https://github.com/konamgil/mandu/commit/1672c27ebdaa0882278141f26625f2bf9351979a)]:
  - @mandujs/mcp@0.33.0

## 0.40.0

### Minor Changes

- [`9e9741f`](https://github.com/konamgil/mandu/commit/9e9741f46e20da586fbb1041738e6e1b8afb95f7) Thanks [@konamgil](https://github.com/konamgil)! - feat(#250 M3): Vercel adapter is a DeployIntent compiler

  The Vercel adapter no longer scaffolds a hand-writable `vercel.json`
  from a fixed template. It now reads `.mandu/deploy.intent.json`
  (produced by `mandu deploy:plan`) plus the routes manifest and
  **compiles** the intents into the actual `vercel.json` shape:

  - `functions` block per non-static route, with `runtime` mapped from
    the intent (`edge` → `"edge"`, `bun` → `"@vercel/bun@1.0.0"`,
    `node` → built-in)
  - per-route `Cache-Control` headers from `intent.cache`
  - `regions` and `maxDuration` from `intent.regions` / `intent.timeout`
  - `intent.overrides.vercel` shallow-merges onto the function entry
    (memory, custom fields)

  The compile primitive lives in `@mandujs/core/deploy` as
  `compileVercelJson(manifest, cache, options)` so kitchen / MCP /
  future CI surfaces can reuse it. Hard-error class:
  `VercelCompileError` lists every route the cache cannot represent
  (missing intent, invalid `runtime: "static"` on dynamic-no-params).

  **Backward compat**: when `.mandu/deploy.intent.json` is absent the
  adapter falls back to the legacy static-only template and points the
  user at `mandu deploy:plan`.

  **Issue #248 gap**: the compiler emits `@vercel/bun@1.0.0` and surfaces
  a warning even though the package isn't published yet — once it ships,
  no compile change is required.

  Real-world end-to-end: `bun run mandu deploy --target=vercel --dry-run`
  on mandujs.com now compiles 5 routes (3 static + 2 edge functions)
  into a 6-header `vercel.json` with per-route Cache-Control directives.

### Patch Changes

- Updated dependencies [[`9e9741f`](https://github.com/konamgil/mandu/commit/9e9741f46e20da586fbb1041738e6e1b8afb95f7)]:
  - @mandujs/core@0.47.0
  - @mandujs/edge@0.4.39
  - @mandujs/mcp@0.32.4

## 0.39.0

### Minor Changes

- [`8d9ca34`](https://github.com/konamgil/mandu/commit/8d9ca34cbb61ef0d90e512ec18d2ca34dd2e5779) Thanks [@konamgil](https://github.com/konamgil)! - feat(#250 M2): `mandu deploy:plan` — infer DeployIntent for every route

  Wraps the M1 plan engine in an interactive CLI command. Reads `app/`,
  runs the offline heuristic inferer, renders a per-route diff, and
  writes `.mandu/deploy.intent.json` (with confirmation by default,
  non-interactive on `--apply` / `--dry-run`).

  ```
  $ mandu deploy:plan --dry-run
  Mandu deploy:plan — inferred intents
  ────────────────────────────────────────────────
  5 added

  + api-health                               /api/health
     runtime: edge, cache: no-store, visibility: public
     rationale: API route with only fetch-class dependencies …
  + $lang                                    /:lang
     runtime: static, cache: { sMaxAge=31536000, swr=86400 }, visibility: public
     rationale: dynamic page exports generateStaticParams — …
  …
  Dry run complete — cache file untouched.
  ```

  Flags:

  - `--apply` write without prompting (CI-safe)
  - `--dry-run` render plan, do not prompt or write
  - `--reinfer` force re-inference even on unchanged sources
  - `--verbose` include unchanged rows in the diff
  - `--use-brain` reserved for M4 (no-op for now)

  Also fixes the M1 dynamic-pattern detector to recognise Mandu's
  `:param` / `*` route patterns in addition to the bracket form. Without
  this, `[lang]/page.tsx` was misclassified as non-dynamic in M1.

  Adapters / brain inferer plug into the same flow without changing the
  plan engine.

### Patch Changes

- Updated dependencies [[`8d9ca34`](https://github.com/konamgil/mandu/commit/8d9ca34cbb61ef0d90e512ec18d2ca34dd2e5779)]:
  - @mandujs/core@0.46.1
  - @mandujs/edge@0.4.37

## 0.38.0

### Minor Changes

- [`aad5d69`](https://github.com/konamgil/mandu/commit/aad5d695889ff9f59a6a1381969c0c70f2cfd80e) Thanks [@konamgil](https://github.com/konamgil)! - refactor(brain): remove Ollama tier; cloud OAuth is the only non-template adapter

  The local-LLM (Ollama) tier is gone. The brain resolver now resolves
  in priority order **openai → anthropic → template**, and the
  `adapter` config union no longer accepts `"ollama"`. The `ollama` npm
  dependency is removed from `@mandujs/core`.

  `BrainAdapterResolution` gains a `needsLogin: boolean` field so
  interactive surfaces can detect "fell back to template because the
  user has no token" vs "fell back because the user opted out". The new
  `ensureBrainLogin()` helper in `@mandujs/cli` reads that signal and
  prompts to run `mandu brain login --provider=openai` when needed.

  `mandu brain status` surfaces the same hint inline. The MCP
  `mandu.brain.status` tool exposes `needs_login` + `login_hint` so AI
  agents can drive the login flow programmatically.

  **Migration**: any `ManduConfig` block that set `brain.adapter = "ollama"`
  or `brain.ollama.*` must be removed — the schema now rejects them.
  Default behavior (omitted block) is unchanged: auto-resolves to the
  best available cloud tier, falls back to template otherwise.

### Patch Changes

- Updated dependencies [[`aad5d69`](https://github.com/konamgil/mandu/commit/aad5d695889ff9f59a6a1381969c0c70f2cfd80e), [`aad5d69`](https://github.com/konamgil/mandu/commit/aad5d695889ff9f59a6a1381969c0c70f2cfd80e)]:
  - @mandujs/core@0.46.0
  - @mandujs/mcp@0.32.3
  - @mandujs/edge@0.4.36

## 0.37.0

### Minor Changes

- [`117fd08`](https://github.com/konamgil/mandu/commit/117fd08c674e2e13d60f8a66295caf23eae1db78) Thanks [@konamgil](https://github.com/konamgil)! - feat(#245 M1): DESIGN.md primitives — parser + scaffold + import + validate

  Issue #245 M1 minimal slice. Adopts Google Stitch's 9-section DESIGN.md convention as Mandu's first-class design system spec. Mandu provides the _mechanism_, not the _content_ — users either start from an empty 9-section skeleton or import any of the 69 brand specs from `VoltAgent/awesome-design-md` (MIT) by slug.

  **Public surface (`@mandujs/core/design`)**:

  - `parseDesignMd(source)` — never-throwing markdown walker that extracts colour palette, typography, components (with variants), layout/spacing, shadows, dos & don'ts, responsive breakpoints, and agent prompts. Unrecognised H2 headings round-trip via `extraSections`.
  - `validateDesignSpec(spec)` — diagnostic for missing / empty / malformed sections (advisory, not a build gate).
  - `EMPTY_DESIGN_MD` — canonical empty 9-section skeleton with HTML-comment example tokens. Designed to be filled incrementally.
  - `fetchUpstreamDesignMd(slug)` — raw GitHub fetch from `awesome-design-md` (or any URL).

  **CLI**:

  - `mandu design init` — write empty skeleton (or `--from <slug>` to import).
  - `mandu design import <slug|url>` — swap to a different brand spec.
  - `mandu design validate` — report gaps without blocking.

  Subsequent slices (separate PRs) add `pick` (interactive catalog), `diff` (upstream comparison), and `extract` (token proposal from source).

### Patch Changes

- Updated dependencies [[`117fd08`](https://github.com/konamgil/mandu/commit/117fd08c674e2e13d60f8a66295caf23eae1db78), [`4faa29d`](https://github.com/konamgil/mandu/commit/4faa29d2c528718f15a9f62ce16c25da0a6758d4), [`eceec68`](https://github.com/konamgil/mandu/commit/eceec68445d8674a54be4fd27020b014c5c2ed6c)]:
  - @mandujs/core@0.45.0
  - @mandujs/edge@0.4.34
  - @mandujs/mcp@0.32.2

## 0.36.0

### Minor Changes

- [`b3f3899`](https://github.com/konamgil/mandu/commit/b3f389979d236c3b8977f4a95dc11796ef14a112) Thanks [@konamgil](https://github.com/konamgil)! - feat(#240): React Compiler auto-detect (Phase 2)

  `experimental.reactCompiler.enabled` defaults to **auto** when unset:

  - `enabled: true` — user opts in explicitly. Plugin runs; warns when peer deps are missing (unchanged).
  - `enabled: false` — user opts out explicitly. Plugin never runs (unchanged).
  - _unset_ (default) — `Bun.resolveSync` probes for `@babel/core` + `babel-plugin-react-compiler` in the project's `node_modules`. Both present → auto-enable. Either missing → stay disabled silently (no warning).

  Net effect: `bun add -d @babel/core babel-plugin-react-compiler` is now the only step needed to turn auto-memoization on. No `mandu.config.ts` change required.

  `mandu build`, `mandu dev`, and `mandu check` all flow through the new resolver (`@mandujs/core/bundler/plugins#resolveReactCompilerConfig`), so the bundler's transform plugin and the bailout-lint runner stay in sync. When auto-detect kicks in, build/dev print `🧠 React Compiler — auto-detected peer deps; auto-memoization enabled.` once per session.

  Tests in `packages/core/src/bundler/plugins/__tests__/react-compiler-config.test.ts`.

### Patch Changes

- Updated dependencies [[`b3f3899`](https://github.com/konamgil/mandu/commit/b3f389979d236c3b8977f4a95dc11796ef14a112)]:
  - @mandujs/core@0.44.0
  - @mandujs/edge@0.4.33
  - @mandujs/mcp@0.32.1

## 0.35.0

### Minor Changes

- [`56a3203`](https://github.com/konamgil/mandu/commit/56a320315b80014f8a8bb74cc548ec425e24167d) Thanks [@konamgil](https://github.com/konamgil)! - feat(#249): `mandu build --static` flat-export mode

  `mandu build --static[=<dir>]` runs the normal build and then materializes a single host-ready directory shaped like the URL space — prerendered HTML at the root, client bundles preserved at `<dir>/.mandu/client/...` so the absolute URLs the prerender step already wrote into HTML resolve, and `public/` files merged at the root. Default output dir is `dist/`. Refuses to overwrite the project root or `.mandu/` itself, and fails loud if the build did not actually produce HTML or client bundles. Tests in `packages/cli/src/util/__tests__/static-export.test.ts`.

  fix(#248): Vercel adapter pivots to static-only

  The previous adapter scaffolded an SSR function targeting `@vercel/bun@1.0.0`, which is not a published Vercel runtime — every deploy failed at vercel.json validation with `The package "@vercel/bun" is not published on the npm registry`. None of the actually-published function runtimes (built-in Node, Edge, `@vercel/python`) can host Mandu's `startServer` because core uses Bun-only globals.

  The adapter now generates a static-only `vercel.json` (`outputDirectory: "dist"`, `buildCommand: "bun run mandu build --static"`, no `functions`/`runtime`/SSR rewrites). `check()` warns when the manifest contains API routes that the static build will drop on the floor. The SSR entry template (`renderVercelFunctionEntry`) is removed; restore it once an official Vercel Bun function runtime ships.

## 0.34.4

### Patch Changes

- [`782ed46`](https://github.com/konamgil/mandu/commit/782ed468a463a7426140d109fb359cd437d03ec4) Thanks [@konamgil](https://github.com/konamgil)! - fix(#247): Vercel adapter generates a deployable SSR artifact

  - Bug 4: rename SSR function from `api/_mandu.ts` to `api/mandu.ts` — Vercel hides leading-underscore files in `/api` (Next.js `_app`/`_document` convention) so the previous filename was silently dropped from function detection.
  - Bug 5: move `registerManifestHandlers` from `@mandujs/cli/util/handlers` to `@mandujs/core/runtime`. The CLI subpath has no `exports` map, so the generated SSR entry could not import it under strict resolution. Now exported from the public `@mandujs/core` surface — same package the entry already imports `startServer`/`generateManifest` from.

  The Netlify adapter template was changed alongside since it had the same private-import smell. JIT prewarm's deep-specifier list was updated to point at `@mandujs/core/runtime` instead of the deleted `cli/util/handlers`.

- Updated dependencies [[`782ed46`](https://github.com/konamgil/mandu/commit/782ed468a463a7426140d109fb359cd437d03ec4)]:
  - @mandujs/core@0.43.1
  - @mandujs/edge@0.4.32

## 0.34.3

### Patch Changes

- [`6f82f0c`](https://github.com/konamgil/mandu/commit/6f82f0c8dc105518af57ff4cb9896475e6ac7e3c) Thanks [@konamgil](https://github.com/konamgil)! - fix(#246): Vercel adapter emits valid `vercel.json` and Bun-compatible SSR entry

  - Drop invalid `functions[*].runtime: "nodejs20.x"` (Vercel rejects bare identifiers)
  - Default to `@vercel/bun@1.0.0` community runtime — Mandu core uses Bun-only APIs
  - Drop deprecated top-level `name` field (owned by Vercel project settings)
  - Rewrite `api/_mandu.ts` entry to export Bun-style `{ fetch }` instead of Node `IncomingMessage`/`ServerResponse`
  - Validate `runtime` as npm package spec; reject bare identifiers with a clear error

## 0.34.2

### Patch Changes

- [`33c12d0`](https://github.com/konamgil/mandu/commit/33c12d0809da59dd0c0dbfabf3ae6ebf6ce1f060) Thanks [@konamgil](https://github.com/konamgil)! - fix(#244 follow-up): ship template `.gitignore` as `gitignore` +
  rename on extraction.

  The first 0.34.1 patch shipped `.oxlintrc.json` but not `.gitignore`
  — npm and bun publish unconditionally strip `.gitignore` from
  tarballs regardless of the `files` field. That meant the template
  manifest's static `import ... with { type: "file" }` still pointed
  at three missing paths in the published package, so Bun's resolver
  kept throwing a non-Error `{}` at module load time. Rename the
  template source files to plain `gitignore` and restore the dot on
  extraction via `renameNpmStrippedDotfile()`.

## 0.34.1

### Patch Changes

- [`d4d9dfd`](https://github.com/konamgil/mandu/commit/d4d9dfd391544a5e0cca5ed79921b848468091fd) Thanks [@konamgil](https://github.com/konamgil)! - fix(#244): `mandu lint` and `mandu lint --setup` crashed with
  "Unknown error occurred (non-Error thrown)" on every invocation
  because the npm tarball didn't ship `.oxlintrc.json` — the `files`
  glob excluded dotfiles, so the template manifest's static
  `import … with { type: "file" }` threw a non-Error `ResolveMessage`
  at module-load time.

  - `files` now includes `templates/**/.*` — `.oxlintrc.json` and
    `.gitignore` land in the published tarball.
  - `mandu lint` wraps its entry in a try/catch that coerces
    non-Error throws into a legible message.
  - The CLI's top-level error handler stringifies non-Error throws so
    the next similar bug report includes something actionable instead
    of a placeholder.

## 0.34.0

### Minor Changes

- [`fe765d1`](https://github.com/konamgil/mandu/commit/fe765d1c5c0d054ea890f5c38a1c6f3751226dba) Thanks [@konamgil](https://github.com/konamgil)! - feat: lint as default guardrail across CLI, MCP, and skills

  Positions oxlint as the third guardrail axis alongside `mandu guard`
  (architecture) and `tsgo` (types). Every Mandu surface now treats
  lint as a first-class default:

  - **`mandu check`** — runs oxlint when available, adds the result to
    the health score. Errors flip exit; warnings are reported.
  - **`mandu build`** — pre-build lint gate. Errors block the build;
    `--no-lint` opts out for emergency deploys.
  - **`mandu init` templates** — `default` / `auth-starter` /
    `realtime-chat` ship `lefthook.yml` (pre-push: typecheck + lint
    in parallel), `lefthook` devDep, and `prepare: "lefthook install"`.
  - **MCP tools** — new `mandu.lint` (read-only runner) and
    `mandu.lint.setup` (destructive installer wrapping the CLI
    command). `dryRun: true` previews.
  - **Skills** — new `mandu-lint` SKILL.md covering guardrail
    positioning, setup, type-aware, safe-autofix pattern, and
    anti-patterns. `mandu-guard-guide` gains a 3-axis header.
    `mandu-mcp-verify` fast path becomes 4-parallel (lint joins
    ate/guard/doctor) with a new lint drill-down branch.
    `mandu-mcp-safe-change` Step 4 explicitly includes lint.

### Patch Changes

- Updated dependencies [[`fe765d1`](https://github.com/konamgil/mandu/commit/fe765d1c5c0d054ea890f5c38a1c6f3751226dba)]:
  - @mandujs/mcp@0.32.0
  - @mandujs/skills@0.19.0

## 0.33.0

### Minor Changes

- [`9c9da1b`](https://github.com/konamgil/mandu/commit/9c9da1b5a8f0ceceeaf869dcbc1ce0237018a013) Thanks [@konamgil](https://github.com/konamgil)! - feat(cli): `mandu lint` + `mandu lint --setup` — bring oxlint to existing projects

  - `mandu lint` runs the project's `lint` script (usually `oxlint .`);
    emits a clear `--setup` hint when the script is missing.
  - `mandu lint --setup` installs oxlint into an existing Mandu project
    in one shot: copies `.oxlintrc.json` from the embedded `default`
    template (skipped when one already exists), wires
    `scripts.lint` + `scripts.lint:fix` (never overwriting a
    pre-existing script), adds `devDependencies.oxlint ^1.61.0`, runs
    `bun install`, and prints the current `error` / `warning` baseline.
  - `--dry-run` and `--yes` flags supported. Running the command twice
    produces no second-pass changes ("nothing to do").
  - Closes the gap for users whose projects predate the oxlint adoption
    in `mandu init`; see `docs/tooling/eslint-to-oxlint.md` §1.5.

## 0.32.0

### Minor Changes

- [`f92151b`](https://github.com/konamgil/mandu/commit/f92151b2ef129b1dff068024fb527b443874d50e) Thanks [@konamgil](https://github.com/konamgil)! - feat(guard): #follow-up-E `mandu guard --type-aware` bridge

  Wires `oxlint --type-aware` (tsgolint) into Mandu Guard as an opt-in
  type-aware lint layer that runs after the architecture / layer check.

  - **`@mandujs/core/guard/tsgolint-bridge`** — new module. Spawns
    `oxlint --type-aware --format=json` with `Bun.spawn`, translates each
    diagnostic into the existing `Violation` contract, and returns a
    `{ violations, summary, skipped? }` envelope. Graceful skip when the
    binary is absent (`node_modules/.bin/oxlint[.exe]` missing →
    `{ skipped: "oxlint-not-installed" }`). 60s wall-clock timeout
    (`MANDU_TSGOLINT_TIMEOUT_MS` env override for slow agents).

  - **`ManduConfig.guard.typeAware`** — new optional config block.
    Fields: `rules?: string[]` (allowlist), `severity?: "off"|"warn"|"error"`,
    `configPath?: string`. Declaring the block flips the default to "on"
    for `mandu guard`; the CLI's `--no-type-aware` flag always wins.

  - **`mandu guard --type-aware` / `--no-type-aware`** — CLI flags on
    `guard-arch`. Type-aware errors flip the exit code; warnings alone
    stay green (CI flag escalates warnings, matching the architecture
    pass). JSON output mode emits a secondary `{ typeAware }` JSON document.

  - **`mandu_guard_check` MCP tool** — gains a `typeAware?: boolean`
    input field; response JSON mirrors the CLI shape via a new
    `typeAware` field (skip reason, summary, violations).

  No new runtime dependencies — `oxlint` stays a user-side dev dep.
  Existing architecture-layer Guard tests unchanged (272 pass). Adds
  21 new tests (15 bridge + 6 CLI) covering rule-id normalization,
  severity mapping, diagnostic translation, binary resolution,
  graceful skip, severity=off short-circuit, filter allowlist, and
  CLI exit-code gating.

- [`ad21b50`](https://github.com/konamgil/mandu/commit/ad21b50a5740754031a39f36d484f30ecb93013c) Thanks [@konamgil](https://github.com/konamgil)! - feat: #240 React Compiler + #241 island UX + #242 content watch + #243 docs MCP

  **#240 — React Compiler opt-in** (@mandujs/core, @mandujs/cli)

  - New `@mandujs/core/bundler/plugins/react-compiler` — inline-ported
    Bun plugin that runs `babel-plugin-react-compiler` over the
    client-bundle path (islands / `"use client"` / partial). SSR paths
    are deliberately skipped — re-render memoization has zero value on
    a one-shot HTML render.
  - `ManduConfig.experimental.reactCompiler.{enabled,compilerConfig,strict}`
    — opt-in flag + passthrough config + Phase-2 CI-strict switch.
  - `@babel/core` + `babel-plugin-react-compiler` declared as optional
    peer deps; missing install degrades to a logged warning.
  - React peer pinned to `^19.2.0` across root + core + all three user
    templates (react-compiler runtime needs ≥19.1).
  - Dev bundler forwards the flag through every `buildClientBundles()`
    rebuild path; CLI `mandu dev` reads `config.experimental.reactCompiler`.
  - **Phase 2** — `mandu check` runs `eslint-plugin-react-compiler`
    over the exact files the bundler would compile and surfaces
    bailouts. `strict: true` makes any bailout a non-zero exit. ESLint
    - plugin are optional peers; missing install skips diagnostics with
      a warning.
  - New `docs/architect/react-compiler.md` — activation, scope, peer
    deps, bailout behaviour, dev/prod trade-offs, CI-strict mode.

  **#241 — island authoring UX fixes** (@mandujs/core)

  - Export `Mandu` alias of `ManduClient` so the README's documented
    `Mandu.island/filling` shape resolves at runtime.
  - `scanIslandFiles()` now also descends into `_components/` +
    `_islands/` sibling folders (one level) — previously only the
    page's own directory was scanned, silently dropping co-located
    islands.
  - `CompiledIsland` is now a callable React component whose body
    throws a clear `[Mandu Island] Islands are page-level client
bundles …` message pointing at `partial()` — replaces React's
    opaque "Element type is invalid... got: object" error.

  **#242 — content collection dev server watcher** (@mandujs/core, @mandujs/cli)

  - `Collection` constructor registers into a module-scoped Set;
    `getRegisteredCollections()` + `invalidateAllCollections()` exposed
    from `@mandujs/core/content`.
  - Dev bundler watches `content/` by default, classifier routes
    `*.{mdx,md,yaml,yml,json}` under that directory to a new
    `content-change` batch kind, and `handleContentChange` invalidates
    every registered collection + fires optional `onContentChange`
    callback.
  - CLI `mandu dev` wires the callback to a `full-reload` HMR
    broadcast so sidebars / route trees refresh without a manual
    restart.

  **#243 — docs MCP tools** (@mandujs/mcp)

  - `mandu.docs.search({ query, scope?, limit?, includeBody? })` —
    offline keyword search over the project's `docs/` markdown tree.
    Scored by title / body hits, bounded (5 000 files max, 280-char
    excerpts), traversal-safe.
  - `mandu.docs.get({ slug })` — fetch a single markdown page by
    relative slug. Pairs with `search` for ground-truth answers.

  Both tools are read-only, offline, and add zero new dependencies.

### Patch Changes

- Updated dependencies [[`f92151b`](https://github.com/konamgil/mandu/commit/f92151b2ef129b1dff068024fb527b443874d50e), [`ad21b50`](https://github.com/konamgil/mandu/commit/ad21b50a5740754031a39f36d484f30ecb93013c)]:
  - @mandujs/core@0.43.0
  - @mandujs/mcp@0.31.0
  - @mandujs/edge@0.4.31

## 0.31.0

### Minor Changes

- [`b55ff48`](https://github.com/konamgil/mandu/commit/b55ff489517d48777d8367b007ffc2a7fb334003) Thanks [@konamgil](https://github.com/konamgil)! - feat(cli/deploy): render.com adapter

  Seventh deploy adapter. Generates a render.yaml Blueprint matching
  the layout in mcp/resources/skills/mandu-deployment/rules/
  deploy-platform-render.md — curl-installs Bun inside Render's node
  runtime, pipes PORT via fromService, surfaces user env vars as
  sync:false entries for dashboard config.

  Scope — web service + optional Postgres database block. Redis and
  worker services deferred. No API-key workflow yet; users push to Git
  and Render picks up the Blueprint.

  `mandu deploy --target=render` wires through the same adapter
  registry as fly/railway/vercel. 17 new tests.

## 0.30.4

### Patch Changes

- Updated dependencies [[`cb32140`](https://github.com/konamgil/mandu/commit/cb32140b58aef9cc8d78a5d4975329cc8d81b2a7)]:
  - @mandujs/ate@0.25.1
  - @mandujs/mcp@0.30.0

## 0.30.3

### Patch Changes

- Updated dependencies [[`e56697e`](https://github.com/konamgil/mandu/commit/e56697eaabef2d615f9d637f8b10d152006a0975)]:
  - @mandujs/core@0.42.0
  - @mandujs/ate@0.25.0
  - @mandujs/mcp@0.29.0
  - @mandujs/edge@0.4.30

## 0.30.2

### Patch Changes

- [`e73b68d`](https://github.com/konamgil/mandu/commit/e73b68df10bb006a675794a1b4eaec6442fe015e) Thanks [@konamgil](https://github.com/konamgil)! - fix(brain): resolver + status now see ChatGPT session token; MCP login spawns codex directly

  Two bugs landed together:

  1. After `mandu brain login --provider=openai` succeeded the resolver
     still reported `Active tier: ollama`. `resolveBrainAdapter` only
     probed the keychain and ignored `~/.codex/auth.json`. Added
     `probeChatGPTAuth()` hook (checks via `ChatGPTAuth.isAuthenticated`)
     to both the explicit-openai path and the auto-resolve path. CLI
     `brain status` now shows `openai : logged in (ChatGPT session at
...auth.json, managed by @openai/codex)`.

  2. MCP `mandu.brain.login` previously bailed with `{ ok: false,
reason: "not_a_tty" }` because an MCP server has no terminal. But
     Codex CLI itself opens the user's default browser via OS handlers
     (`start` / `open` / `xdg-open`) — a TTY isn't required. Rewrote
     the MCP handler to `spawn('npx @openai/codex login')` as a child
     process, capture stdout for the OAuth URL, and poll for
     `~/.codex/auth.json` up to `waitMs` (default 3 min). Works from
     any MCP client without requiring a `pty` MCP.

  Resolver gets a new `probeChatGPTAuth` option on
  `BrainAdapterConfig` (tests inject a stub returning `{ authenticated:
false, path: null }` so the developer's real auth.json doesn't leak
  into unit-test expectations).

- Updated dependencies [[`e73b68d`](https://github.com/konamgil/mandu/commit/e73b68df10bb006a675794a1b4eaec6442fe015e)]:
  - @mandujs/core@0.41.1
  - @mandujs/mcp@0.28.1
  - @mandujs/edge@0.4.28

## 0.30.1

### Patch Changes

- Updated dependencies [[`a76eb21`](https://github.com/konamgil/mandu/commit/a76eb21625d9b1fa6bba074c8efe347662f316c6)]:
  - @mandujs/mcp@0.28.0

## 0.30.0

### Minor Changes

- [`eea2ff9`](https://github.com/konamgil/mandu/commit/eea2ff982cf210d6d5d6a7eaf06a3667de92ca3d) Thanks [@konamgil](https://github.com/konamgil)! - feat(brain): delegate OpenAI login to `@openai/codex` — real OAuth flow works today

  Earlier the OpenAI adapter shipped with placeholder OAuth endpoints
  (`https://platform.openai.com/oauth/authorize` + a `mandu-brain-cli`
  client id) that were never registered with OpenAI. Nobody could
  actually sign in.

  Fix — piggy-back on the OpenAI-official Codex CLI:

  - `mandu brain login --provider=openai` now shells out to
    `npx @openai/codex login`. OpenAI handles the browser OAuth flow with
    its real app (`app_EMoamEEZ73f0CkXaXp7hrann`) and writes the token
    into `~/.codex/auth.json`. Mandu never has its own OAuth app.
  - New `ChatGPTAuth` helper at `@mandujs/core` reads whatever auth.json
    `codex login` produced (`CHATGPT_LOCAL_HOME` / `CODEX_HOME` /
    `~/.chatgpt-local/auth.json` / `~/.codex/auth.json`, in order), auto-
    refreshes the access token against `auth.openai.com/oauth/token`
    5 minutes before JWT `exp`, and rewrites auth.json atomically with
    mode 0600.
  - `OpenAIOAuthAdapter` now calls `ChatGPTAuth` first; the legacy
    keychain path is preserved as a fallback for enterprise OpenAI
    proxies that wire their own OAuth app.
  - 401 from the Chat Completions endpoint triggers one `ChatGPTAuth
.getAuth()` re-read (which refreshes if needed); persistent 401 on
    the ChatGPT path intentionally does NOT scrub auth.json (we must
    not race the user's codex session). The keychain fallback keeps its
    scrub-on-persistent-401 behavior.

  Ported from the same pattern kakao-bot-sdk uses in
  `src/auth/chatgpt.ts` — the approach is proven in production there.

  8 new tests covering JWT parsing, expiry-driven refresh, missing-token
  error shapes, and disk persistence.

### Patch Changes

- Updated dependencies [[`eea2ff9`](https://github.com/konamgil/mandu/commit/eea2ff982cf210d6d5d6a7eaf06a3667de92ca3d)]:
  - @mandujs/core@0.41.0
  - @mandujs/edge@0.4.27
  - @mandujs/mcp@0.27.2

## 0.29.0

### Minor Changes

- [`6ded2af`](https://github.com/konamgil/mandu/commit/6ded2af0bed3eaec90aafa0e0d7b077099d07ecc) Thanks [@konamgil](https://github.com/konamgil)! - #235 brain OAuth adapters (OpenAI + Anthropic)

  Adds two new LLM adapters to `@mandujs/core/brain` that use the user's
  own OAuth credentials — Mandu stays a connector, never owns API keys or
  billing.

  - OpenAI OAuth adapter (default model `gpt-4o-mini`)
  - Anthropic OAuth adapter (default model `claude-haiku-4-5-20251001`)
  - Auto-detect resolver order: openai → anthropic → ollama → template
  - OS keychain storage (`security` on macOS / `secret-tool` on Linux /
    `0600` filesystem fallback on Windows + everywhere else). No `keytar`
    dependency.
  - `mandu brain login` / `logout` / `status` CLI subcommands
  - `ManduConfig.brain = { adapter, openai, anthropic, ollama, telemetryOptOut }`
  - Privacy: first-use consent prompt (cached per-provider / per-project
    at `~/.mandu/brain-consent.json`), per-request secret redactor (API
    keys, Bearer tokens, `.env` refs, JWTs), audit log at
    `.mandu/brain-redactions.jsonl`

  `telemetryOptOut: true` keeps everything local (resolver falls to
  ollama / template regardless of stored tokens).

  No breaking change: existing configs without a `brain` block behave as
  `adapter: 'auto'`. Existing `mandu brain setup` / `mandu brain status`
  paths remain available.

### Patch Changes

- Updated dependencies [[`6ded2af`](https://github.com/konamgil/mandu/commit/6ded2af0bed3eaec90aafa0e0d7b077099d07ecc), [`6ded2af`](https://github.com/konamgil/mandu/commit/6ded2af0bed3eaec90aafa0e0d7b077099d07ecc)]:
  - @mandujs/core@0.40.0
  - @mandujs/skills@0.18.0
  - @mandujs/edge@0.4.25
  - @mandujs/mcp@0.27.1

## 0.28.11

### Patch Changes

- [`49353c7`](https://github.com/konamgil/mandu/commit/49353c70415c31fec1501bb39c16652dce47f80a) Thanks [@konamgil](https://github.com/konamgil)! - fix(core,cli): #232 follow-up — eager page-component registration

  The initial #232 fix (dev server bypasses the prerender cache) unmasked
  a latent lazy-registration race: `registerPageHandler` /
  `registerPageLoader` only install thunks at HMR reload time; the actual
  page component is registered inside `routeComponents` when the first
  request triggers `loadPageData`. If the HMR-broadcast reload hits any
  code path that reaches `createDefaultAppFactory` before the lazy
  import completes, the fallback "404 - Route Not Found" renders even
  for perfectly valid routes (e.g. `[lang]/page.tsx` with a slot module).

  Previously, the prerender cache short-circuit masked this path — users
  never saw the 404 because the prerendered HTML was served instead.

  Fix: a new `prewarmPageRoutes(registry?)` public helper iterates every
  registered pageHandler / pageLoader and drives it through the same
  import + `registerRouteComponent` that the first request would. The
  CLI dev command invokes it at every registration site:

  - initial boot (`mandu dev`)
  - SSR change rebuild
  - API change re-register
  - route manifest watcher
  - full `restartDevServer`

  Prewarm failures log a per-route warning but do not block the reload —
  a single broken file stays broken while healthy routes keep serving.
  Production `mandu start` is unaffected (no HMR, no reload race).

- Updated dependencies [[`49353c7`](https://github.com/konamgil/mandu/commit/49353c70415c31fec1501bb39c16652dce47f80a)]:
  - @mandujs/core@0.39.2
  - @mandujs/edge@0.4.23

## 0.28.10

### Patch Changes

- [`e77b035`](https://github.com/konamgil/mandu/commit/e77b035dd28cc256a596fe5221f781c5609645e9) Thanks [@konamgil](https://github.com/konamgil)! - feat(core,ate,mcp,cli): Phase C — primitives + mutation + RPC + oracle

  Ships ATE v2 Phase C (docs/ate/phase-c-spec.md, 364-line spec):

  - 5 Mandu-specific assertion primitives in @mandujs/core/testing:
    expectContract(strict/loose/drift-tolerant), expectNavigation,
    waitForIsland (data-hydrated polling), assertStreamBoundary
    (<!--$--> marker count + shell budget), expectSemantic
    (agent-delegated, CI non-blocking).
  - 9 contract-semantic mutation operators (remove_required_field,
    narrow_type, widen_enum, flip_nullable, rename_field,
    swap_sibling_type, skip_middleware, early_return,
    bypass_validation). runner writes tmpdir, kills/survives/timeout
    classification. mutationScore + severity report via
    mandu_ate_mutate + mandu_ate_mutation_report.
  - RPC parity: defineRpc extractor emits rpc_procedure nodes,
    context scope "rpc" with dot-notation id, boundary probe works
    automatically on input schemas.
  - Oracle queue: .mandu/ate-oracle-queue.jsonl, mandu_ate_oracle_pending /
    verdict / replay. Semantic judgments deferred to agent session,
    deterministic CI never blocked. promoteVerdicts regresses past
    fails on next run.
  - Prompt catalog +3: island_hydration, streaming_ssr, rpc_procedure.

  Test counts: ate 575 / mcp 220. Typecheck clean across 7 packages.
  ATE v2 core surface complete.

- Updated dependencies [[`e77b035`](https://github.com/konamgil/mandu/commit/e77b035dd28cc256a596fe5221f781c5609645e9)]:
  - @mandujs/core@0.39.0
  - @mandujs/ate@0.24.0
  - @mandujs/mcp@0.27.0
  - @mandujs/edge@0.4.21
  - @mandujs/skills@17.0.0

## 0.28.9

### Patch Changes

- [`0aa24be`](https://github.com/konamgil/mandu/commit/0aa24be35be5db3774881da319fa04bf6dc72bcd) Thanks [@konamgil](https://github.com/konamgil)! - Phase B — boundary probe + memory + impact v2 + coverage

  Ships ATE v2 Phase B (docs/ate/phase-b-spec.md):

  - `mandu_ate_boundary_probe`: Zod contract → deterministic boundary set.
    18 type mappings (string/number/boolean/array/object/enum/union/literal
    plus min/max/email/uuid/regex/int/optional/nullable/nullish) —
    `expectedStatus` derived from contract response schema (400/422 for
    invalid, 200/201 for valid), depth-1 default with max 3,
    category+value dedup.
  - `mandu_ate_recall` + `mandu_ate_remember`: append-only
    `.mandu/ate-memory.jsonl`. 7 event kinds: intent_history,
    rejected_spec, accepted_healing, rejected_healing,
    prompt_version_drift, boundary_gap_filled, coverage_snapshot.
    Substring + token-overlap scoring; auto-rotate at 10 MB to
    `.mandu/ate-memory.<ts>.jsonl.bak`. Auto-record hooks on
    `mandu_ate_save` (intent_history), `applyAutoHeal`
    (accepted_healing), and first-of-day `mandu_ate_context`
    (coverage_snapshot).
  - `mandu_ate_impact` v2: git diff classification (additive / breaking /
    renaming via Levenshtein ≥ 0.8), affected spec/contract resolution,
    suggestion list keyed to re_run / heal / regenerate /
    add_boundary_test. Supports `since: "HEAD~1" | "staged" | "working"`.
    v1 output fields preserved for backwards compatibility.
    `mandu ate watch` CLI (fs.watch + 1 s debounce) streams impact v2 on
    working-tree changes.
  - `mandu_ate_coverage`: route × contract × invariant matrix.
    `withBoundaryCoverage` / `withPartialBoundary` / `withNoBoundary`
    derived from boundary-probe presence in covering specs; invariant
    detection for csrf / rate_limit / session / auth / i18n;
    severity-ranked `topGaps` (high / medium / low).
  - Prompt catalog +3: `property_based.v1`, `contract_shape.v1`,
    `guard_security.v1`. 12+ new `@ate-exemplar:` tags across
    `packages/core/tests/**` and `packages/ate/tests/exemplar-sources/`.
  - `mandu ate memory clear` / `mandu ate memory stats` CLI subcommands.

  Tests: +94 ate (429 → 523) + +10 mcp (194 → 204) + +3 cli.
  `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck` clean across
  all 7 packages.

- Updated dependencies [[`0aa24be`](https://github.com/konamgil/mandu/commit/0aa24be35be5db3774881da319fa04bf6dc72bcd)]:
  - @mandujs/ate@0.22.0
  - @mandujs/mcp@0.25.0

## 0.28.8

### Patch Changes

- [`2013674`](https://github.com/konamgil/mandu/commit/20136745bcc3d5758d7221608e15e24cafb31239) Thanks [@konamgil](https://github.com/konamgil)! - feat(ate,mcp,cli): Phase A.3 — prompt catalog v1 + exemplar system

  Ships ATE v2 Phase A.3 per `docs/ate/roadmap-v2-agent-native.md` §7 and the 2026-04-21 extension block.

  - **Prompt catalog** — 3 Markdown prompts in `packages/ate/prompts/`: `filling_unit.v1.md`, `filling_integration.v1.md`, `e2e_playwright.v1.md`. Each under 2000 tokens, English body, Korean intent comments allowed. YAML frontmatter carries `kind`, `version`, `base`, `audience`, `mandu_min`. Every prompt documents MUST-USE primitives, NEVER-DO anti-patterns, the Mandu `data-route-id` / `data-island` / `data-slot` / `data-action` selector convention, 127.0.0.1-over-localhost rule, and a `<!-- EXEMPLAR_SLOT -->` injection point.
  - **`prompt-loader`** — reads `.vN.md` files, parses frontmatter, returns `{frontmatter, body, sha256}` with a stable sha256 cache key. Also accepts un-versioned alias files.
  - **`exemplar-scanner`** — walks `.ts`/`.tsx` with ts-morph, captures the full source of the `test()`/`it()`/`describe()` call following every `@ate-exemplar:` or `@ate-exemplar-anti:` marker. Distinguishes real comment markers from string-literal fixtures + JSDoc examples. Manually curated per §11 decision #2 (no auto-heuristic).
  - **`prompt-composer`** — end-to-end helper that loads a template, selects 2-3 matching positive exemplars + (up to) 1 anti-exemplar, replaces `<!-- EXEMPLAR_SLOT -->` with a formatted Examples / Anti-examples section, and appends a JSON-serialized context block. Returns ready-to-send-to-LLM string + `tokenEstimate`.
  - **`spec-linter`** (ate barrel) — shared lint pass for agent-generated test content: ts-morph syntax parse, banned import typos (e.g. `@mandu/core` → `@mandujs/core`), unknown `@mandujs/*` barrels, unused/unresolved imports, bare `localhost` URLs (blocks — prefer 127.0.0.1 per roadmap §9.2), hand-rolled CSRF cookies when `createTestSession` is available, DB mocks when `createTestDb` is available.
  - **3 new MCP tools** (snake_case per §11 #4):
    - `mandu_ate_prompt` — when `context` is passed, returns the fully composed prompt (template + matched exemplars + serialized context); otherwise returns the raw template + sha256 + an exemplar peek so the agent composes.
    - `mandu_ate_exemplar` — returns the `@ate-exemplar:` tagged tests for a kind, with code + metadata; `includeAnti:true` opt-in for negative examples.
    - `mandu_ate_save` — lint-before-write persister. Runs `spec-linter`; any blocking diagnostic aborts the write with a structured list the agent can address and retry against.
  - **CLI** — new `mandu ate lint-exemplars` subcommand. Scans the repo, flags orphan markers (no following test block), anti-markers missing `reason=`, and unknown kinds. Exits 1 on any problem (CI-friendly). `--json` for machine output.
  - **Prompt goldens** — `packages/ate/tests/prompts/<kind>.golden.md` captures the canonical composer output per kind; re-generate with `UPDATE_GOLDEN=1 bun test`.
  - **Exemplar tagging sprint** — 18 positive + 2 anti-exemplars tagged across core filling tests, core server integration tests, and the demo auth-starter E2E suite.

  35 new tests across `@mandujs/ate`, `@mandujs/mcp`, and `@mandujs/cli`. Typecheck clean across all 7 packages. No new runtime dependencies (ts-morph + zod already present).

- Updated dependencies [[`2013674`](https://github.com/konamgil/mandu/commit/20136745bcc3d5758d7221608e15e24cafb31239), [`2013674`](https://github.com/konamgil/mandu/commit/20136745bcc3d5758d7221608e15e24cafb31239)]:
  - @mandujs/ate@0.21.0
  - @mandujs/mcp@0.24.0

## 0.28.7

### Patch Changes

- Updated dependencies [[`81b4ff7`](https://github.com/konamgil/mandu/commit/81b4ff7adfbba4daeb070fdc6ff41a2e851c53fd)]:
  - @mandujs/ate@0.20.0
  - @mandujs/mcp@0.23.0

## 0.28.6

### Patch Changes

- [`8e53ca0`](https://github.com/konamgil/mandu/commit/8e53ca007cd588ce3cba0866222f5eb1982d01bd) Thanks [@konamgil](https://github.com/konamgil)! - fix(core,cli): #223 dual-stack default + #225 truthful startup banner

  **#223 — Default `server.hostname` is now `"::"` (IPv6 wildcard,
  dual-stack) instead of `"0.0.0.0"` (IPv4-only).** Bun leaves
  `IPV6_V6ONLY` off, so a single socket accepts both IPv4 (as
  IPv4-mapped IPv6) and IPv6 clients — effectively covering what users
  expected `"0.0.0.0"` to do. This silently fixes the Windows trap where
  Node 17+ `fetch("http://localhost:PORT")` resolves `localhost` to
  `::1` first and hit `ECONNREFUSED ::1:PORT` against an IPv4-only
  bind. `curl` and browsers silently fell back to IPv4, hiding the bug
  until a Node client (Playwright test runner, ATE-generated specs)
  tried to reach the server.

  Explicit `"0.0.0.0"` is still honored — users who need IPv4-only
  binds for container/firewall reasons keep that option. On Windows
  only, Mandu emits a one-line warning so the IPv6-localhost trap is
  discoverable:

  ```
  ⚠️  hostname="0.0.0.0" binds IPv4 only; Node fetch('localhost:PORT')
     may fail on Windows (prefers ::1). Consider hostname="::" for
     dual-stack.
  ```

  **#225 — The startup banner no longer lies about reachability.** The
  old code unconditionally printed

  ```
  🥟 Mandu server listening at http://localhost:3333
     (also reachable at http://127.0.0.1:3333, http://[::1]:3333)
  ```

  regardless of the actual bind address. When bound to `"0.0.0.0"` the
  `[::1]` URL never answered. The new `reachableHosts(hostname)` helper
  (exported from `@mandujs/core`) derives the URL list deterministically
  from the bind address:

  - `"0.0.0.0"` → `["127.0.0.1"]` only.
  - `"::"` / `"::0"` / `"[::]"` / `"0:0:0:0:0:0:0:0"` →
    `["127.0.0.1", "[::1]"]`.
  - `"::1"` / `"127.0.0.1"` / a specific IP → just that address.
  - DNS name → just that name.

  `formatServerAddresses()` consumes `reachableHosts()` so both the
  `startServer` banner and the `mandu start` / `mandu dev` CLI banners
  only promise addresses that actually answer.

  No new dependencies. Docker setups that pin `hostname: "0.0.0.0"`
  (explicit) are not silently upgraded.

- Updated dependencies [[`927544c`](https://github.com/konamgil/mandu/commit/927544c265a0eceff9143e5e5991d5365208ea85), [`8e53ca0`](https://github.com/konamgil/mandu/commit/8e53ca007cd588ce3cba0866222f5eb1982d01bd)]:
  - @mandujs/ate@0.19.2
  - @mandujs/core@0.37.0
  - @mandujs/edge@0.4.20
  - @mandujs/mcp@0.22.4
  - @mandujs/skills@16.0.0

## 0.28.5

### Patch Changes

- Updated dependencies [[`88d597a`](https://github.com/konamgil/mandu/commit/88d597ad50d5ac219e68f458e746f4f649de2c50)]:
  - @mandujs/core@0.36.0
  - @mandujs/edge@0.4.19
  - @mandujs/mcp@0.22.3
  - @mandujs/skills@15.0.0

## 0.28.4

### Patch Changes

- [`5c9bac1`](https://github.com/konamgil/mandu/commit/5c9bac1afd3d769ec5889ec5ac65b6d587ff9f51) Thanks [@konamgil](https://github.com/konamgil)! - feat(core,cli): production-grade OpenAPI endpoint (opt-in, ETag'd)

  - `mandu build` now emits `.mandu/openapi.json` + `.mandu/openapi.yaml`
    whenever any route carries a `contractModule`.
  - New `ManduConfig.openapi: { enabled?, path? }` block exposes the spec
    at `/__mandu/openapi.json` / `.yaml` (default-off). Opt-in via config
    or `MANDU_OPENAPI_ENABLED=1`.
  - Response carries `Cache-Control: public, max-age=0, must-revalidate`
    - a SHA-256 ETag; `If-None-Match` short-circuits with 304.
  - Replaced the naive regex YAML converter with a conservative YAML 1.2
    subset emitter (stable round-trip through Swagger UI / yq / codegen).
  - Kitchen's dev endpoint (`/__kitchen/api/contracts/openapi*`) and the
    new prod endpoint share the same generator module.
  - Docs: `docs/runtime/openapi.md`.

- Updated dependencies [[`5c9bac1`](https://github.com/konamgil/mandu/commit/5c9bac1afd3d769ec5889ec5ac65b6d587ff9f51)]:
  - @mandujs/core@0.35.0
  - @mandujs/edge@0.4.17
  - @mandujs/mcp@0.22.2
  - @mandujs/skills@14.0.0

## 0.28.3

### Patch Changes

- [`fce3797`](https://github.com/konamgil/mandu/commit/fce37970baf884a7f864642333b17070777fa57c) Thanks [@konamgil](https://github.com/konamgil)! - feat(cli): ship `mandu info` — agent-friendly env + config + health dump

  Replace the 87-line stub with a full 8-section snapshot command covering mandu
  versions, runtime, project, config summary, routes, middleware, plugins, and
  diagnose. Supports `--json` for issue reports and `--include <sections>` for
  scoped output. Missing config is a non-crash path — the command is an inspector,
  not a gate.

## 0.28.2

### Patch Changes

- Phase 18 Wave E7 — 본연 주변 primitives 완결.

  **φ Bundle size budget** — `ManduConfig.build.budget` per-island + total raw/gz caps, mode `'error'|'warning'`, `mandu build --no-budget` bypass, analyzer HTML에 budget bar inline.

  **χ Accessibility audit** (`@mandujs/core/a11y`) — `mandu build --audit` axe-core 실행, optional peerDep (axe-core/jsdom/happy-dom 없으면 graceful skip), 25+ rule fix-hints, `--audit-fail-on=<impact>` 게이트.

  **ψ Perf marks dev API** — `time()` / `timeAsync()` / `createPerf()` zero-overhead disabled path + OTel span 자동 생성 + `/_mandu/heap` histogram (p50/p95/p99, LRU 1000).

  +61 regression tests, 7 packages typecheck clean, zero new runtime deps.

- Updated dependencies []:
  - @mandujs/core@0.34.0
  - @mandujs/edge@0.4.14
  - @mandujs/mcp@0.22.1
  - @mandujs/skills@13.0.0

## 0.28.1

### Patch Changes

- fix: #213/#216 prerender + #217 silent + #218 Cache-Control + #219
  asset crawl + #220 SPA-nav swap.

  - **#213** crawler strips code regions (pre/code/fenced/inline/comment)
    - DEFAULT_CRAWL_DENYLIST (`/path`, `/example`, `/your-*`)
  - **#216** PrerenderError distinguishes missing export vs user throw;
    `--prerender-skip-errors` flag
  - **#217** `ServerOptions.silent` suppresses transient prerender banner
    during `mandu build`
  - **#218** Hash-aware Cache-Control + strong ETag for
    `/.mandu/client/*` (stable URL → `must-revalidate`, hashed URL →
    `immutable`)
  - **#219** `DEFAULT_ASSET_EXTENSIONS` (25 img/font/doc/media/text)
    filters `/hero.webp`/`/doc.pdf` from crawler + `build.crawl.
assetExtensions` override
  - **#220** SPA-nav body swap: logs every failure path with
    `[mandu-spa-nav]` prefix, selector cascade `main → #root → body`,
    script re-execution via `document.createElement`,
    `__MANDU_SPA_NAV__` CustomEvent, hard-nav fallback on all failures

  Quality: 7 packages typecheck clean, +100 regression tests, zero new
  runtime deps.

- Updated dependencies []:
  - @mandujs/core@0.33.1
  - @mandujs/edge@0.4.13

## 0.28.0

### Minor Changes

- Phase 18 Wave E6 + #214/#215.

  **π Guard dependency graph** — `mandu guard --graph` → `.mandu/guard/graph.html` (self-contained SVG, dark theme, click-to-drill, XSS-safe).

  **σ Test convergence** — `@mandujs/core/testing/reporter` (human/JSON/JUnit/lcov formats), `--reporter` CLI flag, per-metric coverage thresholds enforcement, unified watch-mode UX.

  **τ Plugin API 강화** — 7 new hook types (`onRouteRegistered`, `onManifestBuilt`, `definePrerenderHook`, `defineBundlerPlugin`, `defineMiddlewareChain`, `defineTestTransform`, `onBundleComplete`) + `definePlugin()` helper + 3 example plugins.

  **#214 dynamicParams route guard** — `export const dynamicParams = false` forces 404 on params outside `generateStaticParams` result (Next.js parity).

  **#215 diagnose 보강** — 5 new checks (`manifest_freshness`, `prerender_pollution`, `cloneelement_warnings`, `dev_artifacts_in_prod`, `package_export_gaps`) + new `mandu diagnose` CLI + MCP unified shape.

  Quality: 7 packages typecheck clean, +195 regression tests, zero new deps.

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.33.0
  - @mandujs/mcp@0.22.0
  - @mandujs/edge@0.4.12
  - @mandujs/skills@12.0.0

## 0.27.8

### Patch Changes

- Phase 18 Wave E5 + #211/#212 hotfixes.

  **μ i18n framework-level** (`@mandujs/core/i18n`) — `defineI18n({ locales, defaultLocale, strategy })` 4 strategies (path-prefix/domain/header/cookie), 자동 route synthesis, `ctx.locale`/`ctx.t` 타입드 헬퍼, Vary/Content-Language 헤더, 307 redirect.

  **ν defineGuardRule API** (`@mandujs/core/guard/define-rule` + `rule-presets`) — consumer custom guard rule + 3 presets (`forbidImport`, `requireNamedExport`, `requirePrefixForExports`).

  **ξ Streaming SSR + React.use()** — `resolveAsyncElement` streaming 경로 serialize 버그 fix: TTFB 250ms → 10ms (25×). `loading.tsx` Suspense streams 검증. React 19 `use(promise)` 지원.

  **#212** — `cloneElement` array 전달로 인한 spurious "missing key" 경고 fix (spread 로 variadic).

  **#211** — `mandu start` stale/dev/empty manifest silent accept fix.

  Quality: 7 packages typecheck clean, +208 new regression tests, zero
  new runtime deps.

- Updated dependencies []:
  - @mandujs/core@0.32.0
  - @mandujs/edge@0.4.11
  - @mandujs/mcp@0.21.1
  - @mandujs/skills@11.0.0

## 0.27.7

### Patch Changes

- Phase 18 Wave E3+E4 — Mandu 차별화 레이어 완성.

  **ι AI refactor MCP tools** (`@mandujs/mcp`):

  - `mandu.refactor.rewrite_generated_barrel` — `__generated__/*` → `getGenerated()` + `GeneratedRegistry` augmentation
  - `mandu.refactor.migrate_route_conventions` — 인라인 Suspense/ErrorBoundary/NotFound → per-route convention files
  - `mandu.refactor.extract_contract` — 인라인 Zod 스키마 → `contract/<group>.contract.ts`

  **κ Typed RPC** (`@mandujs/core`):

  - `defineRpc({ method: { input, output, handler } })` + `createRpcClient<typeof rpc>()` Proxy 기반 end-to-end type inference. Zod 검증. tRPC 의존 없음.

  **λ Bun.cron scheduler** (`@mandujs/core` + `@mandujs/cli`):

  - `defineCron({ name, schedule, timezone, runOn, handler })` Bun.cron 기반
  - `mandu build --target=workers` 시 `[triggers] crons = [...]` 자동 emission
  - Cron 표현식 + timezone Intl 검증

  Quality: 7 packages typecheck clean, +132 regression tests, zero new
  runtime deps.

- Updated dependencies []:
  - @mandujs/core@0.31.0
  - @mandujs/mcp@0.21.0
  - @mandujs/edge@0.4.10
  - @mandujs/skills@10.0.0

## 0.27.6

### Patch Changes

- Phase 18 Wave E2 — runtime depth (ISR + bundle analyzer + OTel tracing).

  **ζ ISR + cache tags** — filling loader가 `{ _cache: { tags, maxAge, staleWhileRevalidate } }` 반환 or `ctx.cache.tag('x').maxAge(10).swr(3600)` fluent API. `revalidate(tag)` tag-based invalidation. `Cache-Control` + `X-Mandu-Cache` 헤더 자동. Next.js ISR parity.

  **η Bundle analyzer** — `mandu build --analyze` → `.mandu/analyze/report.html` (self-contained SVG treemap, dark theme, click-to-drill) + `report.json`. Per-island raw+gz, shared chunk dedupe detection, top-20 heaviest modules. 외부 dep 없음.

  **θ Request tracing** — W3C Trace Context + AsyncLocalStorage propagation, Console + OTLP HTTP exporters. `ctx.span` + `ctx.startSpan(name, fn)` filling integration. Hand-rolled OTLP JSON encoding (opentelemetry-js dep 없음). Honeycomb / Jaeger / Tempo 호환.

  Quality: 7 packages typecheck clean, +84 regression tests, zero new
  runtime deps.

- Updated dependencies []:
  - @mandujs/core@0.30.0
  - @mandujs/edge@0.4.9
  - @mandujs/mcp@0.20.7
  - @mandujs/skills@9.0.0

## 0.27.5

### Patch Changes

- Phase 18 Wave E1 — convention parity with Next.js / Astro / SvelteKit
  (5 orthogonal capabilities, 210+ regression tests).

  **α Dev Error Overlay** — 풀스크린 dev 에러 UI (`@mandujs/core/dev-error-overlay`). SSR + client 에러 양쪽, 4.4 KB gz client IIFE, 500-response에도 payload 임베드. Config `dev.errorOverlay` (default `true`, prod 3중 gate).

  **β Route conventions** — `app/<route>/{loading,error,not-found}.tsx` per-route + `(group)/` route groups + `[[...slug]]` optional catch-all. 런타임이 page를 `Suspense(loading)` + `ErrorBoundary(error)` 로 자동 감싸고, 404는 nearest-ancestor `not-found.tsx` 우선.

  **γ generateStaticParams** — Next.js-style build-time SSG. `.mandu/prerendered/` + `_manifest.json`, path-traversal-safe, 런타임 첫 dispatch check에서 `Cache-Control: immutable`로 serve. Nested dynamic / catch-all / optional catch-all 전부 지원.

  **δ Hydration strategy per-island** — `data-hydrate="load|idle|visible|interaction|media(<query>)"` 선언 spec. 1.07 KB gz runtime, public disposer contract, Astro parity + `interaction` 은 Mandu 고유.

  **ε Middleware composition API** — `defineMiddleware({ name, match?, handler })` + `compose(...)`. Onion model, short-circuit, error propagation, `ManduConfig.middleware[]` config. 기존 csrf/session/secure/rate-limit bridge adapter로 backward compat.

  Quality: 7 packages typecheck clean, 3211 core pass / 0 fail, 210+ new
  tests, zero new runtime deps.

- Updated dependencies []:
  - @mandujs/core@0.29.0
  - @mandujs/edge@0.4.1
  - @mandujs/skills@6.0.0
  - @mandujs/mcp@0.20.3

## 0.27.4

### Patch Changes

- feat(core,cli): hard-fail `__generated__/` imports at bundler level.

  `mandu dev` / `mandu build` / `mandu start` 는 이제 bundler plugin
  레이어에서 직접 `__generated__/` import를 감지하면 번들링 자체를
  실패시킵니다. Guard rule만으로 부족했던 agent bypass 패턴의 원천 차단.

  에러 메시지는 importer 파일 경로 + `getGenerated()` 사용 예시 +
  docs URL을 포함합니다. `@mandujs/core/runtime` 내부 `__generated__`
  접근은 기본 allowlist로 제외됩니다.

  - `packages/core/src/bundler/plugins/block-generated-imports.ts` 신규
  - `defaultBundlerPlugins(config)` 헬퍼 — 단일 설치 포인트
  - `safeBuild` 6개 callsite + CLI SSR bundler 경로 자동 장착
  - `ManduConfig.guard.blockGeneratedImport` (Zod, default `true`) opt-out
  - `MANDU_DISABLE_BUNDLER_PLUGINS=1` 비상 탈출구
  - `mandu init` 3개 템플릿 `tsconfig.json` paths 봉쇄 (IDE defense)
  - 마이그레이션 가이드 `docs/migration/0.28-generated-block.md`
  - `docs/architect/generated-access.md` Enforcement 섹션 추가

  18 regression tests (15 unit + 3 integration). No new runtime deps.

- Updated dependencies []:
  - @mandujs/core@0.28.0
  - @mandujs/edge@0.4.6
  - @mandujs/mcp@0.20.5
  - @mandujs/skills@8.0.0

## 0.27.3

### Patch Changes

- fix: #207 view-transition injection hardening + #208 inline SPA-nav
  helper for `hydration: "none"` projects.

  - **#207**: No code defect; `@view-transition` CSS was already injected
    across all SSR paths. Locked it down with 12-case regression suite
    covering streaming SSR / prerender / 404 / error / opt-out.
  - **#208**: Genuine defect. `ssr.spa: true` was documented default but
    intercept lived in client bundle that `hydration: "none"` projects
    never ship. New `client/spa-nav-helper.ts` inline IIFE (~2.7 KB)
    injected into `<head>` alongside the prefetch helper. Full 10-case
    exclusion parity with `handleLinkClick`. pushState + fetch +
    View-Transitions DOM-swap. Early-exits when full router present so
    hydrated pages unaffected.

  Wired through `ServerOptions.spa` to all 5 renderSSR/
  renderStreamingResponse call-sites. CLI dev + start pass `config.spa`.

  +66 regression tests (12 #207 + 54 #208). No new runtime deps.

- Updated dependencies []:
  - @mandujs/core@0.27.0
  - @mandujs/edge@0.4.5
  - @mandujs/mcp@0.20.4
  - @mandujs/skills@7.0.0

## 0.27.2

### Patch Changes

- content + routes follow-ups (Closes #204, #205, #206):

  - **#204** — `Collection.all()/get()/getCompiled()` guaranteed
    watcher-free. Script chains exit cleanly. Watching via
    `collection.watch(cb)` opt-in. `dispose()` + `Symbol.asyncDispose`.
  - **#205** — `generateSidebar` reads `_meta.json` (title/icon/order/
    pages[]). New `generateCategoryTree`. `generateLLMSTxt` baseUrl +
    groupByCategory. `getCompiled` accepts `CompileOptions` (remark/
    rehype plugins + silent).
  - **#206** — Metadata Routes auto-discovery: `app/sitemap.ts`,
    `app/robots.ts`, `app/llms.txt.ts`, `app/manifest.ts` →
    `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/manifest.webmanifest`.
    New `@mandujs/core/routes` export with typed contracts + dispatcher.
    Default `Cache-Control: public, max-age=3600`.

  No new runtime deps. Existing `renderSitemap`/`renderRobots` helpers
  and `public/*.xml` workflow remain untouched (auto-discovery is
  additive). `app/` > `public/` precedence with warning.

  +74 regression tests. 7 packages typecheck clean.

- Updated dependencies []:
  - @mandujs/core@0.26.0
  - @mandujs/edge@0.4.4
  - @mandujs/mcp@0.20.3
  - @mandujs/skills@6.0.0

## 0.27.1

### Patch Changes

- fix: resolve #203 — configurable prebuild timeout + preserve inner errors.

  - `mandu.config.ts` `dev.prebuildTimeoutMs` (default 120_000 ms) +
    `MANDU_PREBUILD_TIMEOUT_MS` env override.
  - New `PrebuildTimeoutError` (subclass of `PrebuildError`) names the
    failing script + limit + both override paths.
  - Inner error message + stack preserved via `.cause`. No more opaque
    "non-Error thrown" surface.
  - stdout/stderr tail (last 10 lines each) appended to
    `PrebuildError.message` on non-zero exit.
  - CLI `mandu dev` prints `err.message` + `cause.stack` on abort.

- Updated dependencies []:
  - @mandujs/core@0.25.3
  - @mandujs/edge@0.4.3

## 0.27.0

### Minor Changes

- Phase 15.2 — Edge adapter expansion:

  - **`@mandujs/edge/deno`** — `createDenoHandler()` + `deno.json`
    generator for Deno Deploy.
  - **`@mandujs/edge/vercel`** — `createVercelEdgeHandler()` +
    `vercel.json` generator with `runtime: "edge"` and catch-all
    rewrite to `/api/_mandu`.
  - **`@mandujs/edge/netlify`** — `createNetlifyEdgeHandler()` +
    `netlify.toml` generator with `edge_functions` block.
  - **CLI** — `mandu build --target=<deno|vercel-edge|netlify-edge>`
    produces platform entry + config artifact.

  All three adapters inherit Phase 15.1 R0 contract: per-request
  AsyncLocalStorage isolation, production error-body scrubbing,
  throwing Bun-only API shim with platform-specific signals.

  77 new tests (fetch + config + emitter smoke). Edge suite total
  107/0 pass. Zero new runtime deps; Phase 15.1 Workers bundle
  unchanged (1609.3 KB). Hono territory non-infringement preserved —
  adapters are polyfill + config only, never routing.

### Patch Changes

- Updated dependencies []:
  - @mandujs/edge@0.4.0

## 0.26.0

### Minor Changes

- Wave D — 8 GitHub issues + Phase 17 memory/observability:

  - **#193 (BREAKING)** — SPA navigation is opt-out by default. Plain
    `<a href="/about">` now triggers client-side nav with View
    Transitions. Opt-out per link: `data-no-spa`. Opt-out global:
    `mandu.config.ts` `spa: false`. Legacy `data-mandu-link` still works.

  - **#194** — `@mandujs/core` exports map exposes `./kitchen` so
    `@mandujs/mcp` can import `computeAgentStats`.

  - **#195** — `mandu dev` prints a synchronous boot banner before any
    `await`, so a hang is always observable. `MANDU_DEBUG_BOOT=1` emits
    a phase trace.

  - **#196** — `mandu dev` auto-discovers and runs `scripts/prebuild-*.
{ts,tsx,js,mjs}` before serving. In watch mode, `content/` changes
    re-execute prebuild (500ms debounced) and broadcast HMR reload.
    Opt-out: `dev.autoPrebuild: false`.

  - **#197** — `@mandujs/skills` now writes every skill as
    `.claude/skills/<name>/SKILL.md` (Claude Code spec). All three
    installer paths (dev, CLI binary mode, per-project generator)
    corrected.

  - **#198** — SSR resolves `async function` components. `export default
async function Page()` / async layouts / async generateMetadata work.
    4 callsites pre-resolve via `resolveAsyncElement()`.

  - **#199 (MVP)** — `@mandujs/core/content`: `defineCollection`,
    frontmatter parser (no new runtime deps), `slugFromPath`,
    `generateSidebar`, `generateLLMSTxt`, content-types.d.ts emitter.
    Legacy `defineCollection({ loader })` preserved.

  - **#200** — runtime registry: `getGenerated`, `getManifest`,
    `registerManifest` at `@mandujs/core/runtime`. Guard
    `INVALID_GENERATED_IMPORT` message now points at
    `mandujs.com/docs/architect/generated-access`.

  - **Phase 17** — bounded LRU (patternCache/fetchCache/perFileTimers),
    `/_mandu/heap` + `/_mandu/metrics` endpoints (dev auto-on, prod
    gated), MCP heap heartbeat, long-run smoke harness.

  Quality: 6 packages typecheck clean, 200+ new regression tests, zero
  new runtime deps.

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.25.0
  - @mandujs/mcp@0.20.2
  - @mandujs/skills@5.0.0
  - @mandujs/edge@0.3.1

## 0.25.0

### Minor Changes

- Wave C — GitHub issue closures + R3 Low hardening + flake fixes:

  - **Issue #190** — `mandu dev/start` default hostname `0.0.0.0` (IPv4
    dual-stack). Fixes Windows `localhost` IPv4-resolve dead-page. Log
    now prints `http://localhost:PORT (also reachable at 127.0.0.1, [::1])`.

  - **Issue #191** — `_devtools.js` injected only when
    `bundleManifest.hasIslands === true`. Opt-in/out via
    `ManduConfig.dev.devtools`. URL gets `?v=<buildTime>` cache-bust +
    dev static `Cache-Control: no-cache, no-store, must-revalidate` so
    stale-bundle after HMR is impossible.

  - **Issue #192** — Zero-config smooth navigation: `@view-transition`
    CSS + ~500B hover prefetch IIFE auto-injected. Opt-out via
    `ManduConfig.transitions`/`prefetch` (default `true`) or per-link
    `data-no-prefetch`. Follow-up #193 tracks opt-in→opt-out SPA nav
    reversal (breaking change, deferred).

  - **Issue #189** — Transitive ESM cache: reverse-import-graph
    invalidation. Change a deep file → HMR now invalidates every
    transitive importer (barrel + static-map, deep re-export chain,
    singleton). Depth-capped BFS + HMR log shows invalidated count.

  - **R3 Low hardening** — AI chat `/save|/load|/system` containment
    under `./.mandu/ai-chat/`; skills generator `--out-dir` project-root
    guard; Workers `ctx` AsyncLocalStorage; Edge 500 body scrub in prod;
    `@mandujs/skills/loop-closure` subpath exports.

  - **DX** — Per-subcommand `--help` routing (8 commands); changeset
    CHANGELOG auto-update wired.

  - **Flake fixes** — dbPlan/dbApply path resolution; precommitCheck
    ts-morph pre-warm + 15s Windows ceiling; safe-build handoff-race.

  Quality: 6 packages typecheck clean, 97+ new tests, no new runtime
  deps, no production-code regressions.

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.24.0
  - @mandujs/ate@0.19.1
  - @mandujs/skills@4.0.0
  - @mandujs/edge@0.3.0
  - @mandujs/mcp@0.20.1

## 0.16.0

### Minor Changes

- ATE Production Release v0.16.0

  ## 🎉 Major Features

  ### New Package: @mandujs/ate

  - **Automation Test Engine** - Complete E2E testing automation pipeline
  - Extract → Generate → Run → Report → Heal workflow
  - 195 tests, 100% pass rate

  ### ATE Core Features

  - **Trace Parser & Auto-Healing**: Playwright trace 분석 및 자동 복구
  - **Import Dependency Graph**: TypeScript 의존성 분석 (ts-morph 기반)
  - **Domain-Aware Assertions**: 5가지 도메인 자동 감지 (ecommerce, blog, dashboard, auth, generic)
  - **Selector Fallback System**: 4단계 fallback chain (mandu-id → text → class → role → xpath)
  - **Impact Analysis**: Git diff 기반 subset 테스트 자동 선택

  ### Performance Optimizations

  - **ts-morph Lazy Loading**: Dynamic import로 초기 로드 70% 감소
  - **Tree-shaking**: sideEffects: false 설정
  - **Bundle Size**: 최적화 완료

  ### Documentation

  - 2,243 lines 완전한 문서화
  - README.md (1,034 lines)
  - architecture.md (778 lines)
  - 8개 사용 예제

  ### Testing

  - 195 tests / 503 assertions
  - 13개 테스트 파일
  - 단위/통합 테스트 완비

  ### Error Handling

  - ATEFileError 커스텀 에러 클래스
  - 모든 file I/O에 try-catch
  - Graceful degradation
  - 한국어 에러 메시지

  ## 🔧 MCP Integration

  - 6개 ATE 도구 추가 (mandu.ate.\*)
  - extract, generate, run, report, heal, impact

  ## 📦 Breaking Changes

  None - 모든 기존 API 유지

  ## 🙏 Credits

  Developed by ate-production-team:

  - heal-expert: Trace parser, Error handling
  - impact-expert: Dependency graph
  - oracle-expert: Oracle L1 assertions
  - selector-expert: Selector fallback map
  - doc-expert: Documentation, Testing
  - bundle-optimizer: Performance optimization

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.14.0
  - @mandujs/ate@0.2.0

## 0.15.4

### Patch Changes

- Centralize lockfile guidance text for better maintainability and testability

## 0.15.3

### Patch Changes

- SSE reconnect improvements and critical bug fixes

  ## @mandujs/core

  - **Feature**: SSE reconnect with exponential backoff and jitter
  - **Feature**: Connection state tracking (connecting, connected, reconnecting, failed, closed)
  - **Fix**: Critical race condition in SSE snapshot/fetchChatHistory

  ## @mandujs/cli

  - **Template**: Add SSE reconnect logic to realtime-chat template
  - **Template**: Fix race condition in chat initialization
  - **Template**: Improve type clarity with ReconnectOptions alias
  - **Docs**: Add demo-first validation loop guide
  - **Docs**: Update CLI command examples

- Updated dependencies []:
  - @mandujs/core@0.13.2

## 0.15.2

### Patch Changes

- Security and stability improvements

  ## @mandujs/core

  - **Security**: Fix rate limiting DoS vulnerability - prevent single user from blocking all users
  - **Fix**: Prevent SSE event ordering race condition in subscribeWithSnapshot
  - **Test**: Add comprehensive SSE stream integration tests

  ## @mandujs/cli

  - **Refactor**: Deduplicate lockfile validation flow in dev/start commands
  - **Fix**: Remove magic numbers in backup suffix retry logic
  - **Template**: Add SSE reconnect strategy with exponential backoff
  - **Template**: Add ARIA labels for accessibility (WCAG 2.1 AA)
  - **Template**: Improve error feedback in realtime-chat and ai-chat
  - **Template**: Optimize Date object creation in message rendering

- Updated dependencies []:
  - @mandujs/core@0.13.1

## 0.15.1

### Patch Changes

- fix: resolve workspace:\* to correct core version (0.12.2 → 0.13.0)

## 0.15.0

### Minor Changes

- feat: auto-resolve template dependency versions at init time

  Template package.json now uses dynamic placeholders ({{CORE_VERSION}}, {{CLI_VERSION}}) instead of hardcoded versions. The actual installed versions are injected when running `mandu init`.

## 0.14.1

### Patch Changes

- fix: update template dependency versions to latest (core ^0.13.0, cli ^0.14.0) and remove legacy spec/ directory

## 0.14.0

### Minor Changes

- feat: manifest를 generated artifact로 전환 (Option D)

  - `spec/routes.manifest.json` → `.mandu/routes.manifest.json` (generated artifact)
  - `spec/spec.lock.json` → `.mandu/spec.lock.json`
  - `app/` (FS Routes)가 유일한 라우트 소스
  - legacy merge 로직 제거, auto-linking 추가
  - MCP tools FS Routes 기반으로 재작성

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.13.0

## 0.13.2

### Patch Changes

- fix: create `.claude.json` alongside `.mcp.json` and use relative `cwd` for MCP setup

## 0.13.1

### Patch Changes

- fix: add process.exit(0) after successful command execution to prevent CLI from hanging

## 0.13.0

### Minor Changes

- 터미널 종료 관련 업데이트

### Patch Changes

- fix: add process.exit(0) after successful command execution to prevent CLI from hanging

## 0.12.2

### Patch Changes

- fix: publish 스크립트를 bun publish로 변경하여 workspace:\* 의존성 자동 변환

- Updated dependencies []:
  - @mandujs/core@0.12.2

## 0.12.1

### Patch Changes

- chore: change license from MIT to MPL-2.0 and fix workspace dependency

- Updated dependencies []:
  - @mandujs/core@0.12.1
