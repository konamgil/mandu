import type * as __ManduMonitorTypes0 from "./monitor";
/**
 * DNA-010: Command Registry Pattern
 *
 * Declarative command registration system
 * - Each command defined independently
 * - Lazy loading for startup time optimization
 * - Automatic subcommand routing
 */


import type { CSSFramework, UILibrary } from "./init";
import { reportLabsFeature } from "../util/labs";
import { OFFICIAL_COMMANDS } from "./surface";

/**
 * Command execution context
 */
export interface CommandContext<TOptions extends Record<string, unknown> = Record<string, string>> {
  args: string[];
  options: TOptions;
}

/**
 * Command registration definition
 */
export interface CommandRegistration {
  /** Command ID (e.g., "dev", "build", "guard") */
  id: string;
  /**
   * Alternate command names that resolve to this same registration.
   *
   * Each alias is bound as an extra key in `commandRegistry` so
   * `mandu <alias>` dispatches to `run` exactly as `mandu <id>` would.
   * Aliases are surfaced in `--help` next to the canonical id and in
   * shell completion via `getAllCommands()`. They do NOT appear as
   * separate top-level entries in the help command list — see the
   * dedupe step in `getAllCommandRegistrations()`.
   */
  aliases?: string[];
  /** Command description */
  description: string;
  /** Explicitly exit the CLI process after a successful run */
  exitOnSuccess?: boolean;
  /** Subcommand list (e.g., "arch", "legacy" for guard) */
  subcommands?: string[];
  /** Default subcommand (when invoked without subcommand) */
  defaultSubcommand?: string;
  /** Command execution */
  run: (ctx: CommandContext) => Promise<boolean>;
  /**
   * Per-command help surface. When set, `mandu <id> --help` prints
   * this instead of falling through to the global help block. The
   * value is either a static string or an async function that renders
   * the help text to stdout and returns `void`. Commands with rich
   * help blocks (ai, db, mcp, deploy, upgrade, test, build, dev)
   * define this; all others fall back to global help.
   */
  help?: string | ((ctx: CommandContext) => Promise<void> | void);
}

/**
 * Mapped type: derive a handler map from a command options map.
 *
 * Given a mapping of command names to their option types, produces
 * the corresponding handler signatures automatically.
 *
 * @example
 * ```typescript
 * type Cmds = { build: { watch: boolean }; dev: { port: number } };
 * type Handlers = CommandHandlers<Cmds>;
 * // => { build: (ctx: CommandContext<{ watch: boolean }>) => Promise<boolean>;
 * //      dev:   (ctx: CommandContext<{ port: number }>)    => Promise<boolean>; }
 * ```
 */
export type CommandHandlers<TMap extends Record<string, Record<string, unknown>>> = {
  [K in keyof TMap]: (ctx: CommandContext<TMap[K]>) => Promise<boolean>;
};

/**
 * Command registry
 */
export const commandRegistry = new Map<string, CommandRegistration>();

/**
 * Register a command. The registration is bound under `id` and under each
 * entry in `aliases`, so `getCommand(alias)` returns the same object as
 * `getCommand(id)`.
 *
 * Conflict policy: if an alias collides with an already-registered id (or
 * another alias), we throw at registration time so the conflict surfaces
 * during CLI startup rather than as a silent dispatch surprise later.
 */
export function registerCommand(registration: CommandRegistration): void {
  commandRegistry.set(registration.id, registration);
  if (!registration.aliases) return;
  for (const alias of registration.aliases) {
    if (alias === registration.id) continue;
    const existing = commandRegistry.get(alias);
    if (existing && existing !== registration) {
      throw new Error(
        `Command alias "${alias}" for "${registration.id}" collides with existing command "${existing.id}"`
      );
    }
    commandRegistry.set(alias, registration);
  }
}

/**
 * Look up a command by id or alias.
 */
export function getCommand(id: string): CommandRegistration | undefined {
  return commandRegistry.get(id);
}

/**
 * List every registered key — both canonical ids and aliases.
 *
 * Used by shell completion so `<TAB>` surfaces all valid spellings.
 */
export function getAllCommands(): string[] {
  return Array.from(commandRegistry.keys());
}

/**
 * List registered commands with metadata in registration order, with
 * aliases collapsed into their canonical entry. Each registration is
 * returned exactly once even if it was bound under multiple keys.
 *
 * Used by the help renderer so `init` and `create` show up as one row
 * (with `create` listed under the row's `aliases` column) rather than
 * two duplicate rows.
 */
export function getAllCommandRegistrations(): CommandRegistration[] {
  const seen = new Set<CommandRegistration>();
  const out: CommandRegistration[] = [];
  for (const registration of commandRegistry.values()) {
    if (seen.has(registration)) continue;
    seen.add(registration);
    out.push(registration);
  }
  return out;
}

/** Product help is deliberately smaller than the compatibility registry. */
export function getOfficialCommandRegistrations(): CommandRegistration[] {
  return OFFICIAL_COMMANDS.map((id) => {
    const registration = getCommand(id);
    if (!registration) {
      throw new Error(`Official CLI command "${id}" is not registered.`);
    }
    return registration;
  });
}

// ============================================================================
// Command registration (lazy loading)
// ============================================================================

// Phase 2 split: `mandu create <name>` is now the canonical
// new-folder scaffold path. `mandu init` (no name) is a *retrofit*
// that drops Mandu structure into the current directory.
//
// `mandu init <name>` is kept working for one deprecation cycle —
// it prints a warning and forwards to `create`. We'll remove that
// forwarding once usage drops (see issue #256 follow-up).
registerCommand({
  id: "init",
  description:
    "Retrofit Mandu into the current directory (use `mandu create <name>` to scaffold a new project)",
  async run(ctx) {
    const positional = ctx.options.name || ctx.options._positional;
    if (positional) {
      console.warn(
        `⚠️  \`mandu init ${positional}\` is deprecated; use \`mandu create ${positional}\` instead.`
      );
      console.warn(
        `    \`mandu init\` (no arguments) now retrofits Mandu into the current directory.`
      );
      const create = getCommand("create");
      if (!create) {
        // Should never happen — `create` is registered immediately
        // after `init`. Defensive only.
        return false;
      }
      return create.run(ctx);
    }
    const { retrofit, printRetrofitResult } = await import("./init-retrofit");
    const dryRun =
      ctx.options["dry-run"] === "true" || ctx.options["dry-run"] === "";
    const force = ctx.options.force === "true" || ctx.options.force === "";
    const result = await retrofit({ dryRun, force });
    printRetrofitResult(result, { dryRun });
    return result.success;
  },
});

