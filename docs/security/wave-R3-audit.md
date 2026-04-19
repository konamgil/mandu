# Wave R3 Security Audit

Date: 2026-04-19
Scope: Wave A (80b08a2) + Wave B1 (2f9d564) + Wave B2 (33c491d)
Auditor: Wave R3 (read-only audit — no source modifications)

## Executive summary

- Critical: 0
- High: 0
- Medium: 3
- Low: 5
- Info: 4
- Merge verdict: **PASS**

No Critical or High issues were identified in the 202-file diff across Phases 11, 12, 13, 14, and 15.1. Command-injection surfaces (`mandu deploy` provider-CLI wrappers, `mandu upgrade` binary replacement, `mandu test --e2e` Playwright, MCP `run.tests` / `deploy.preview`) all use `Bun.spawn` / `node:child_process.spawn` with **argv arrays** (never shell strings), and every external input is validated against an explicit allow-list (deploy targets, seed-env labels, IDE providers, upgrade target labels) before being interpolated into commands or file paths. SQL injection is blocked by the `quoteIdent` identifier validator and Bun.SQL parameter binding in `db seed`. Secrets are masked on every CLI log surface and never embedded in deploy artifact bodies (heuristic reject in `renderVercelJson`). The `mandu upgrade` binary mode mandates SHA-256 verification against a release-side manifest before the atomic swap. SLSA Build L2 provenance is wired into `release-binaries.yml` via a SHA-pinned `actions/attest-build-provenance@v2`. All 4 new MCP tools declare `readOnlyHint: true`, and the Loop Closure pipeline (`closeLoop` → emitter → detectors) is pure: no I/O, no spawn, no file writes.

The findings below are hardening opportunities that do not block the merge:

- **Medium**: unused `forbiddenValues` secret-leak guard in `writeArtifact`; local adapter `baseUrl` (`MANDU_LOCAL_BASE_URL` / `OPENAI_BASE_URL`) flows to `fetch` without scheme/host validation; OSC 8 sanitizer allows `file://` URLs (acceptable but worth noting).
- **Low**: `--out-dir` in `mandu skills:generate` unbounded; `/save` `/load` `/system` in `mandu ai chat` accept arbitrary filesystem paths; Workers `ctx` per-request race across `await`.

## Findings

### M-01: `forbiddenValues` secret-leak guard in `writeArtifact` is never invoked by any adapter
**Severity**: Medium (defense-in-depth gap)
**Component**: `packages/cli/src/commands/deploy/artifact-writer.ts:64-73` (guard implementation) and `packages/cli/src/commands/deploy/adapters/*.ts` (all 7 adapters)
**Description**: `writeArtifact(options)` accepts `options.forbiddenValues: ReadonlyMap<string, string>` and refuses to write when any value of length ≥ 8 appears verbatim in `options.content`. The intent (per the docstring) is to catch a templating bug that interpolates a secret into a Dockerfile, vercel.json, fly.toml, etc. But the dispatcher (`deploy/index.ts:241-248`) and every adapter (`fly.ts:190-214`, `vercel.ts:243-274`, `docker.ts:170-203`, `cf-pages.ts:181-209`, `railway.ts:196-228`, `netlify.ts:210-238`, `docker-compose.ts`) call `writeArtifact({ path, content, preserveIfExists? })` with NO `forbiddenValues` map. So the guard is dead code. A future adapter regression that accidentally interpolates a secret into an artifact would not be caught by this guard.

Current mitigations that partially offset the gap:
- `renderVercelJson` (`packages/cli/src/commands/deploy/adapters/vercel.ts:121-128`) has a regex heuristic that throws when an env value matches `^sk_|^Bearer |^ghp_|^[A-Fa-f0-9]{32,}$`. This is narrow.
- Hardcoded templates never embed secret values — they reference `${secret-name}` placeholders — and the adapter set is frozen at 7.
- The dispatcher's inventory pass reads stored-secret NAMES only (`bridge.listStoredNames()`, line 231), never values, so the dispatcher itself cannot leak a value into an artifact.

**Exploit scenario**: An adapter template author adds a new `${some-token}` interpolation, accidentally reaches for the bridge's `get(name)` method (which returns the value), and pastes it into `content`. `writeArtifact` silently writes the secret to disk (and likely into a committed artifact). CI logs or a `git diff` then leaks the secret.

