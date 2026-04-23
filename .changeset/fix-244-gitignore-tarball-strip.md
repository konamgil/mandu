---
"@mandujs/cli": patch
---

fix(#244 follow-up): ship template `.gitignore` as `gitignore` +
rename on extraction.

The first 0.34.1 patch shipped `.oxlintrc.json` but not `.gitignore`
— npm and bun publish unconditionally strip `.gitignore` from
tarballs regardless of the `files` field. That meant the template
manifest's static `import ... with { type: "file" }` still pointed
at three missing paths in the published package, so Bun's resolver
kept throwing a non-Error `{}` at module load time. Rename the
template source files to plain `gitignore` and restore the dot on
extraction via `renameNpmStrippedDotfile()`.