registerCommand({
  id: "create",
  description: "Scaffold a new Mandu project (Tailwind + shadcn/ui by default)",
  async run(ctx) {
    const { init } = await import("./init");
    // `--design` accepts either a bare flag (`--design`, no value) or a
    // slug (`--design=stripe`). The argv parser hands us "true" for the
    // bare form, an empty string for `--design=` (oddly), or the slug
    // string for `--design=foo`.
    const designRaw = ctx.options.design;
    let design: boolean | string | undefined;
    if (designRaw === undefined) design = undefined;
    else if (designRaw === "true" || designRaw === "") design = true;
    else design = String(designRaw);
    return init({
      name: ctx.options.name || ctx.options._positional,
      template: ctx.options.template,
      css: ctx.options.css as CSSFramework | undefined,
      ui: ctx.options.ui as UILibrary | undefined,
      theme: ctx.options.theme === "true",
      minimal: ctx.options.minimal === "true",
      withCi: ctx.options["with-ci"] === "true",
      yes: ctx.options.yes === "true",
      noInstall: ctx.options["no-install"] === "true",
      design,
      exitOnSuccess: true,
    });
  },
});

registerCommand({
  id: "dev",
  description: "Start dev server (FS Routes + Guard enabled by default)",
  help: [
    "",
    "  mandu dev — start the development server",
    "",
    "  Flags:",
    "    --port=<n>     Port to bind (default: 3333, overridable via PORT env)",
    "    --open         Open the browser after boot",
    "",
    "  Features:",
    "    - FS-based routing (app/ directory)",
    "    - Architecture guard on file change",
    "    - HMR for client islands",
    "    - Tailwind CSS watcher (when tailwindcss is installed)",
    "",
    "  Examples:",
    "    mandu dev",
    "    mandu dev --port=4000 --open",
    "",
  ].join("\n"),
  async run(ctx) {
    const { dev } = await import("./dev");
    const port = ctx.options.port ? Number(ctx.options.port) : undefined;
    const open = ctx.options.open === "true" || ctx.options.open === "";
    await dev({ port, open });
    return true;
  },
});

registerCommand({
  id: "build",
  description: "Build the stable Bun runtime and client hydration bundles",
  exitOnSuccess: true,
  help: [
    "",
    "  mandu build — build client bundles",
    "",
    "  Flags:",
    "    --watch                   Rebuild on file changes",
    "    --analyze[=json]          Emit .mandu/analyze/report.html + report.json (Phase 18.η)",
    "    --no-budget               Skip bundle-size budget enforcement for this run (Phase 18.φ)",
    "    --prerender-skip-errors   Downgrade prerender errors to warnings (Issue #216)",
    "    --audit                   Run axe-core a11y audit over prerendered HTML (Phase 18.χ)",
    "    --audit-fail-on=<impact>  Fail build when violation ≥ impact (minor|moderate|serious|critical)",
    "    --static[=<dir>]          Emit a flat static-host-ready dir (default: dist) — Issue #249",
    "",
    "  Outputs:",
    "    .mandu/client/                              Hydration bundles (default target)",
    "    .mandu/prerendered/                         Prerendered HTML (per locale, per route)",
    "    <dir>/                                      Flat static export (when --static is used)",
    "",
    "  Examples:",
    "    mandu build",
    "    mandu build --watch",
    "    mandu build --static                         # flat dist/ for any static host",
    "    mandu build --static=public-out              # custom output dir",
    "",
    "  Deployment:",
    "    Deploy the verified project with provider or container tooling.",
    "    Contract: docs/deploy/artifact-contract.md",
    "",
  ].join("\n"),
  async run(ctx) {
    const { build } = await import("./build");
    const rawTarget = ctx.options.target;
    type BuildTarget = "workers" | "deno" | "vercel-edge" | "netlify-edge";
    const ALLOWED_TARGETS: ReadonlyArray<BuildTarget> = [
      "workers",
      "deno",
      "vercel-edge",
      "netlify-edge",
    ];
    let target: BuildTarget | undefined;
    if (rawTarget && rawTarget !== "true") {
      if ((ALLOWED_TARGETS as readonly string[]).includes(rawTarget)) {
        target = rawTarget as BuildTarget;
      } else {
        console.error(
          `❌ Unsupported --target value: "${rawTarget}". ` +
            `Supported: ${ALLOWED_TARGETS.join(", ")} (Phase 15.1–15.2).`
        );
        return false;
      }
    }
    // Phase 18.η — `--analyze` (bare) → boolean true; `--analyze=json`
    // → string "json" (JSON-only, skip HTML render). Any other value is
    // treated as truthy to keep the flag permissive.
    const rawAnalyze = ctx.options.analyze;
    let analyze: boolean | "json" | undefined;
    if (rawAnalyze === "json") analyze = "json";
    else if (rawAnalyze === "true") analyze = true;
    else if (rawAnalyze !== undefined) analyze = true;
    return build({
      watch: ctx.options.watch === "true",
      target,
      workerName: ctx.options["worker-name"] && ctx.options["worker-name"] !== "true"
        ? ctx.options["worker-name"]
        : undefined,
      projectName: ctx.options["project-name"] && ctx.options["project-name"] !== "true"
        ? ctx.options["project-name"]
        : undefined,
      analyze,
      // Issue #216 — downgrade prerender hard-failures to warnings when
      // the user explicitly opts in (e.g., an existing project that
      // ships a broken `generateStaticParams` and wants CI green while
      // they fix it).
      prerenderSkipErrors: ctx.options["prerender-skip-errors"] === "true",
      // Phase 18.φ — `--no-budget` skips bundle-size budget enforcement
      // for this run. CLI flag arrives normalized as either "true" (the
      // arg parser sets this when `--no-budget` is present with no value)
      // or an explicit string — we accept either truthy signal.
      noBudget:
        ctx.options["no-budget"] === "true" ||
        ctx.options["no-budget"] === "",
      // Phase 18.χ — opt-in axe-core audit of prerendered HTML. Requires
      // the optional peerDeps `axe-core` + `jsdom` (or HappyDOM fallback);
      // when absent the runner prints one informational line and exits 0.
      audit: ctx.options.audit === "true" || ctx.options.audit === "",
      // Phase 18.χ — gate the exit code on violation severity. Leaving
      // this undefined runs the audit informationally; specifying a value
      // causes the build to fail when any violation at or above that
      // impact level is reported by axe-core.
      auditFailOn: (function () {
        const raw = ctx.options["audit-fail-on"];
        const allowed = ["minor", "moderate", "serious", "critical"] as const;
        if (typeof raw === "string" && (allowed as readonly string[]).includes(raw)) {
          return raw as (typeof allowed)[number];
        }
        return undefined;
      })(),
      // Pre-build lint gate (#240 guardrail-default). Pass --no-lint to
      // skip when you need to ship despite known lint errors.
      noLint:
        ctx.options["no-lint"] === "true" ||
        ctx.options["no-lint"] === "",
      // Issue #249 — `--static` (bare) → true, defaulting outDir to "dist".
      // `--static=<dir>` → custom directory. Anything else falsy → skip.
      staticExport: (function () {
        const raw = ctx.options.static;
        if (raw === undefined) return undefined;
        if (raw === "true" || raw === "") return true;
        return raw;
      })(),
    });
  },
});