**Recommended fix**: In `deploy/index.ts`, after `bridge.listStoredNames()` (line 231), fetch every stored value into a Map via `bridge.get()`, then thread that Map through to every adapter's `prepare()` call via a new `DeployOptions.forbiddenSecrets?: ReadonlyMap<string, string>` field, and have each adapter pass it to every `writeArtifact` call. Total change: ~20 lines across 7 adapter files. Tests already exist for `writeArtifact` — no new test surface required.

**Evidence**:
```ts
// packages/cli/src/commands/deploy/artifact-writer.ts:58-76
export async function writeArtifact(
  options: WriteArtifactOptions
): Promise<WriteArtifactResult> {
  if (options.preserveIfExists && existsSync(options.path)) {
    return { path: options.path, preserved: true };
  }
  if (options.forbiddenValues && options.forbiddenValues.size > 0) {
    for (const [name, value] of options.forbiddenValues) {
      if (typeof value !== "string" || value.length < 8) continue;
      if (options.content.includes(value)) {
        throw new SecretLeakError(name, options.path);
      }
    }
  }
  // ...
}
```

No adapter passes `forbiddenValues` (`grep -rn "forbiddenValues" packages/cli/src/commands/deploy/adapters/ → no matches`).

---

### M-02: `MANDU_LOCAL_BASE_URL` / `OPENAI_BASE_URL` flow to `fetch` without scheme/host validation (SSRF)
**Severity**: Medium
**Component**: `packages/ate/src/prompts/adapters/local.ts:141-148` and `packages/ate/src/prompts/adapters/claude.ts:74`, `openai.ts:60`, `gemini.ts:79`
**Description**: The local adapter reads `options.baseUrl ?? process.env.MANDU_LOCAL_BASE_URL ?? process.env.OPENAI_BASE_URL` and passes it directly into `fetch(url.replace(/\/$/, "") + "/v1/chat/completions")`. No scheme allowlist, no host validation, no IMDS-block. `claude`/`openai`/`gemini` adapters likewise accept `options.baseUrl`. A malicious project-level `.env` (e.g. in a repo the user opened with `mandu ai chat` in its directory) or a prior compromise that sets these env vars would redirect the Mandu AI request to:

- `http://169.254.169.254/latest/meta-data/` (AWS EC2 IMDS) — would surface instance credentials in the HTTP response body that the chat loop then prints as "AI output".
- `http://127.0.0.1:11434/` (legitimate Ollama) but arbitrary port — could be any localhost service.
- `http://internal.company.com/...` — corporate intranet data exfiltration.

The `local` adapter's intent is "point at Ollama / LM Studio" so localhost-ish URLs are expected. But there is no explicit restriction.

Mitigations in place:
- `MANDU_LOCAL_BASE_URL` is opt-in (not set by default).
- `mandu ai chat` does not expose a `--base-url` CLI flag (verified via `grep baseUrl packages/cli/src/commands/ai/` → no matches).
- For the three non-local providers, overriding `baseUrl` would require programmatic access (no CLI surface).

**Exploit scenario**: User clones a repo that ships a `.env` with `MANDU_LOCAL_BASE_URL=http://169.254.169.254/latest/meta-data/iam/security-credentials/`. User runs `mandu ai chat` with `--provider=local`. The CLI sends the POST to IMDS, which 405s or returns metadata in the response body, which the adapter tries to parse as SSE.

**Recommended fix**: In `local.ts:streamOpenAICompat`, before `fetch`, parse `baseUrl` via `new URL()` and:
1. Require `protocol === "http:" || "https:"`.
2. For `protocol === "http:"`, require `hostname` to be `"localhost"`, `"127.0.0.1"`, or `"::1"` unless `MANDU_LOCAL_ALLOW_REMOTE=1` is set.
3. Block `169.254.*`, `10.*`, `192.168.*`, `172.16.*.0/12` unless the same env flag is set.

Alternatively, if Mandu deliberately supports remote Ollama, just document that `MANDU_LOCAL_BASE_URL` is a trust boundary.

**Evidence**:
```ts
// packages/ate/src/prompts/adapters/local.ts:141-148
stream(options: PromptStreamOptions): AsyncIterable<string | PromptStreamTerminal> {
  const baseUrl =
    options.baseUrl ?? process.env.MANDU_LOCAL_BASE_URL ?? process.env.OPENAI_BASE_URL;
  if (baseUrl && baseUrl.trim().length > 0) {
    return streamOpenAICompat(baseUrl, options);
  }
  return streamDummy(options);
}

// packages/ate/src/prompts/adapters/local.ts:58-76
async function* streamOpenAICompat(
  baseUrl: string,
  options: PromptStreamOptions,
): AsyncIterable<string | PromptStreamTerminal> {
  const url = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";
  const response = await fetch(url, { ... });  // no URL validation
```

