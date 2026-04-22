---
"@mandujs/core": patch
"@mandujs/mcp": patch
---

fix(mcp): #236 clear error when a stale nested @mandujs/core resolves

When Bun's installer placed `node_modules/@mandujs/mcp/node_modules/@mandujs/core@0.39.0`
alongside the hoisted top-level `@mandujs/core@0.41.1`, the MCP brain
handlers crashed with `getCredentialStore is not a function` /
`undefined is not a constructor` — no hint about where the stale copy
came from.

- `@mandujs/core` now exports `__MANDU_CORE_VERSION__`, read at module
  load time directly from the package's own `package.json` so the
  value can never drift from the published version.
- `@mandujs/mcp` asserts the brain-auth surface (`getCredentialStore`,
  `resolveBrainAdapter`, `ChatGPTAuth`, `AnthropicOAuthAdapter`,
  `revokeConsent`) on every brain MCP call. Missing exports throw with
  the actual version that resolved, an explanation of why it happened
  (Bun nested-install quirk), and the one-line fix
  (`rm -rf node_modules bun.lock && bun install`).

The underlying Bun install behavior is not fixed here — that's an
upstream bug / hoisted-linker interaction — but the failure is now
diagnosable in one error line instead of a cryptic undefined call.
