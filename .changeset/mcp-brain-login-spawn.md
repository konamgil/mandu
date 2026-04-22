---
"@mandujs/core": patch
"@mandujs/mcp": patch
"@mandujs/cli": patch
---

fix(brain): resolver + status now see ChatGPT session token; MCP login spawns codex directly

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
