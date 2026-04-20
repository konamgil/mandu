---
title: Custom Guard Rules
phase: 18.ν
status: stable
audience: framework-users, contributors
---

# Custom Guard Rules

Mandu ships six architecture presets (`fsd`, `clean`, `hexagonal`,
`atomic`, `cqrs`, `mandu`). Phase 18.ν adds a thin extension point on
top of the preset layer so consumers can codify project-local rules
without forking the framework or pulling in `eslint-plugin-local`.

The mental model is deliberately small:

- A **rule** is a function that takes one parsed source file and returns
  zero or more violations.
- `mandu.config.ts` accepts an array of rules under `guard.rules`.
- The Guard runner merges those violations into the standard report
  with a `custom:<rule.id>` prefix so the reporter can attribute each
  entry unambiguously.

That's it. No new CLI command, no plugin lifecycle, no runtime
dependency.

## Quick start — forbid a package

```ts
// mandu.config.ts
import { forbidImport } from "@mandujs/core/guard/rule-presets";

export default {
  guard: {
    rules: [
      forbidImport({ from: "axios", matches: /./ }),
    ],
  },
};
```

```text
$ mandu guard check
custom:forbid-import:axios  src/users/fetcher.ts:1
  Forbidden import: `axios` (Imports from `axios` are forbidden.)
  hint: Use a project-approved alternative.
```

## Writing a rule from scratch

Reach for `defineGuardRule` when the preset helpers don't fit:

```ts
// mandu.config.ts
import { defineGuardRule } from "@mandujs/core/guard/define-rule";

export default {
  guard: {
    rules: [
      defineGuardRule({
        id: "no-sync-fs-in-app",
        severity: "error",
        description: "Sync fs.* calls block the event loop in app/ handlers.",
        check: (ctx) => {
          if (!ctx.sourceFile.startsWith("app/")) return [];
          if (!/fs\.(readFileSync|writeFileSync|statSync)/.test(ctx.content)) return [];
          return [
            {
              file: ctx.sourceFile,
              message: "Synchronous fs call detected in app/ handler.",
              hint: "Use fs/promises or Bun.file() instead.",
            },
          ];
        },
      }),
    ],
  },
};
```

`defineGuardRule()` is an identity function with a runtime shape check —
use it to get a clear error when a plain-JS `mandu.config.js` has a
typo. `check()` may return a `GuardViolation[]` or `Promise<GuardViolation[]>`.

### Context contract

```ts
interface GuardRuleContext {
  sourceFile: string;           // Path relative to project root
  content: string;              // UTF-8 file content
  imports: ImportInfo[];        // Parsed imports (AST-level)
  exports: ExportInfo[];        // Parsed exports (AST-level)
  config: ManduConfig;          // Resolved mandu.config
  projectRoot: string;          // Absolute project root
}
```

Imports and exports are pre-parsed with Mandu's Guard AST analyzer, so
comments and strings never trigger false positives.

### Violation shape

```ts
interface GuardViolation {
  file: string;
  line?: number;
  column?: number;
  message: string;
  hint?: string;                // Shown under `message`
  docsUrl?: string;             // Optional link
}
```

## Preset recipes

The three convenience presets in `@mandujs/core/guard/rule-presets`
cover the most common project-local patterns.

### `forbidImport`

Reject imports by package name or regex.

```ts
forbidImport({ from: "axios" });                     // literal match
forbidImport({ from: /^node:(fs|child_process)$/ }); // regex match
forbidImport({
  from: "lodash",
  severity: "warning",
  hint: "Use native APIs or lodash-es.",
  includePaths: [/^app\//],    // only flag files under app/
  excludePaths: [/tests?\//],  // ignore test files
});
```

### `requireNamedExport`

Enforce file-based routing conventions.

```ts
requireNamedExport({
  patterns: [/app\/api\/.*\/route\.ts$/],
  names: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  requireAny: true, // "must export at least one verb"
});
```

### `requirePrefixForExports`

All named exports in matching files must start with the given prefix.
Combines well with `requireNamedExport` for HTTP route files.

```ts
requirePrefixForExports({
  patterns: [/app\/api\/.*\/route\.ts$/],
  prefix: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/,
  allowList: ["metadata"], // exempt these exports
});
```

## Migration from `eslint-plugin-local`

Most project-local ESLint rules fall into three buckets that map 1:1
to the preset helpers:

| ESLint pattern                         | Mandu equivalent                |
| -------------------------------------- | ------------------------------- |
| `no-restricted-imports: ["axios"]`     | `forbidImport({ from: "axios" })` |
| `require-default-export`               | `requireNamedExport({ names: ["default"] })` |
| custom rule for handler naming         | `requirePrefixForExports({ prefix: /^(GET|POST)$/ })` |

For rules with non-trivial AST analysis (e.g. "no React hook inside a
loop"), ship a `defineGuardRule` factory and share it across projects
via a regular npm package — no plugin framework required.

## Execution model

- Each rule runs once per source file discovered under the standard
  Guard scan roots: `packages/`, `src/`, `app/`.
- Files under `.mandu/` and any path containing `__generated__` are
  skipped — generated code is covered by the built-in
  `INVALID_GENERATED_IMPORT` rule.
- Rules execute with a worker-pool cap. Default `8`; override with
  `MANDU_GUARD_CUSTOM_CONCURRENCY=16` for CPU-bound rules or
  `=1` for strict ordering during debugging.
- A throwing `check()` does **not** abort the scan. The runner catches
  the error, emits a `custom:<id>` violation with the thrown message,
  and continues to the next file. This keeps one malformed rule from
  tearing down the whole report.

## Severity and CI integration

- `"error"` fails `mandu guard check` (non-zero exit code).
- `"warning"` shows in the report but does not gate CI.
- `"info"` is surfaced as a soft warning in the standard report —
  useful for migration-phase rules that should not block merges yet.

The reporter attribution always uses the `custom:<rule.id>` prefix,
which makes CI filters straightforward:

```yaml
# .github/workflows/ci.yml
- name: Architecture guard
  run: bunx mandu guard check --format=json > guard-report.json
- name: Enforce custom rules
  run: |
    jq -e '[.violations[] | select(.ruleId | startswith("custom:"))] | length == 0' guard-report.json
```

## Troubleshooting

**"Rule "foo" threw: ..."** — `check()` raised an exception. Check the
rule body; the runner caught it and kept scanning.

**"Duplicate guard.rules id ..."** — two rules share an `id`. Only the
first is enforced; rename the later one or remove it.

**Zod complains "Each custom guard rule must be an object with a
non-empty id..."** — a `guard.rules` entry is missing `id` or `check`.
Wrap it with `defineGuardRule({...})` or use a preset helper.

**Rule matches everything** — remember `matches` defaults to `/./`
(match-all). Constrain it with `includePaths` or a tighter `from`
regex.

## Related

- `docs/architect/generated-access.md` — built-in `__generated__` rule.
- `@mandujs/core/guard/define-rule` — `defineGuardRule`, `GuardRule`,
  `GuardRuleContext`, `GuardViolation`.
- `@mandujs/core/guard/rule-presets` — `forbidImport`,
  `requireNamedExport`, `requirePrefixForExports`.