---

### M-03: OSC 8 sanitizer `file://` allowance
**Severity**: Medium (hardening)
**Component**: `packages/cli/src/cli-ux/markdown.ts:111`
**Description**: `OSC8_ALLOWED_SCHEMES = new Set(["http", "https", "file"])`. `file://` is intentionally allowed for local documentation links, but in a pipeline where markdown content includes attacker-influenced strings (e.g. project names, error messages, user metadata that loops back through chat output), a crafted `[click me](file:///etc/passwd)` would produce a working clickable hyperlink. Clicking opens the user's browser to `file:///etc/passwd` — not an RCE but an information-flow disclosure trigger.

Note: This threat requires (a) markdown content containing attacker data AND (b) user clicking the link. The chat flow sanitizes user input via `sanitizeUtf8Input` (`packages/cli/src/util/ai-client.ts:302`) which strips C0 controls, so injecting an OSC 8 via pasted chat input would need to survive markdown rendering — possible if the content passes through `renderMarkdown`.

**Recommended fix**: Tighten `OSC8_ALLOWED_SCHEMES` to `["http", "https"]` unless the runtime context explicitly allows local links. If `file://` is needed for local doc links, gate it on a `renderMarkdown({ allowFileLinks: true })` option that AI-chat output paths leave off.

**Evidence**:
```ts
// packages/cli/src/cli-ux/markdown.ts:111
const OSC8_ALLOWED_SCHEMES = new Set(["http", "https", "file"]);
```

---

### L-01: `mandu ai chat` `/save`, `/load`, `/system` accept arbitrary filesystem paths
**Severity**: Low
**Component**: `packages/cli/src/commands/ai/chat.ts:188-269`, `packages/cli/src/util/ai-history.ts:189-226`
**Description**: The slash commands `/save <path>`, `/load <path>`, and `/system <path>` pass the raw argument through `path.resolve()` with no containment check. `/save ../../.ssh/authorized_keys` would write chat history JSON to the user's SSH config directory (likely failing because of schema mismatch at read, but overwriting the file nonetheless). `/load ~/.ssh/id_rsa` would try to JSON-parse a private key (fails with a `HistoryValidationError`, but reads the file into memory and spits it at stderr on error).

`loadPreset` (`chat.ts:116-132`) is PROPERLY contained — it checks the preset name matches `/^[a-zA-Z0-9_\-]+$/` and joins under `docs/prompts/<name>.md`.

This is Low severity because:
- The CLI runs in the user's own shell authority; paths they type are their responsibility.
- No network surface — attacker needs the user to literally type the path.
- `/save` writes JSON (deterministic shape), not arbitrary content.

**Recommended fix (optional)**: Reject absolute paths and `..` traversals in `/save` / `/load` / `/system` arguments. Default write dir: `./.mandu/ai-chat/`.

**Evidence**:
```ts
// packages/cli/src/util/ai-history.ts:190-198
export async function saveHistory(filePath: string, snapshot: HistorySnapshot): Promise<void> {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  // ... no containment check
}
```

---

### L-02: `mandu skills:generate --out-dir` is unbounded
**Severity**: Low
**Component**: `packages/cli/src/commands/skills.ts:44-107`, `packages/skills/src/generator/index.ts:108-156`
**Description**: `--out-dir=<path>` is passed through `generateSkillsForProject` unchanged. A `--out-dir=../neighbor-project/.claude/skills/` would write `<project>-workflow.md` / `-conventions.md` / `-domain-glossary.md` into the neighbor project. Filenames are deterministic (derived from `package.json#name`), so worst case is overwriting another project's generated skill files with content describing the current project.

**Recommended fix**: Resolve the path and check it's inside `repoRoot` (same pattern as `validateDesktopEntryPath` in `packages/cli/src/commands/desktop.ts:188-244` which already has a proven implementation).

**Evidence**:
```ts
// packages/skills/src/generator/index.ts:109-113
const outDir = options.outDir ?? join(repoRoot, ".claude", "skills");
if (!dryRun) {
  mkdirSync(outDir, { recursive: true });
}
```

---