registerCommand({
  id: "start",
  description: "Start production server (after build)",
  async run(ctx) {
    const { start } = await import("./start");
    const port = ctx.options.port ? Number(ctx.options.port) : undefined;
    await start({ port });
    return true;
  },
});

registerCommand({
  id: "clean",
  description: "Remove build artifacts (.mandu/client, .mandu/static)",
  exitOnSuccess: true,
  async run(ctx) {
    const { clean } = await import("./clean");
    return clean({ all: ctx.options.all === "true" });
  },
});

registerCommand({
  id: "design",
  description:
    "DESIGN.md operations (init / import / validate / sync / lint / link). Issue #245.",
  exitOnSuccess: true,
  help: [
    "",
    "  mandu design — DESIGN.md operations",
    "",
    "  Subcommands:",
    "    init [--from <slug|url>]    Write a fresh DESIGN.md skeleton (or import).",
    "    import <slug|url>           Overwrite DESIGN.md with an imported brand spec.",
    "    validate                    Report missing / empty / malformed sections.",
    "    sync [--dry-run]            Compile DESIGN.md tokens → Tailwind v4 @theme.",
    "    lint                        Self-consistency check (color hex, slug clashes).",
    "    link [--create]             Wire AGENTS.md / CLAUDE.md to DESIGN.md.",
    "",
    "  Flags:",
    "    --from <slug|url>   Source for init/import (awesome-design-md slug or URL).",
    "    --force             init: overwrite existing DESIGN.md.",
    "    --filename <name>   Target DESIGN.md filename (default: DESIGN.md).",
    "    --css-path <path>   sync: override the target CSS file.",
    "    --dry-run           sync: print compiled @theme without writing.",
    "    --create            link: seed AGENTS.md when neither AGENTS.md nor CLAUDE.md exists.",
    "",
    "  Examples:",
    "    mandu design init --from stripe",
    "    mandu design sync --dry-run",
    "    mandu design lint",
    "    mandu design link --create",
    "",
  ].join("\n"),
  subcommands: ["init", "import", "validate", "sync", "lint", "link"],
  async run(ctx) {
    const { design } = await import("./design");
    const sub = ctx.args[1];
    const allowed = ["init", "import", "validate", "sync", "lint", "link"] as const;
    if (!(allowed as readonly string[]).includes(sub ?? "")) {
      console.error(
        `❌ unknown subcommand "${sub ?? ""}". Use one of: ${allowed.join(" | ")}`,
      );
      console.error(`   Run \`mandu design --help\` for usage.`);
      return false;
    }
    const fromArg =
      ctx.options.from && ctx.options.from !== "true" ? ctx.options.from : undefined;
    const positionalFrom = sub === "import" ? ctx.args[2] : undefined;
    return design({
      action: sub as DesignAction,
      from: fromArg ?? positionalFrom,
      force: ctx.options.force === "true" || ctx.options.force === "",
      filename:
        ctx.options.filename && ctx.options.filename !== "true"
          ? ctx.options.filename
          : undefined,
      cssPath:
        ctx.options["css-path"] && ctx.options["css-path"] !== "true"
          ? ctx.options["css-path"]
          : undefined,
      dryRun: ctx.options["dry-run"] === "true" || ctx.options["dry-run"] === "",
      createIfMissing: ctx.options.create === "true" || ctx.options.create === "",
    });
  },
});

type DesignAction = "init" | "import" | "validate" | "sync" | "lint" | "link";

registerCommand({
  id: "agent",
  description:
    "Canonical agent workflow: context, plan, apply, verify, repair, sync",
  subcommands: ["context", "manifest", "plan", "apply", "verify", "repair", "sync"],
  exitOnSuccess: true,
  async help(_ctx) {
    const { AGENT_HELP } = await import("./agent");
    process.stdout.write(AGENT_HELP);
  },
  async run(ctx) {
    const { agent } = await import("./agent");
    const sub = ctx.args[1] as
      | "context"
      | "manifest"
      | "plan"
      | "apply"
      | "verify"
      | "repair"
      | "sync"
      | undefined;
    const intentFromFlag =
      typeof ctx.options.intent === "string" && ctx.options.intent !== "true"
        ? ctx.options.intent
        : undefined;
    const intentFromArgs =
      sub === "plan"
        ? ctx.args
            .slice(2)
            .filter((arg) => !arg.startsWith("--"))
            .join(" ")
            .trim()
        : undefined;
    return agent({
      action: sub,
      json: ctx.options.json === "true" || ctx.options.json === "",
      write: ctx.options.write === "true" || ctx.options.write === "",
      changed:
        ctx.options.changed === "true" || ctx.options.changed === ""
          ? true
          : undefined,
      staged:
        ctx.options.staged === "true" || ctx.options.staged === ""
          ? true
          : undefined,
      base:
        ctx.options.base && ctx.options.base !== "true"
          ? ctx.options.base
          : undefined,
      from:
        ctx.options.from && ctx.options.from !== "true"
          ? ctx.options.from
          : undefined,
      intent: intentFromFlag ?? intentFromArgs,
      operations:
        ctx.options.operations && ctx.options.operations !== "true"
          ? ctx.options.operations
          : undefined,
      rollbackId:
        ctx.options.rollback && ctx.options.rollback !== "true"
          ? ctx.options.rollback
          : undefined,
      dryRun:
        ctx.options["dry-run"] === "true" || ctx.options["dry-run"] === ""
          ? true
          : ctx.options.execute === "true" || ctx.options.execute === "" ||
              ctx.options["no-dry-run"] === "true" || ctx.options["no-dry-run"] === ""
            ? false
            : undefined,
      target:
        ctx.options.target === "codex" ||
        ctx.options.target === "claude" ||
        ctx.options.target === "gemini" ||
        ctx.options.target === "all"
          ? ctx.options.target
          : undefined,
      apply: ctx.options.apply === "true" || ctx.options.apply === "",
      cwd:
        ctx.options.cwd && ctx.options.cwd !== "true"
          ? ctx.options.cwd
          : undefined,
      includeDiagnose:
        ctx.options["no-diagnose"] === "true" || ctx.options["no-diagnose"] === ""
          ? false
          : undefined,
      includeGit:
        ctx.options["no-git"] === "true" || ctx.options["no-git"] === ""
          ? false
          : undefined,
      includeGuard:
        ctx.options["no-guard"] === "true" || ctx.options["no-guard"] === ""
          ? false
          : undefined,
      includeContract:
        ctx.options["no-contract"] === "true" || ctx.options["no-contract"] === ""
          ? false
          : undefined,
    });
  },
});

