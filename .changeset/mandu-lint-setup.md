---
"@mandujs/cli": minor
---

feat(cli): `mandu lint` + `mandu lint --setup` — bring oxlint to existing projects

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