### L-03: Cloudflare Workers `ctx` stored on `globalThis` races across concurrent requests in the same isolate
**Severity**: Low
**Component**: `packages/edge/src/workers/fetch-handler.ts:112-130`
**Description**: `createWorkersHandler` stores the per-request `ctx` on `globalThis.__MANDU_WORKERS_CTX__`. Workers isolates can serve multiple concurrent fetch() invocations that yield at `await` points. If request A yields at an `await`, request B arrives and overwrites `__MANDU_WORKERS_CTX__`, and then request A resumes and calls `getWorkersCtx()`, A will receive B's ctx. Calling `ctx.waitUntil()` on the wrong ctx could leak a promise lifetime into the wrong request.

The comment in the handler acknowledges: *"Workers isolates are short-lived so this does not leak across invocations."* This is correct for `env` (which is isolate-scoped and identical across requests), but `ctx` IS per-request.

**Recommended fix**: Use `AsyncLocalStorage` (Node compat flag is already enabled via `nodejs_compat`) to store `ctx`. Or require handlers to grab `ctx` synchronously at the start of `fetch()` before any `await`.

**Evidence**:
```ts
// packages/edge/src/workers/fetch-handler.ts:117-130
return async function workersFetch(
  request: Request,
  env: WorkersEnv,
  ctx: WorkersExecutionContext
): Promise<Response> {
  const globals = globalThis as unknown as MandWorkersGlobals;
  globals.__MANDU_WORKERS_ENV__ = env;
  globals.__MANDU_WORKERS_CTX__ = ctx;

  try {
    return await handler(request);
    // ... ctx is overwritten by the next concurrent request
  } finally {
    // "Intentionally keep env/ctx on globals — nested waitUntil callbacks may fire after"
  }
};
```

---

### L-04: Edge handler `hintBunOnlyApiError` echoes raw error messages in HTTP 500 responses
**Severity**: Low
**Component**: `packages/edge/src/workers/guards.ts:46-76`
**Description**: On caught exceptions the handler returns `Response.json({ error, message: error.message, runtime: "workers" }, { status: 500 })`. The full `message` may contain file paths, stack-trace fragments, or (less likely) request-derived data. In a Workers deployment this is edge-public. For defensive hygiene, 500 responses should emit a generic message and log details server-side only.

**Recommended fix**: In production (detect via `env.ENVIRONMENT === "production"` or always), truncate `message` to the first line / 120 chars, or replace with a static "Internal server error" and log the full stack to `console.error` for Cloudflare logpush ingestion.

**Evidence**:
```ts
// packages/edge/src/workers/guards.ts:56-67
if (isBunOnlyApi) {
  const payload = {
    error: "BunApiUnsupportedOnEdge",
    message,  // full, unfiltered
    hint: "...",
    runtime: "workers",
  };
  return Response.json(payload, { status: 500 });
}
```

---

### L-05: `@mandujs/skills/loop-closure` subpath is published but not declared in `exports`
**Severity**: Low (packaging correctness, not security)
**Component**: `packages/skills/package.json:8-12` vs `packages/mcp/src/tools/loop-close.ts:21`
**Description**: `packages/mcp/src/tools/loop-close.ts` imports `@mandujs/skills/loop-closure` but `packages/skills/package.json`'s `exports` map lists only `.`, `./init-integration`, and `./generator`. With strict Node ESM resolution (published package consumed by third parties), the import would fail with "subpath not exported". Bun currently resolves via file-path fallback even when exports doesn't list it, so tests pass in-repo. Publishing to npm will break downstream consumers unless the `exports` map is extended.

Not a security issue, but a reliability / correctness issue that surfaces only when @mandujs/skills is installed via npm.

**Recommended fix**: Add `"./loop-closure": "./src/loop-closure/index.ts"` to `packages/skills/package.json#exports`.

---

### Info-01: Gemini adapter places API key in URL query string
**Severity**: Info
**Component**: `packages/ate/src/prompts/adapters/gemini.ts:79-82`
**Description**: `const url = \`${base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}\`;`. This is required by the Gemini REST API — Google's endpoint authenticates via query param. `encodeURIComponent` prevents URL-structure corruption. However, URL query parameters are routinely logged by intermediate proxies, TLS terminators, and some client-side error paths. The adapter-level comment acknowledges this intentionally: *"We keep it out of headers so it never leaks into edge logs that scrub auth headers only."* No Mandu-side mitigation is possible without changing Google's API contract.