registerCommand({
  id: "info",
  description:
    "Print environment + config + health summary (agent-friendly debug dump)",
  exitOnSuccess: true,
  help: [
    "",
    "  mandu info — environment + config + health snapshot",
    "",
    "  Flags:",
    "    --json                 Emit the payload as JSON to stdout",
    "    --include <sections>   Comma-separated filter over:",
    "                           mandu,runtime,project,config,routes,",
    "                           middleware,plugins,diagnose",
    "",
    "  Sections:",
    "    mandu        Installed @mandujs/* package versions",
    "    runtime      Bun/Node/OS/CPU/memory/NODE_ENV",
    "    project      package.json name + version + packageManager",
    "    config       mandu.config.* distilled summary",
    "    routes       Total + per-kind route counts from scanRoutes()",
    "    middleware   Declared middleware chain",
    "    plugins      Registered plugins + hook surface",
    "    diagnose     Extended health report (Issue #215)",
    "",
    "  Examples:",
    "    mandu info",
    "    mandu info --json > info.json",
    "    mandu info --include=mandu,runtime,diagnose",
    "",
    "  Issue reports: paste `mandu info --json` output for full context.",
    "",
  ].join("\n"),
  async run(ctx) {
    const { info } = await import("./info");
    const includeRaw = ctx.options.include;
    const include =
      typeof includeRaw === "string" && includeRaw !== "true" ? includeRaw : undefined;
    return info({
      json: ctx.options.json === "true",
      include,
    });
  },
});

registerCommand({
  id: "preview",
  description: "Build then start production server",
  async run(ctx) {
    const { preview } = await import("./preview");
    const port = ctx.options.port ? Number(ctx.options.port) : undefined;
    await preview({ port });
    return true;
  },
});

registerCommand({
  id: "check",
  description: "Integrated FS Routes + Guard check",
  exitOnSuccess: true,
  async run() {
    const { check } = await import("./check");
    return check();
  },
});

registerCommand({
  id: "diagnose",
  description: "Run extended health checks (manifest freshness, prerender hygiene, export-map gaps, etc.)",
  exitOnSuccess: true,
  help: [
    "",
    "  mandu diagnose — extended health diagnostics (Issue #215)",
    "",
    "  Runs 5 structural checks in parallel:",
    "    - manifest_freshness      Bundle manifest env + bundle coverage",
    "    - prerender_pollution     Suspicious prerendered route shapes (#213)",
    "    - cloneelement_warnings   React key warnings in recent build log (#212)",
    "    - dev_artifacts_in_prod   _devtools.js / dev HTML leaking into prod",
    "    - package_export_gaps     User imports missing from @mandujs/core exports",
    "",
    "  Exit codes:",
    "    0 — healthy (no error-severity check fired)",
    "    1 — unhealthy (at least one error-severity check failed; warnings do not fail)",
    "",
    "  Flags:",
    "    --json        Emit the full DiagnoseReport as JSON (no console summary)",
    "    --quiet       Only print the summary line + final verdict",
    "",
    "  CI usage:",
    "    mandu diagnose --json > diagnose.json   # capture for artifacts",
    "    mandu diagnose                           # fail build on error severity",
    "",
  ].join("\n"),
  async run(ctx) {
    const { diagnose } = await import("./diagnose");
    return diagnose({
      json: ctx.options.json === "true",
      quiet: ctx.options.quiet === "true",
    });
  },
});

registerCommand({
  id: "guard",
  // `mandu g` was advertised as an alias in the help text but never
  // actually bound — `mandu g` printed CLI_E100 (Unknown command). The
  // alias is now real.
  aliases: ["g"],
  description: "Architecture violation check",
  subcommands: ["arch", "legacy", "spec", "manifest"],
  defaultSubcommand: "arch",
  exitOnSuccess: true,
  async run(ctx) {
    const subCommand = ctx.args[1];
    const hasSubCommand = subCommand && !subCommand.startsWith("--");

    const graphOpt = ctx.options.graph;
    // Follow-up E — `--type-aware` / `--no-type-aware` resolution.
    // `--no-X` always beats `--X`. Undefined on both sides means
    // "inherit from config" (guard-arch infers from `guard.typeAware`).
    let typeAware: boolean | undefined;
    if (ctx.options["no-type-aware"] === "true") typeAware = false;
    else if (ctx.options["type-aware"] === "true") typeAware = true;

    const guardOptions = {
      watch: ctx.options.watch === "true",
      output: ctx.options.output,
      graph: graphOpt === undefined
        ? undefined
        : graphOpt === "true"
          ? true
          : graphOpt === "json"
            ? ("json" as const)
            : graphOpt === "html"
              ? ("html" as const)
              : true,
      typeAware,
    };

    switch (subCommand) {
      case "arch": {
        const { guardArch } = await import("./guard-arch");
        return guardArch(guardOptions);
      }
      case "legacy":
      case "manifest":
      case "spec": {
        const { guardCheck } = await import("./guard-check");
        return guardCheck();
      }
      default:
        if (hasSubCommand) {
          // Unknown subcommands handled by main.ts
          return false;
        }
        // Default: architecture guard
        const { guardArch } = await import("./guard-arch");
        return guardArch(guardOptions);
    }
  },
});

registerCommand({
  id: "routes",
  description: "FS Routes management",
  subcommands: ["generate", "list", "watch"],
  defaultSubcommand: "list",
  async run(ctx) {
    const subCommand = ctx.args[1];
    const { routesGenerate, routesList, routesWatch } = await import("./routes");

    const routesOptions = {
      output: ctx.options.output,
      verbose: ctx.options.verbose === "true",
    };

    switch (subCommand) {
      case "generate":
        return routesGenerate(routesOptions);
      case "list":
        return routesList({ verbose: routesOptions.verbose });
      case "watch":
        return routesWatch(routesOptions);
      default:
        if (subCommand && !subCommand.startsWith("--")) {
          return false; // Unknown subcommand
        }
        return routesList({ verbose: routesOptions.verbose });
    }
  },
});

registerCommand({
  id: "contract",
  description: "Contract-First API development",
  subcommands: ["create", "validate", "build", "diff"],
  async run(ctx) {
    const subCommand = ctx.args[1];
    const {
      contractCreate,
      contractValidate,
      contractBuild,
      contractDiff,
    } = await import("./contract");

    switch (subCommand) {
      case "create": {
        const routeId = ctx.args[2] || ctx.options._positional;
        if (!routeId) return false;
        return contractCreate({ routeId });
      }
      case "validate":
        return contractValidate({ verbose: ctx.options.verbose === "true" });
      case "build":
        return contractBuild({ output: ctx.options.output });
      case "diff":
        return contractDiff({
          from: ctx.options.from,
          to: ctx.options.to,
          output: ctx.options.output,
          json: ctx.options.json === "true",
        });
      default:
        return false;
    }
  },
});

registerCommand({
  id: "openapi",
  description: "Generate OpenAPI spec",
  subcommands: ["generate", "serve"],
  async run(ctx) {
    const subCommand = ctx.args[1];
    const { openAPIGenerate, openAPIServe } = await import("./openapi");

    switch (subCommand) {
      case "generate":
        return openAPIGenerate({
          output: ctx.options.output,
          title: ctx.options.title,
          version: ctx.options.version,
        });
      case "serve":
        return openAPIServe();
      default:
        return false;
    }
  },
});

