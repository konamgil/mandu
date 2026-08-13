---
title: mandu info
owner: cli
status: stable
---

# `mandu info`

Single-command snapshot of the runtime, config, route surface, and
extended health report. Designed to be the **first command a human (or an
agent) runs** when triaging a broken project — one blob, every fact.

## Usage

```bash
mandu info                                       # pretty table (stdout)
mandu info --json                                # machine-readable JSON
mandu info --json > info.json                    # capture for issue report
mandu info --include=mandu,runtime,diagnose      # subset only
```

### Flags

| Flag                    | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `--json`                | Emit the full payload as JSON. No pretty table.          |
| `--include <sections>`  | Comma-separated whitelist filter over the sections list. |

### Sections

| ID           | Content                                                            |
| ------------ | ------------------------------------------------------------------ |
| `mandu`      | Installed `@mandujs/*` package versions                            |
| `runtime`    | Bun / Node / OS / CPU / memory / NODE_ENV                          |
| `project`    | package.json `name`, `version`, `packageManager`, detected config  |
| `config`     | `mandu.config.*` distilled: server, guard, build, i18n, flags      |
| `routes`     | Total + per-kind counts (page / api / metadata / …) via scanRoutes |
| `middleware` | Declared middleware chain (index + name)                           |
| `plugins`    | Registered plugins + declared hook surface                         |
| `diagnose`   | Extended health checks (Issue #215, same as `mandu diagnose`)      |

An unknown section in `--include` is silently dropped. When every entry
is unknown the filter falls back to "all sections" — this prevents a
silent "no output" trap from a typo.

### Exit code

`mandu info` is an **inspector**, not a gate. It always exits `0` once it
finishes writing. Use `mandu diagnose` when you need a non-zero exit on
unhealthy projects (CI deploy gate).

## Sample output (human)

```
Mandu Info

mandu
  @mandujs/core      0.34.2
  @mandujs/cli       0.28.2
  @mandujs/mcp       0.22.1
  @mandujs/ate       0.19.1
  @mandujs/skills    13.0.0
  @mandujs/edge      0.4.16

runtime
  Bun              1.3.14
  Node             v20.11.0
  OS               win32 x64 (10.0.19045)
  CPU              8 cores — Intel(R) Core(TM) i7-9700K
  Memory           16 GiB total / 280 MiB used
  NODE_ENV         development

project
  name             mandujs.com
  version          0.2.0
  root             C:\Users\me\projects\mandujs.com
  packageManager   bun@1.3.14
  config           mandu.config.ts

mandu.config summary
  server           { port: 3333, hostname: "0.0.0.0" }
  guard            { preset: "mandu", customRules: 0, overrides: 0 }
  build            { prerender: true, budget: maxGz=250000 mode=warning }
  i18n             { locales: 2, default: "en", strategy: "path-prefix" }
  transitions      true
  prefetch         true
  spa              true

routes
  total            47
    page           32
    api            12
    metadata       3

middleware chain (2)
  1. sessionMiddleware
  2. csrfMiddleware

plugins (1)
  - telemetry (hooks: onRouteRegistered, onBundleComplete)

diagnose
  [ok]    manifest_freshness
  [ok]    prerender_pollution
  [warn]  cloneelement_warnings
  [ok]    dev_artifacts_in_prod
  [ok]    package_export_gaps
  [ok]    a11y_hints
  → HEALTHY (0 error, 1 warning)
```

## Sample output (JSON excerpt)

```json
{
  "generatedAt": "2026-04-20T13:45:22.012Z",
  "sections": [
    "mandu", "runtime", "project", "config",
    "routes", "middleware", "plugins", "diagnose"
  ],
  "mandu": {
    "core": "0.34.2",
    "cli": "0.28.2",
    "mcp": "0.22.1",
    "ate": "0.19.1",
    "skills": "13.0.0",
    "edge": "0.4.16"
  },
  "runtime": {
    "bun": "1.3.14",
    "node": "v20.11.0",
    "platform": "win32",
    "arch": "x64",
    "osRelease": "10.0.19045",
    "cpuCount": 8,
    "cpuModel": "Intel(R) Core(TM) i7-9700K",
    "memoryTotalBytes": 17179869184,
    "memoryUsedBytes": 293601280,
    "nodeEnv": "development"
  },
  "config": {
    "server": { "port": 3333, "hostname": "0.0.0.0", "streaming": null },
    "guard":  { "preset": "mandu", "customRules": 0, "ruleOverrides": 0 },
    "build":  { "prerender": true, "budget": { "maxRawBytes": null, "maxGzBytes": 250000, "mode": "warning" } },
    "i18n":   { "locales": 2, "defaultLocale": "en", "strategy": "path-prefix" },
    "transitions": true,
    "prefetch": true,
    "spa": true
  },
  "routes": { "total": 47, "byKind": { "page": 32, "api": 12, "metadata": 3 }, "errors": 0 },
  "diagnose": {
    "healthy": true,
    "errorCount": 0,
    "warningCount": 1,
    "checks": [ /* one entry per extended check */ ]
  }
}
```

## Issue-report recipe

When filing a Mandu bug report, paste the JSON payload verbatim. It
contains everything a maintainer (or an agent) needs to reproduce your
environment without a back-and-forth:

```bash
mandu info --json > info.json
# attach info.json to the issue, or:
bun x mandu info --json | pbcopy     # macOS
bun x mandu info --json | clip       # Windows
```

Safety note: the payload does **not** include env var values, secrets, or
file contents — only shape (package versions, numeric limits, boolean
toggles, rule names). Sharing it publicly is safe.

## Agent-friendly use

LLMs consume a single JSON blob far more reliably than scraped text. A
typical agent triage loop:

```
1. Run `mandu info --json`
2. Parse `diagnose.healthy`
   - false → branch into `mandu diagnose` for full narrative
   - true  → inspect `routes`, `middleware`, `plugins` for drift
3. Correlate with the user's reported symptom
```

The sections list inside the envelope (`sections: [...]`) tells the agent
which fields were intentionally emitted vs. filtered out via
`--include`, so downstream reasoning can distinguish "field missing
because empty" from "field missing because not requested".