**Recommendation**: No action. Document in `docs/ai/getting-started.md` that `MANDU_GEMINI_API_KEY` should be treated as sensitive like any API key, and avoid passing it through environments with request-URL logging.

---

### Info-02: `mandu upgrade` SHA-256 comparison is non-constant-time
**Severity**: Info (non-issue)
**Component**: `packages/cli/src/commands/upgrade.ts:281`
**Description**: `if (digest !== expected.toLowerCase())` uses standard string inequality. This would be a timing-attack concern if one side were secret (HMAC, session token). Both `digest` (locally computed from the downloaded bytes) and `expected` (fetched from the release manifest) are public values at the time of comparison. No timing side-channel exists. **Not a finding** — flagged here only because constant-time-compare comes up in hash verification discussions.

---

### Info-03: `.mandu/secrets.json` fallback is plaintext with prominent one-shot warning
**Severity**: Info
**Component**: `packages/cli/src/commands/deploy/secret-bridge.ts:263-345`
**Description**: When `Bun.secrets` is unavailable (older Bun), secrets fall back to `.mandu/secrets.json` with `chmod 0600` (Unix) and an explicit `console.warn` on first use: *"Bun.secrets unavailable — falling back to .mandu/secrets.json (PLAINTEXT, NOT ENCRYPTED)"*. The user is informed, the fallback path is only used when keychain is unavailable, and Bun ≥ 1.3.12 (the project engine minimum) provides `Bun.secrets`. Acceptable — documented behavior.

---

### Info-04: `mandu upgrade` in "package mode" runs `bun update @mandujs/*` without integrity check
**Severity**: Info
**Component**: `packages/cli/src/commands/upgrade.ts:497-534`
**Description**: When not running as a compiled binary, upgrade delegates to `Bun.spawn(["bun", "update", ...PACKAGES])`. No additional integrity verification — trust is delegated to `bun install`'s existing lockfile + registry integrity (sha512 on `registry.npmjs.org`). This is standard npm-ecosystem behavior. `PACKAGES` is a frozen const (`["@mandujs/core", "@mandujs/cli", "@mandujs/mcp"]`), so no user input flows to the spawn.

---

## Positive observations

The following controls were observed and should be preserved across future changes:

1. **Argv-form `Bun.spawn` / `child_process.spawn` everywhere** — `deploy/provider-cli.ts:109`, `upgrade.ts:522`, `test.ts:189`, `e2e-runner.ts:232`, MCP `run-tests.ts:283`, `deploy-preview.ts:210`, `ai-brief.ts:168`. No `shell: true`. No shell string concatenation. Defense against command-injection is structural.

2. **Allow-list gating before shell-out** — `deploy/types.ts` `DEPLOY_TARGETS` narrows target before adapter dispatch (`deploy/index.ts:115`). `mcp-register.ts:99` narrows IDE provider before file-path resolution. `db-seed.ts:216` narrows `--env` to `dev|staging|prod`. `upgrade.ts:111-121` narrows OS/arch to the published matrix. Each allow-list is the first gate; the rest of the code depends on it.

3. **SQL injection defenses in `db seed`** — EVERY identifier flows through `quoteIdent` (`packages/core/src/resource/ddl/emit.ts:78`). `quoteIdent` rejects strings containing the provider-specific quote character (backtick for MySQL, double-quote for Postgres/SQLite), NUL bytes, and non-conforming length. Values bind via Bun.SQL placeholder templates (`db-seed.ts:969-994` `execValuesStmt`), never via string concatenation. Tests confirm rejection of `__evil` column name (`db-seed.test.ts` unknown-column case).

4. **Secret masking in logs and errors** — `secret-bridge.ts:141-143` `maskSecret` always returns `"****"`. `ai-client.ts:85-88` `maskSecret` shows `${key.slice(0,3)}***${key.slice(-2)}`. Adapters wrap fetch errors with `maskKey` (`claude.ts:97`, `openai.ts:82`, `gemini.ts:102`). `ai-client.ts:250-255` strips the API key from any error message before rethrow.

5. **Desktop `--entry` containment** — `packages/cli/src/commands/desktop.ts:188-244` `validateDesktopEntryPath` canonicalizes both cwd and entry via `fs.realpath`, walks the parent chain to find the nearest existing ancestor, rejects `..`-prefixed relative paths, absolute paths outside cwd, and symlinks that escape. Two-stage check catches mid-path symlinks.