registerCommand({
  id: "change",
  description: "Change transaction management",
  subcommands: ["begin", "commit", "rollback", "status", "list", "prune"],
  async run(ctx) {
    const subCommand = ctx.args[1];
    const {
      changeBegin,
      changeCommit,
      changeRollback,
      changeStatus,
      changeList,
      changePrune,
    } = await import("./change");

    switch (subCommand) {
      case "begin":
        return changeBegin({ message: ctx.options.message });
      case "commit":
        return changeCommit();
      case "rollback":
        return changeRollback({ id: ctx.options.id });
      case "status":
        return changeStatus();
      case "list":
        return changeList();
      case "prune":
        return changePrune({
          keep: ctx.options.keep ? Number(ctx.options.keep) : undefined,
        });
      default:
        return false;
    }
  },
});

registerCommand({
  id: "brain",
  description:
    "Brain LLM adapter management: login (OAuth), logout, status",
  subcommands: ["login", "logout", "status"],
  help: [
    "",
    "  mandu brain — Brain LLM adapter management (Issue #235)",
    "",
    "  Subcommands:",
    "    login    OAuth login for a cloud provider (openai|anthropic)",
    "    logout   Remove stored OAuth token(s)",
    "    status   Show which adapter tier is active and any stored tokens",
    "",
    "  Tiers (auto-detected, in order):",
    "    openai     — OAuth via `npx @openai/codex login`",
    "    anthropic  — OAuth via Mandu's local loopback flow",
    "    template   — deterministic templates (no LLM, with login prompt)",
    "",
    "  Examples:",
    "    mandu brain login --provider=openai",
    "    mandu brain login --provider=anthropic",
    "    mandu brain logout --provider=all",
    "    mandu brain status",
    "",
    "  Mandu is a CONNECTOR for third-party LLMs — never an owner. Tokens",
    "  live in the OS keychain; no API keys run in Mandu's process.",
    "",
  ].join("\n"),
  async run(ctx) {
    const subCommand = ctx.args[1];

    const { brainLogin, brainLogout, brainAuthStatus } = await import(
      "./brain-auth"
    );
    type CloudProvider = "openai" | "anthropic";
    type LogoutProvider = CloudProvider | "all";
    const rawProvider = ctx.options.provider;

    switch (subCommand) {
      case "login": {
        const provider: CloudProvider | undefined =
          rawProvider === "openai" || rawProvider === "anthropic"
            ? rawProvider
            : undefined;
        return brainLogin({ provider });
      }
      case "logout": {
        const provider: LogoutProvider | undefined =
          rawProvider === "openai" ||
          rawProvider === "anthropic" ||
          rawProvider === "all"
            ? rawProvider
            : undefined;
        return brainLogout({ provider });
      }
      case "status":
      case "auth-status":
      case undefined:
        return brainAuthStatus({ verbose: ctx.options.verbose === "true" });
      default:
        return false;
    }
  },
});

registerCommand({
  id: "lint",
  description: "Run oxlint (or set it up with --setup on an existing project)",
  help: [
    "",
    "  mandu lint — run the project's lint script (usually `oxlint .`)",
    "",
    "  Flags:",
    "    --setup       Install oxlint + scaffold .oxlintrc.json + wire scripts",
    "    --dry-run     With --setup, print the plan without writing",
    "    --yes         With --setup, skip any confirmation prompts",
    "",
    "  Examples:",
    "    mandu lint",
    "    mandu lint --setup",
    "    mandu lint --setup --dry-run",
    "",
  ].join("\n"),
  async run(ctx) {
    const { lint } = await import("./lint");
    return lint({
      setup: ctx.options.setup === "true" || ctx.options.setup === "",
      dryRun: ctx.options["dry-run"] === "true" || ctx.options["dry-run"] === "",
      yes: ctx.options.yes === "true" || ctx.options.yes === "",
    });
  },
});

registerCommand({
  id: "doctor",
  description: "Analyze Guard failures + suggest patches",
  async run(ctx) {
    const { doctor } = await import("./doctor");
    return doctor({
      useLLM: ctx.options["no-llm"] !== "true",
      output: ctx.options.output,
    });
  },
});

registerCommand({
  id: "watch",
  description: "Real-time file watching",
  async run(ctx) {
    const { watch } = await import("./watch");
    return watch({
      status: ctx.options.status === "true",
      debounce: ctx.options.debounce ? Number(ctx.options.debounce) : undefined,
    });
  },
});

registerCommand({
  id: "monitor",
  description: "Observability event monitor (--type, --severity, --stats, --trace, --export)",
  async run(ctx) {
    const { monitor } = await import("./monitor");
    return monitor({
      summary: ctx.options.summary === "true",
      since: ctx.options.since,
      follow: ctx.options.follow !== "false",
      file: ctx.options.file,
      type: ctx.options.type as __ManduMonitorTypes0.EventType | undefined,
      severity: ctx.options.severity as __ManduMonitorTypes0.SeverityLevel | undefined,
      stats: ctx.options.stats === "true",
      trace: ctx.options.trace,
      source: ctx.options.source,
      noServer: ctx.options["no-server"] === "true",
      // Phase 6-3: --export jsonl|otlp
      export: ctx.options.export as __ManduMonitorTypes0.ExportFormat | undefined,
      limit: ctx.options.limit ? Number(ctx.options.limit) : undefined,
    });
  },
});

registerCommand({
  id: "lock",
  description: "Lockfile management",
  // Config loading can retain runtime handles on some platforms. `lock` is
  // a one-shot command, so terminate after the result has been flushed.
  exitOnSuccess: true,
  async run(ctx) {
    const { runLockCommand } = await import("./lock");
    return runLockCommand(ctx.args.slice(1));
  },
});

// ============================================================================
// ATE (Automation Test Engine)
// ============================================================================

registerCommand({
  id: "add",
  description: "Add features to project",
  subcommands: ["test"],
  async run(ctx) {
    const sub = ctx.args[1];
    if (sub !== "test") return false;
    const { addTest } = await import("./add");
    return addTest({ cwd: process.cwd() });
  },
});

registerCommand({
  id: "ate",
  description: "Compatibility notice for the optional ATE Labs package",
  subcommands: ["lint-exemplars"],
  async run() {
    return reportLabsFeature({
      feature: "ATE automation testing",
      packageName: "@mandujs/ate",
      alternative: "use `mandu test` for the stable Bun unit/integration test path",
    });
  },
});

registerCommand({
  id: "test:auto",
  description: "Compatibility notice for optional ATE auto E2E",
  async run() {
    return reportLabsFeature({
      feature: "ATE auto E2E",
      packageName: "@mandujs/ate",
      alternative: "use `mandu test` or run Playwright directly",
    });
  },
});

registerCommand({
  id: "test:watch",
  description: "Compatibility notice for optional ATE route watch",
  async run() {
    return reportLabsFeature({
      feature: "ATE route-aware watch",
      packageName: "@mandujs/ate",
      alternative: "use `mandu test --watch` for stable test watching",
    });
  },
});

