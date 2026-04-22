---
"@mandujs/core": minor
"@mandujs/cli": minor
---

#235 brain OAuth adapters (OpenAI + Anthropic)

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
