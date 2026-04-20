---
title: mandu diagnose
owner: cli
status: stable
issue: "#215"
---

# `mandu diagnose`

Runs the extended diagnostic check set and returns a unified health report. Issue #215 introduced this command to close the *"all checks pass but prod is broken"* gap — the legacy MCP `mandu.diagnose` only inspected four structural surfaces (kitchen / guard / contract / manifest) and returned `healthy: true` in environments where `#211` (stale bundle manifest), `#212` (React key warnings), `#213` (prerender pollution), and `#214` (missing dynamic-params dispatch) were actively breaking deploys.

## Usage

```bash
mandu diagnose             # console summary + exit 1 on error
mandu diagnose --json      # JSON report to stdout (CI-friendly)
mandu diagnose --quiet     # summary line only, no per-check narrative
```

### Exit codes

| Code | Meaning |
|------|---------|
| `0`  | Healthy — no check returned `severity: error`. Warnings are informational and do NOT fail. |
| `1`  | Unhealthy — at least one check returned `severity: error`. Deploy should be blocked. |

## Check matrix

Every check returns the unified shape:

```typescript
{
  ok: boolean;                            // pass/fail
  rule: string;                           // stable machine id
  severity?: "error" | "warning" | "info"; // only when ok === false
  message: string;                        // human summary
  suggestion?: string;                    // single actionable next step
  details?: Record<string, unknown>;      // structured evidence
}
```

| Rule | Severity when failing | What it catches |
|------|------------------------|-----------------|
| `manifest_freshness`    | `error` (dev-mode), `warning` (empty bundles + islands declared) | Stale `.mandu/manifest.json` shipping to prod, missing manifest, corrupted JSON. Closes #211. |
| `prerender_pollution`   | `warning` | Suspicious prerendered route shapes: literal `path` / `example` segments, `...` leak, uppercase-starting segments, single-char segments. Typically originates from `generateStaticParams()` ingesting doc placeholders. Closes #213. |
| `cloneelement_warnings` | `info` (1-10), `warning` (>10) | `Each child in a list should have a unique "key" prop` occurrences in `.mandu/build.log` or `.mandu/dev-server.stderr.log`. Closes #212 (fixed in `@mandujs/core >= 0.32.0`). |
| `dev_artifacts_in_prod` | `error` | `_devtools.js` present when `manifest.env === 'production'` OR `mandu.config.ts` sets `dev.devtools: false`; prerendered HTML referencing devtools scripts. |
| `package_export_gaps`   | `error` | User imports of `@mandujs/core/<subpath>` where `<subpath>` is NOT declared in the installed core's `exports` map. Catches the #194 / #202 / #210 pattern. |

### Legacy checks (MCP composite only)

When run via the MCP tool `mandu.diagnose`, four additional legacy checks run alongside the extended set and are normalized into the same unified shape:

- `kitchen_errors` — runtime error buffer from Kitchen.
- `guard_check` — architecture guard violations.
- `contract_validation` — Zod contract/runtime mismatches.
- `manifest_validation` — FS-routes manifest schema.

The `manifest_validation` legacy check is automatically downgraded to `warning` when `manifest_freshness` reports a stale bundle manifest — closing the false-signal path where the FS-routes manifest is valid but the bundle manifest was never regenerated.

## JSON schema

```jsonc
{
  "healthy": false,
  "errorCount": 1,
  "warningCount": 1,
  "checks": [
    {
      "ok": false,
      "rule": "manifest_freshness",
      "severity": "error",
      "message": "Bundle manifest is dev-mode (env=development). Dev artifacts should never reach prod.",
      "suggestion": "Run `mandu build` to produce a production manifest.",
      "details": { "env": "development", "bundleCount": 1, "islandCount": 0 }
    },
    {
      "ok": false,
      "rule": "prerender_pollution",
      "severity": "warning",
      "message": "Found 1 suspicious prerendered route(s). Likely doc placeholder leak (#213). First: /path (literal 'path' segment)",
      "suggestion": "Check `generateStaticParams()` — often fence-block params escape the MDX extractor.",
      "details": { "suspiciousCount": 1, "scanned": 1, "sample": [...] }
    },
    { "ok": true, "rule": "cloneelement_warnings", "message": "..." },
    { "ok": true, "rule": "dev_artifacts_in_prod", "message": "..." },
    { "ok": true, "rule": "package_export_gaps", "message": "..." }
  ],
  "summary": { "total": 5, "passed": 3, "failed": 2 }
}
```

## CI integration

### GitHub Actions

```yaml
- name: Build
  run: mandu build

- name: Diagnose
  run: mandu diagnose --json > diagnose-report.json

- name: Upload diagnose report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: diagnose-report
    path: diagnose-report.json
```

### Treat specific warnings as errors

`mandu diagnose` only fails CI on `severity: error`. To fail on any warning as well, post-process the JSON:

```bash
mandu diagnose --json > report.json
if [ "$(jq '.warningCount' report.json)" -gt 0 ]; then
  echo "Warnings found — failing build"
  cat report.json
  exit 1
fi
```

## Related

- `mandu check` — lighter structural check (FS routes + guard + config lockfile).
- `mandu guard` — architecture guard only.
- MCP tool `mandu.diagnose` — runs both extended checks AND legacy structural checks.

## Programmatic API

```typescript
import { runExtendedDiagnose } from "@mandujs/core/diagnose";

const report = await runExtendedDiagnose(process.cwd());
if (!report.healthy) {
  for (const check of report.checks) {
    if (!check.ok && check.severity === "error") {
      console.error(`[${check.rule}] ${check.message}`);
    }
  }
  process.exit(1);
}
```