registerCommand({
  id: "test",
  description: "Run tests (Phase 12.1+12.2+12.3). Subcommands: unit, integration, all. Flags: --e2e, --heal, --coverage, --watch, --dry-run, --filter, --bail, --update-snapshots.",
  subcommands: ["unit", "integration", "all"],
  defaultSubcommand: "all",
  help: [
    "",
    "  mandu test — integrated test runner",
    "",
    "  Subcommands:",
    "    unit           Unit tests (src/**/*.test.ts)",
    "    integration    Integration tests (tests/**/*.test.ts)",
    "    all            Alias for unit + integration (default)",
    "",
    "  Flags:",
    "    --filter <g>       Forwarded to `bun test --filter`",
    "    --watch            Chokidar watch → re-run affected",
    "    --coverage         bun coverage + LCOV merge",
    "    --bail             Stop on first failure",
    "    --update-snapshots Regenerate snapshot files (-u)",
    "    --e2e              Optional ATE Labs feature (requires @mandujs/ate)",
    "    --heal             Optional ATE Labs healing (requires @mandujs/ate)",
    "    --dry-run          Print plan, exit 0 (only with --e2e/--watch)",
    "    --base-url <url>   Playwright baseURL override",
    "    --ci               Non-interactive mode",
    "    --only-route <id>  Limit E2E to specific route ids (repeatable)",
    "    --reporter <fmt>   human|json|junit|lcov (default: human)",
    "",
    "  Examples:",
    "    mandu test unit --filter=auth",
    "    mandu test --e2e --dry-run",
    "    mandu test --watch",
    "    mandu test --coverage --bail",
    "",
  ].join("\n"),
  async run(ctx) {
    const sub = ctx.args[1];
    const target: "all" | "unit" | "integration" =
      sub === "unit" || sub === "integration" || sub === "all" ? sub : "all";

    // Phase 12.2 — optional subset of routes passed as repeated --only-route flags.
    const rawOnlyRoute = ctx.options["only-route"];
    const onlyRoutes = Array.isArray(rawOnlyRoute)
      ? rawOnlyRoute.filter((s): s is string => typeof s === "string" && s !== "true")
      : typeof rawOnlyRoute === "string" && rawOnlyRoute !== "true"
        ? [rawOnlyRoute]
        : undefined;

    const baseURL =
      typeof ctx.options["base-url"] === "string" && ctx.options["base-url"] !== "true"
        ? ctx.options["base-url"]
        : typeof ctx.options.baseURL === "string" && ctx.options.baseURL !== "true"
          ? ctx.options.baseURL
          : undefined;

    const { testCommand } = await import("./test");
    return testCommand(target, {
      filter:
        typeof ctx.options.filter === "string" && ctx.options.filter !== "true"
          ? ctx.options.filter
          : undefined,
      watch: ctx.options.watch === "true",
      coverage: ctx.options.coverage === "true",
      bail: ctx.options.bail === "true",
      updateSnapshots:
        ctx.options["update-snapshots"] === "true" ||
        ctx.options.u === "true",
      // Phase 12.2 / 12.3 additions
      e2e: ctx.options.e2e === "true",
      heal: ctx.options.heal === "true",
      dryRun: ctx.options["dry-run"] === "true" || ctx.options.dryRun === "true",
      ci: ctx.options.ci === "true",
      baseURL,
      onlyRoutes,
      reporter: resolveReporterOption(ctx.options),
    });
  },
});

registerCommand({
  id: "test:heal",
  description: "Compatibility notice for optional ATE healing",
  async run() {
    return reportLabsFeature({
      feature: "ATE healing",
      packageName: "@mandujs/ate",
      alternative: "use `mandu agent verify --changed --write` then `mandu agent repair`",
    });
  },
});

registerCommand({
  id: "generate",
  description: "Code generation (FS Routes + Resources)",
  subcommands: ["resource", "page", "api", "feature", "both"],
  exitOnSuccess: true,
  help: [
    "",
    "  mandu generate — scaffold code from declarative inputs",
    "",
    "  Subcommands:",
    "    resource <name>   Create spec/resources/<name>.resource.ts + derived artifacts",
    "    page <pattern>    Generate a route page",
    "    api <pattern>     Generate an API route handler",
    "    feature <name>    Generate a feature folder (page + api + contract)",
    "    both              Run generate-apply (FS routes + all resource artifacts)",
    "",
    "  Flags:",
    "    --fields=<spec>     Resource fields, e.g. 'name:string!,age:number?'",
    "    --methods=<list>    HTTP methods, e.g. 'GET,POST,DELETE'",
    "    --timestamps        Add createdAt/updatedAt fields",
    "    --force             Overwrite existing files",
    "    --dry-run           Preview scaffold output without writing files",
    "    --diff              With --dry-run, print a unified new-file diff",
    "    --ai=<prompt>       Use the AI generator (any subcommand)",
    "    --ci                Non-interactive mode",
    "",
    "  Examples:",
    "    mandu generate resource party --fields='name:string!,color:string!' --ci",
    "    mandu generate page /blog/[slug]",
    "    mandu generate page /dashboard --dry-run --diff",
    "    mandu generate both",
    "",
  ].join("\n"),
  async run(ctx) {
    const subCommand = ctx.args[1];

    if (ctx.options.ai) {
      const { generateAi } = await import("./generate-ai");
      const recognizedKind = ["page", "api", "feature", "both"].includes(subCommand) ? subCommand : undefined;
      return generateAi({
        kind: recognizedKind,
        name: recognizedKind ? ctx.args[2] : ctx.args[1] || ctx.options._positional,
        prompt: ctx.options.ai,
        methods: ctx.options.methods,
        dryRun: ctx.options["dry-run"] === "true",
        withContract: ctx.options["with-contract"] === "true" ? true : undefined,
        withIsland: ctx.options["with-island"] === "true" ? true : undefined,
      });
    }

    if (subCommand === "resource") {
      // generate resource subcommand
      const { generateResource } = await import("./generate-resource");
      return generateResource({
        name: ctx.args[2] || ctx.options._positional,
        fields: ctx.options.fields,
        timestamps: ctx.options.timestamps === "true",
        methods: ctx.options.methods,
        force: ctx.options.force === "true",
      });
    }

    if (subCommand === "page" || subCommand === "api" || subCommand === "feature") {
      const { generateScaffold } = await import("./generate-scaffold");
      return generateScaffold({
        kind: subCommand,
        name: ctx.args[2] || ctx.options._positional,
        methods: ctx.options.methods,
        force: ctx.options.force === "true",
        dryRun: ctx.options["dry-run"] === "true" || ctx.options["dry-run"] === "",
        diff: ctx.options.diff === "true" || ctx.options.diff === "",
      });
    }

    if (subCommand === "both") {
      const { generateApply } = await import("./generate-apply");
      return generateApply({
        force: ctx.options.force === "true",
      });
    }

    // Default: generate all (FS Routes + Resources)
    if (subCommand && !subCommand.startsWith("--")) {
      console.error(`Unknown generate subcommand: ${subCommand}`);
      return false; // Unknown subcommand
    }

    const { generateApply } = await import("./generate-apply");
    return generateApply({
      force: ctx.options.force === "true",
    });
  },
});

