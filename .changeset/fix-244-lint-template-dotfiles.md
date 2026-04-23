---
"@mandujs/cli": patch
---

fix(#244): `mandu lint` and `mandu lint --setup` crashed with
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
