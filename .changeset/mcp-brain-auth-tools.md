---
"@mandujs/mcp": minor
---

feat(mcp/brain): expose login / logout / status as MCP tools

Three new MCP tools make the brain auth surface usable from agents
(Cursor / Claude Code / Codex) without dropping to the CLI:

- `mandu.brain.status` — read-only. Returns the active adapter tier,
  reason, backend, and a per-provider status block (keychain token vs.
  ChatGPT-session `auth.json` vs. not logged in). Safe to poll.
- `mandu.brain.login` — `{ provider?: "openai" | "anthropic" }`.
  OpenAI delegates to `npx @openai/codex login` (OpenAI-official
  OAuth). Anthropic runs the Mandu-managed loopback flow. Returns
  `{ ok, exit_code?, auth_file?, note }`. Detects non-TTY environments
  and returns an instruction string instead of hanging.
- `mandu.brain.logout` — `{ provider?: "openai" | "anthropic" | "all" }`.
  Deletes keychain tokens + per-project consent. Intentionally does
  NOT touch `~/.codex/auth.json` (Codex owns that file); the response
  includes the command to run for full revocation.

All three tools are thin wrappers over the existing `@mandujs/core`
APIs (`ChatGPTAuth`, `getCredentialStore`, `resolveBrainAdapter`,
`AnthropicOAuthAdapter`, `revokeConsent`).