6. **Installer env-override guards** — `install.sh:118-134` filters `MANDU_INSTALL_DIR` to `[A-Za-z0-9/._-]`. `install.sh:149-196` requires `MANDU_REPO` in `owner/repo` format and demands `MANDU_REPO_CONFIRM=yes` (or TTY confirmation) for non-default values. `install.ps1:97-104` uses `^[A-Za-z0-9:\\/.\-_ ]+$` for Windows paths. `install.bash:72-86` runs the same `MANDU_REPO` check BEFORE curl'ing the remote `install.sh`. Smoke tests in `.github/workflows/__tests__/installer-env-injection.sh` exercise these guards.

7. **SLSA Build L2 + SHA-pinned actions** — `.github/workflows/release-binaries.yml:237` uses `actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be # v2` (commit SHA). `ci.yml`, `publish.yml`, and `release-binaries.yml` pin every third-party action to a 40-hex commit SHA. Automated test `packages/cli/tests/workflows/__tests__/workflow-sha-pin.test.ts` enforces this invariant (10 tests, all pass).

8. **Markdown / ANSI sanitizer** — `packages/cli/src/cli-ux/markdown.ts:91-95` `sanitizeControl` strips C0/C1/DEL before render. `sanitizeOsc8` re-scans rendered output and drops OSC 8 hyperlinks whose scheme isn't on the allowlist. 21 unit tests cover edge cases including nested sequences and malformed OSC.

9. **SHA-256 verification mandatory in `mandu upgrade`** — `packages/cli/src/commands/upgrade.ts:389-404` refuses to proceed without `SHA256SUMS.txt` in the release. `downloadAndVerify` hashes the downloaded bytes and compares before atomic replace. Atomic replace uses rename-based semantics on POSIX and rename-then-rename on Windows with rollback path on partial failure.

10. **IDE config safety (`mandu mcp register`)** — `packages/cli/src/util/ide-config.ts:252-286` `writeConfigAtomic` ALWAYS creates `<file>.bak.<unix-ms>` before overwriting. `mergeMcpEntry` shallow-spreads existing config and only writes `mcpServers.<name>` — all other top-level keys preserved. JSON-C tolerance strips `//` comments via a state machine (`stripJsonComments:131-203`) that handles strings/escapes. Token default is `${localEnv:MANDU_MCP_TOKEN}` placeholder — never literal secrets.

11. **Loop Closure purity** — `packages/skills/src/loop-closure/emitter.ts:228-248` and all 10 detectors in `detectors.ts` are pure functions of `{stdout, stderr, exitCode} → Evidence[]`. No I/O, no spawn, no fs access. `mandu.loop.close` MCP tool wraps `closeLoop()` with only input validation. All 4 new MCP tools declare `annotations: { readOnlyHint: true }`.

12. **`mandu db seed` prod gate** — `db-seed.ts:224-233` refuses `--env=prod` unless `MANDU_DB_SEED_PROD_CONFIRM=yes`. Tamper detection via checksum comparison (`detectTamper:886-909`) blocks replay of modified previously-applied seeds. History table isolated from migrations history. Seeds run in per-file transactions.

13. **Session cookie codec preserves HttpOnly / SameSite** — `packages/core/src/filling/cookie-codec.ts:116-118` emits `HttpOnly` and `SameSite=<value>` when set. `stripDefaultSameSite` (`line 244`) removes the implicit `SameSite=Lax` that Bun.CookieMap injects, preserving caller intent. This carries over to the edge Workers adapter via the runtime-neutral legacy codec.

14. **CSRF constant-time comparison in fallback path** — `packages/core/src/middleware/csrf.ts:219-226` `safeEqual` is constant-time XOR on char codes. `fallbackVerify` (`line 298`) uses it to compare HMAC signatures.

15. **No third-party deps added in Wave B1/B2** — `packages/cli/package.json`, `packages/mcp/package.json`, `packages/skills/package.json`, `packages/ate/package.json`, `packages/edge/package.json` examined. `@noble/hashes`, `aws4fetch`, `@neondatabase/serverless` are REFERENCED in docs/roadmap but NOT actually imported or declared. Supply-chain surface unchanged.

## Out-of-scope