registerCommand({
  id: "cache",
  description: "Cache management (clear, stats)",
  subcommands: ["clear", "stats"],
  exitOnSuccess: true,
  async run(ctx) {
    const action = ctx.args[1];
    if (!action || action.startsWith("--")) return false;
    const { cache } = await import("./cache");
    return cache(action, {
      tag: ctx.options.tag,
      all: ctx.options.all === "true",
      json: ctx.options.json === "true",
      path: ctx.args[2] || (action === "clear" ? ctx.options._positional : undefined),
    });
  },
});

registerCommand({
  id: "middleware",
  description: "Generate middleware scaffolds",
  subcommands: ["init"],
  exitOnSuccess: true,
  async run(ctx) {
    const subCommand = ctx.args[1];
    if (subCommand !== "init") return false;
    const { middlewareInit } = await import("./middleware");
    return middlewareInit({ preset: ctx.options.preset });
  },
});

registerCommand({
  id: "session",
  description: "Generate session storage scaffolding",
  subcommands: ["init"],
  exitOnSuccess: true,
  async run(ctx) {
    const subCommand = ctx.args[1];
    if (subCommand !== "init") return false;
    const { sessionInit } = await import("./session");
    return sessionInit();
  },
});

registerCommand({
  id: "auth",
  description: "Generate auth scaffolding and example routes",
  subcommands: ["init"],
  exitOnSuccess: true,
  async run(ctx) {
    const subCommand = ctx.args[1];
    if (subCommand !== "init") return false;
    const { authInit } = await import("./auth");
    return authInit({ strategy: ctx.options.strategy });
  },
});

registerCommand({
  id: "ws",
  description: "Generate a WebSocket route scaffold",
  exitOnSuccess: true,
  async run(ctx) {
    const { ws } = await import("./ws");
    return ws({
      name: ctx.args[1] || ctx.options._positional,
    });
  },
});

registerCommand({
  id: "collection",
  description: "Create content collection scaffolding",
  subcommands: ["create"],
  exitOnSuccess: true,
  async run(ctx) {
    const subCommand = ctx.args[1];
    if (subCommand !== "create") return false;
    const { collectionCreate } = await import("./collection");
    return collectionCreate({
      name: ctx.args[2] || ctx.options._positional,
      schema: ctx.options.schema,
    });
  },
});

registerCommand({
  id: "fix",
  description: "Run Guard healing, diagnostics, and optional build verification",
  exitOnSuccess: true,
  async run(ctx) {
    const { fix } = await import("./fix");
    return fix({
      apply: ctx.options.apply === "true" || ctx.options["auto-fix"] === "true",
      build: ctx.options["no-build"] === "true" ? false : undefined,
      file: ctx.options.file,
      json: ctx.options.json === "true",
      preset: ctx.options.preset,
      verify: ctx.options.verify === "true",
    });
  },
});

registerCommand({
  id: "review",
  description: "Review changed files with guard and contract diagnostics",
  exitOnSuccess: true,
  async run(ctx) {
    const { review } = await import("./review");
    return review({
      base: ctx.options.base,
      json: ctx.options.json === "true",
      staged: ctx.options.staged === "true" || ctx.options.staged === "",
      useLLM: ctx.options["no-llm"] !== "true",
    });
  },
});

registerCommand({
  id: "ask",
  description: "Ask the local Mandu assistant for codebase-aware guidance",
  exitOnSuccess: true,
  async run(ctx) {
    const { ask } = await import("./ask");
    return ask({
      args: ctx.args,
      json: ctx.options.json === "true",
      useLLM: ctx.options["no-llm"] !== "true",
    });
  },
});

registerCommand({
  id: "explain",
  description: "Explain a Guard rule or violation pattern",
  exitOnSuccess: true,
  async run(ctx) {
    const { explain } = await import("./explain");
    return explain({
      codeOrType: ctx.args[1] || ctx.options._positional,
      fromLayer: ctx.options.from || ctx.options.fromLayer,
      json: ctx.options.json === "true",
      preset: ctx.options.preset,
      toLayer: ctx.options.to || ctx.options.toLayer,
    });
  },
});

registerCommand({
  id: "scaffold",
  description: "Generate boilerplate (middleware, ws, session, auth, collection)",
  subcommands: ["middleware", "ws", "session", "auth", "collection"],
  exitOnSuccess: true,
  async run(ctx) {
    const type = ctx.args[1];
    if (!type || type.startsWith("--")) return false;
    const name = ctx.args[2] || ctx.options._positional || "";
    const { scaffold } = await import("./scaffold");
    return scaffold(type, name, { preset: ctx.options.preset, schema: ctx.options.schema });
  },
});

registerCommand({
  id: "new",
  description: "Alias for scaffold",
  subcommands: ["middleware", "ws", "session", "auth", "collection"],
  exitOnSuccess: true,
  async run(ctx) {
    const type = ctx.args[1];
    if (!type || type.startsWith("--")) return false;
    const name = ctx.args[2] || ctx.options._positional || "";
    const { scaffold } = await import("./scaffold");
    return scaffold(type, name, { preset: ctx.options.preset, schema: ctx.options.schema });
  },
});

registerCommand({
  id: "mcp",
  description: "Register standalone Mandu MCP with IDEs",
  exitOnSuccess: true,
  help: [
    "",
    "  mandu mcp — standalone MCP integration",
    "",
    "  Usage:",
    "    bunx mandu-mcp               Start the standalone MCP server",
    "    mandu mcp register [...]     Register Mandu with an IDE (Phase 13.2)",
    "",
    "  mcp register flags:",
    "    --ide=<name>       claude|cursor|continue|aider|all (default: all)",
    "    --remove           Remove Mandu entry from IDE config",
    "    --token=<strategy> generate | prompt | env:VAR | (default: ${env:MANDU_MCP_TOKEN})",
    "    --dry-run          Preview writes without touching disk",
    "",
    "  Examples:",
    "    bunx mandu-mcp",
    "    mandu mcp register --ide=claude",
    "    mandu mcp register --ide=all --dry-run",
    "",
  ].join("\n"),
  async run(ctx) {
    // Sub-dispatch: `mandu mcp register` → Phase 13.2 IDE auto-config.
    const sub = ctx.args[1];
    if (sub === "register") {
      const { mcpRegister } = await import("./mcp-register");
      const ideRaw = ctx.options.ide;
      const ide =
        ideRaw === "claude" ||
        ideRaw === "cursor" ||
        ideRaw === "continue" ||
        ideRaw === "aider" ||
        ideRaw === "all"
          ? ideRaw
          : undefined;
      const code = await mcpRegister({
        ide,
        remove: ctx.options.remove === "true",
        token: ctx.options.token && ctx.options.token !== "true" ? ctx.options.token : undefined,
        dryRun: ctx.options["dry-run"] === "true" || ctx.options.dryRun === "true",
      });
      // Non-zero exit code → signal failure to main.ts.
      return code === 0;
    }

    return reportLabsFeature({
      feature: "MCP server and tool invocation",
      packageName: "@mandujs/mcp",
      alternative: "run `bunx mandu-mcp`; keep `mandu mcp register` for IDE configuration",
    });
  },
});