- Destructive operations on a live project (no `rm -rf`, no DB writes, no real deploy).
- End-to-end test of `mandu upgrade --execute` against a real GitHub release.
- Playwright E2E of `mandu deploy --execute` against real provider APIs (Vercel, Fly, etc.) — adapters' `deployImpl` is a test-injection point, production spawn not yet implemented per the adapter return messages.
- Deep static analysis of `ts-morph` usage in `@mandujs/ate` (dependency trust assumed).
- Cryptographic review of `Bun.secrets` / `Bun.CSRF` / `Bun.password` internals (assumed correct per Bun's own threat model).

## Methodology

### Grep patterns used
- `Bun.spawn|child_process.spawn|execSync` — every shell-out site.
- `shell:\s*true|spawn\(.*shell` — shell-string forms (zero matches).
- `process\.env\[` — env var reads in sensitive modules.
- `(http|file|ftp|javascript|data):` — URL scheme surface.
- `forbiddenValues|bridge\.get` — secret flow.
- `quoteIdent|executeRaw|sql\.unsafe` — SQL identifier/injection surface.
- `fetch\(.*\$\{|fetch\(.*\+` — dynamic URL construction.
- `process\.env\.MANDU_|MANDU_.*_API_KEY` — Mandu env surface.
- `Object\.defineProperty|__proto__` — prototype pollution surface.
- `createHash|timingSafeEqual` — integrity/timing-attack surface.

### Threat model coverage
All 12 threat categories from the audit brief examined:

1. Command injection — argv-form spawn verified in all 8 call sites (deploy/fly, vercel, railway, netlify, cf-pages, upgrade, test-e2e, mcp.run.tests, mcp.deploy.preview, ai-brief git log).
2. Path traversal — `/save /load /system` flagged (L-01); `--out-dir` flagged (L-02); `db seed`, `desktop --entry`, `mcp register` paths confirmed contained.
3. SQL injection — `quoteIdent` + Bun.SQL placeholders verified end-to-end in `db-seed.ts`.
4. Secret exposure — `maskSecret` / `maskKey` verified; `writeArtifact forbiddenValues` gap flagged (M-01); Gemini URL-key noted (Info-01).
5. SSRF — `MANDU_LOCAL_BASE_URL` flagged (M-02); upgrade uses GitHub-only URLs with SHA-256 verification.
6. Prompt injection / Loop Closure — `closeLoop` purity verified; MCP `readOnlyHint: true` verified on all 4 tools.
7. Supply chain — SHA-pinning automated test verified; no new third-party deps verified.
8. Binary integrity — SHA-256 verify + atomic replace path verified; timing-compare is non-issue (Info-02).
9. IDE merge safety — `.bak.<ms>` backup pre-write verified; JSON-C parser + shallow spread verified.
10. Markdown / ANSI sanitizer — C0/C1/DEL + OSC 8 allowlist verified; `file://` allowance flagged (M-03).
11. Edge Workers polyfill — cookie codec HttpOnly/SameSite verified; CSRF constant-time verified; `ctx` race flagged (L-03).
12. Installer — allow-list + confirmation verified in all 3 variants (.sh, .ps1, .bash); smoke tests in-repo.

### Test cases examined
- `bun test packages/cli/tests/workflows/__tests__/workflow-sha-pin.test.ts` — 10/10 pass.
- `bun test packages/cli/src/cli-ux/__tests__/markdown-sanitizer.test.ts` — 21/21 pass.
- `bun test packages/cli/src/commands/__tests__/desktop-entry-path.test.ts` — 13/13 pass.
- `bun test packages/cli/src/commands/__tests__/mcp-register.test.ts` — 15/15 pass.
- `bun test packages/cli/src/commands/__tests__/upgrade.test.ts` — 20/20 pass.
- `bun test packages/cli/src/commands/__tests__/db-seed.test.ts` — 21/21 pass.
- `bun test packages/mcp/tests/tools/loop-close.test.ts` — 15/15 pass.
- `bun test packages/cli/src/commands/deploy/__tests__/` — 76/76 pass across 6 files.

## Merge gate

**PASS** — Critical 0 / High 0.

The Medium findings (M-01 forbiddenValues unused, M-02 local base-url SSRF, M-03 file:// in OSC allowlist) are defense-in-depth gaps, not active vulnerabilities in the current adapter set and current CLI surface. They should be addressed in a follow-up hardening pass but do not block npm publish.

The Low findings (L-01..L-05) are minor hardening opportunities or documented trade-offs.

No active secret leak, RCE, auth bypass, SQL injection, or supply-chain compromise was identified across the 202-file diff.