registerCommand({
  id: "deploy",
  description: "Retired provider deployment compatibility command",
  exitOnSuccess: true,
  help: [
    "",
    "  mandu deploy — retired in the stable Mandu product",
    "",
    "  Mandu owns a reproducible Bun artifact, not provider credentials or",
    "  remote deployment execution.",
    "",
    "  Replacement:",
    "    1. mandu build",
    "    2. validate with mandu start",
    "    3. deploy the artifact with your provider CLI or container platform",
    "",
    "  See docs/deploy/artifact-contract.md.",
    "",
  ].join("\n"),
  async run() {
    console.error("`mandu deploy` has been retired from the stable product.");
    console.error("Run `mandu build`, validate with `mandu start`, then use your provider CLI.");
    console.error("Artifact contract: docs/deploy/artifact-contract.md");
    return false;
  },
});

registerCommand({
  id: "deploy:plan",
  description: "Retired provider deployment planning compatibility command",
  exitOnSuccess: true,
  help: [
    "",
    "  mandu deploy:plan — retired in the stable Mandu product",
    "",
    "  Deployment intent and provider planning now belong to provider tooling.",
    "  Mandu only guarantees the artifact documented at:",
    "  docs/deploy/artifact-contract.md",
    "",
  ].join("\n"),
  async run() {
    console.error("`mandu deploy:plan` has been retired from the stable product.");
    console.error("Use provider-native configuration after `mandu build`.");
    return false;
  },
});

registerCommand({
  id: "upgrade",
  description:
    "Update @mandujs packages, or self-update the Mandu binary (Phase 13.2)",
  exitOnSuccess: true,
  help: [
    "",
    "  mandu upgrade — update Mandu packages or self-update the binary",
    "",
    "  Flags:",
    "    --check             Report latest version without modifying anything",
    "    --channel=<ch>      Release channel: stable (default) | canary",
    "    --dry-run           Verify + download but skip the swap step",
    "    --rollback          Roll back to the previously-replaced binary",
    "",
    "  Modes (auto-detected):",
    "    Binary mode    — downloads the OS/arch binary, verifies SHA-256, swaps atomically",
    "    Package mode   — falls through to `bun update @mandujs/*`",
    "",
    "  Exit codes:",
    "    0  upgrade applied (or --check run)",
    "    1  network / integrity / I/O failure",
    "    2  usage error",
    "    3  already up to date",
    "",
  ].join("\n"),
  async run(ctx) {
    const { upgrade } = await import("./upgrade");
    const channelRaw = ctx.options.channel;
    const channel: "stable" | "canary" | undefined =
      channelRaw === "stable" || channelRaw === "canary" ? channelRaw : undefined;
    return upgrade({
      check: ctx.options.check === "true" || ctx.options.check === "",
      dryRun: ctx.options["dry-run"] === "true" || ctx.options.dryRun === "true",
      rollback: ctx.options.rollback === "true",
      channel,
    });
  },
});

registerCommand({
  id: "db",
  description: "Schema migrations + data seeds: plan, apply, status, reset, seed",
  subcommands: ["plan", "apply", "status", "reset", "seed"],
  async help(_ctx) {
    const { DB_HELP } = await import("./db");
    process.stdout.write(DB_HELP);
  },
  async run(ctx) {
    const { dbDispatch } = await import("./db");
    return dbDispatch(ctx);
  },
});

registerCommand({
  id: "desktop",
  description: "Scaffold and build desktop targets (Phase 9c prototype)",
  subcommands: ["scaffold", "dev", "build"],
  defaultSubcommand: "scaffold",
  exitOnSuccess: true,
  async run(ctx) {
    const sub = ctx.args[1];
    const hasSub = !!(sub && !sub.startsWith("--"));
    const mode: "scaffold" | "dev" | "build" =
      hasSub && (sub === "dev" || sub === "build" || sub === "scaffold")
        ? sub
        : "scaffold";
    const { desktop } = await import("./desktop");
    return desktop({
      mode,
      entry: ctx.options.entry,
      force: ctx.options.force === "true",
    });
  },
});

registerCommand({
  id: "completion",
  description: "Output shell completion script (bash, zsh, fish)",
  exitOnSuccess: true,
  async run(ctx) {
    const shell = ctx.args[1] || ctx.options._positional;
    if (!shell || shell.startsWith("--")) {
      console.error("Usage: mandu completion <bash|zsh|fish>");
      return false;
    }
    const { completion } = await import("./completion");
    return completion(shell);
  },
});

registerCommand({
  id: "skills:generate",
  description: "Compatibility alias for `mandu agent sync --target=claude`",
  exitOnSuccess: true,
  async run(ctx) {
    const { agent } = await import("./agent");
    return agent({
      action: "sync",
      target: "claude",
      dryRun: ctx.options["dry-run"] === "true",
      json: ctx.options.json === "true",
    });
  },
});

registerCommand({
  id: "skills:list",
  description: "Preview canonical Claude agent artifacts",
  exitOnSuccess: true,
  async run(ctx) {
    const { agent } = await import("./agent");
    return agent({
      action: "sync",
      target: "claude",
      dryRun: true,
      json: ctx.options.json === "true",
    });
  },
});

// ============================================================================
// Phase 14.2 — `mandu ai` AI playground (chat + eval)
// ============================================================================

const AI_LABS_HELP = [
  "",
  "  mandu ai — optional AI playground (Labs)",
  "",
  "  The provider chat/eval playground is no longer part of the stable CLI runtime.",
  "  Install @mandujs/ate explicitly for Labs experiments.",
  "  Stable workflow: mandu agent plan \"<intent>\"",
  "",
].join("\n");

registerCommand({
  id: "ai",
  description: "Compatibility notice for the optional AI playground",
  subcommands: ["chat", "eval"],
  async help(_ctx) {
    process.stdout.write(AI_LABS_HELP);
  },
  async run(ctx) {
    if (ctx.options.help === "true") {
      process.stdout.write(AI_LABS_HELP);
      return true;
    }
    return reportLabsFeature({
      feature: "Terminal AI playground",
      packageName: "@mandujs/ate",
      alternative: "use `mandu agent plan \"<intent>\"` for the supported product workflow",
    });
  },
});

// Phase 18.σ — resolve the --reporter=<fmt> flag to a typed union.
// Accepts only human/json/junit/lcov; anything else falls back to human.
function resolveReporterOption(
  options: Record<string, unknown>,
): "human" | "json" | "junit" | "lcov" {
  const raw = options.reporter;
  if (typeof raw === "string") {
    if (raw === "json" || raw === "junit" || raw === "lcov" || raw === "human") {
      return raw;
    }
  }
  return "human";
}

