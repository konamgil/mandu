/**
 * DNA-010: Command Registry Pattern
 *
 * Declarative command registration system
 * - Each command defined independently
 * - Lazy loading for startup time optimization
 * - Automatic subcommand routing
 */

import type { CLI_ERROR_CODES } from "../errors";
import type { CSSFramework, UILibrary } from "./init";

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
 * Register a command
 */
export function registerCommand(registration: CommandRegistration): void {
  commandRegistry.set(registration.id, registration);
}

/**
 * Look up a command
 */
export function getCommand(id: string): CommandRegistration | undefined {
  return commandRegistry.get(id);
}

/**
 * List all command IDs
 */
export function getAllCommands(): string[] {
  return Array.from(commandRegistry.keys());
}

/**
 * List all registered commands with metadata in registration order.
 */
export function getAllCommandRegistrations(): CommandRegistration[] {
  return Array.from(commandRegistry.values());
}

// ============================================================================
// Command registration (lazy loading)
// ============================================================================

registerCommand({
  id: "init",
  description: "Create a new project (Tailwind + shadcn/ui included by default)",
  async run(ctx) {
    const { init } = await import("./init");
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
  description: "Build client bundles (hydration). Use --target=<edge> for edge deployments.",
  exitOnSuccess: true,
  help: [
    "",
    "  mandu build — build client bundles",
    "",
    "  Flags:",
    "    --watch                 Rebuild on file changes",
    "    --target=<name>         Deployment target (workers|deno|vercel-edge|netlify-edge)",
    "    --worker-name=<slug>    Cloudflare Workers project name (target=workers)",
    "    --project-name=<slug>   Project name (target=deno|vercel-edge|netlify-edge)",
    "",
    "  Outputs:",
    "    .mandu/client/                              Hydration bundles (default target)",
    "    .mandu/static/                              Prerendered HTML shells",
    "    .mandu/workers/worker.js + wrangler.toml    (target=workers)",
    "    .mandu/deno/server.ts + deno.json           (target=deno)",
    "    api/_mandu.ts + vercel.json                 (target=vercel-edge)",
    "    netlify/edge-functions/ssr.ts + netlify.toml (target=netlify-edge)",
    "",
    "  Examples:",
    "    mandu build",
    "    mandu build --watch",
    "    mandu build --target=workers --worker-name=my-app",
    "    mandu build --target=deno --project-name=my-app",
    "    mandu build --target=vercel-edge",
    "    mandu build --target=netlify-edge",
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
    return build({
      watch: ctx.options.watch === "true",
      target,
      workerName: ctx.options["worker-name"] && ctx.options["worker-name"] !== "true"
        ? ctx.options["worker-name"]
        : undefined,
      projectName: ctx.options["project-name"] && ctx.options["project-name"] !== "true"
        ? ctx.options["project-name"]
        : undefined,
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
  id: "info",
  description: "Print project and environment information",
  exitOnSuccess: true,
  async run() {
    const { info } = await import("./info");
    return info();
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
  async run() {
    const { check } = await import("./check");
    return check();
  },
});

registerCommand({
  id: "guard",
  description: "Architecture violation check",
  subcommands: ["arch", "legacy", "spec", "manifest"],
  defaultSubcommand: "arch",
  async run(ctx) {
    const subCommand = ctx.args[1];
    const hasSubCommand = subCommand && !subCommand.startsWith("--");

    const guardOptions = {
      watch: ctx.options.watch === "true",
      output: ctx.options.output,
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
  description: "Brain (sLLM) management",
  subcommands: ["setup", "status"],
  async run(ctx) {
    const subCommand = ctx.args[1];
    const { brainSetup, brainStatus } = await import("./brain");

    switch (subCommand) {
      case "setup":
        return brainSetup({
          model: ctx.options.model,
          url: ctx.options.url,
          skipCheck: ctx.options["skip-check"] === "true",
        });
      case "status":
        return brainStatus({ verbose: ctx.options.verbose === "true" });
      default:
        return false;
    }
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
      follow: ctx.options.follow === "false" ? false : true,
      file: ctx.options.file,
      type: ctx.options.type as import("./monitor").EventType | undefined,
      severity: ctx.options.severity as import("./monitor").SeverityLevel | undefined,
      stats: ctx.options.stats === "true",
      trace: ctx.options.trace,
      source: ctx.options.source,
      noServer: ctx.options["no-server"] === "true",
      // Phase 6-3: --export jsonl|otlp
      export: ctx.options.export as import("./monitor").ExportFormat | undefined,
      limit: ctx.options.limit ? Number(ctx.options.limit) : undefined,
    });
  },
});

registerCommand({
  id: "lock",
  description: "Lockfile management",
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
  id: "test:auto",
  description: "ATE auto E2E generation/execution",
  async run(ctx) {
    const { testAuto } = await import("./test-auto");
    return testAuto({
      ci: ctx.options.ci === "true",
      impact: ctx.options.impact === "true",
      baseURL: ctx.options["base-url"] || ctx.options.baseURL || ctx.options.baseUrl,
    });
  },
});

registerCommand({
  id: "test:watch",
  description: "Watch mode: re-run ATE tests for affected routes on file changes",
  async run(ctx) {
    const { createAteWatcher } = await import("@mandujs/ate");
    type OracleLevel = "L0" | "L1" | "L2" | "L3";
    const oracleOpt = ctx.options.oracle as string | undefined;
    const oracleLevel: OracleLevel =
      oracleOpt === "L0" || oracleOpt === "L1" || oracleOpt === "L2" || oracleOpt === "L3"
        ? (oracleOpt as OracleLevel)
        : "L1";
    const baseURL =
      (ctx.options["base-url"] as string | undefined) ??
      (ctx.options.baseURL as string | undefined) ??
      (ctx.options.baseUrl as string | undefined) ??
      "http://localhost:3333";
    const debounceMs = ctx.options.debounce ? Number(ctx.options.debounce) : undefined;

    const watcher = createAteWatcher({
      repoRoot: process.cwd(),
      baseURL,
      oracleLevel,
      debounceMs,
    });

    const shutdown = () => {
      watcher.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await watcher.start();
    // Keep the process alive — fs.watch handles do not hold the loop on all
    // platforms, so we block on a never-resolving promise until SIGINT.
    await new Promise<void>(() => {
      /* intentionally unresolved; shutdown via SIGINT */
    });
    return true;
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
    "    --e2e              Run ATE E2E pipeline after unit/integration",
    "    --heal             Run ATE heal loop after E2E failure",
    "    --dry-run          Print plan, exit 0 (only with --e2e/--watch)",
    "    --base-url <url>   Playwright baseURL override",
    "    --ci               Non-interactive mode",
    "    --only-route <id>  Limit E2E to specific route ids (repeatable)",
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
    });
  },
});

registerCommand({
  id: "test:heal",
  description: "Generate ATE healing suggestions (no auto-commit)",
  async run() {
    const { testHeal } = await import("./test-heal");
    return testHeal();
  },
});

registerCommand({
  id: "generate",
  description: "Code generation (FS Routes + Resources)",
  subcommands: ["resource", "page", "api", "feature", "both"],
  exitOnSuccess: true,
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

    // Default: generate all (FS Routes + Resources)
    if (subCommand && !subCommand.startsWith("--")) {
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
  description: "Run MCP tools from terminal, or register Mandu with IDEs (mcp register)",
  subcommands: ["register"],
  exitOnSuccess: true,
  help: [
    "",
    "  mandu mcp — MCP tool bridge + IDE integration",
    "",
    "  Usage:",
    "    mandu mcp                    List all available MCP tools",
    "    mandu mcp <tool> [args]      Execute a specific tool",
    "    mandu mcp register [...]     Register Mandu with an IDE (Phase 13.2)",
    "",
    "  mcp register flags:",
    "    --ide=<name>       claude|cursor|continue|aider|all (default: all)",
    "    --remove           Remove Mandu entry from IDE config",
    "    --token=<strategy> generate | prompt | env:VAR | (default: ${env:MANDU_MCP_TOKEN})",
    "    --dry-run          Preview writes without touching disk",
    "",
    "  Flags (tool invocation):",
    "    --list             Print all tools then exit (same as no <tool>)",
    "    --json             Machine-readable output",
    "",
    "  Examples:",
    "    mandu mcp --list",
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

    const { mcp } = await import("./mcp");
    const tool = ctx.options._positional;
    const json = ctx.options.json === "true";
    const list = !tool || ctx.options.list === "true";
    return mcp({ tool, args: ctx.options, json, list });
  },
});

registerCommand({
  id: "deploy",
  description:
    "Prepare deployment artifacts (docker, docker-compose, fly, vercel, railway, netlify, cf-pages)",
  exitOnSuccess: true,
  help: [
    "",
    "  mandu deploy — prepare deployment artifacts",
    "",
    "  Flags:",
    "    --target=<name>    docker|docker-compose|fly|vercel|railway|netlify|cf-pages (required)",
    "    --env=<name>       Environment name (default: production)",
    "    --project=<name>   Project name override",
    "    --dry-run          Preview artifacts without touching filesystem",
    "    --execute          Invoke the provider CLI after artifact prep",
    "    --verbose          Extra diagnostics (secrets still masked)",
    "    --set-secret KEY=VAL  Stash a secret into OS keychain then exit (repeatable)",
    "",
    "  Examples:",
    "    mandu deploy --target=vercel --dry-run",
    "    mandu deploy --target=fly --execute",
    "    mandu deploy --set-secret VERCEL_TOKEN=xxx --set-secret DATABASE_URL=yyy",
    "",
    "  See docs/deploy/README.md for adapter capability matrix.",
    "",
  ].join("\n"),
  async run(ctx) {
    const { deploy } = await import("./deploy");
    const setSecretRaw = ctx.options["set-secret"];
    const setSecret = Array.isArray(setSecretRaw)
      ? setSecretRaw
      : typeof setSecretRaw === "string" && setSecretRaw !== "true"
        ? [setSecretRaw]
        : undefined;
    return deploy({
      target: ctx.options.target,
      env: ctx.options.env,
      project: ctx.options.project,
      dryRun: ctx.options["dry-run"] === "true",
      execute: ctx.options.execute === "true" || ctx.options.execute === "",
      verbose: ctx.options.verbose === "true",
      setSecret,
    });
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
  description: "Generate per-project Claude Code skills (glossary, conventions, workflow)",
  exitOnSuccess: true,
  async run(ctx) {
    const { skillsGenerate } = await import("./skills");
    const rawKinds = ctx.options.kinds;
    const kinds = typeof rawKinds === "string" && rawKinds !== "true"
      ? (rawKinds.split(",").map((k) => k.trim()).filter(Boolean) as Array<"glossary" | "conventions" | "workflow">)
      : undefined;
    return skillsGenerate({
      regenerate: ctx.options.regenerate === "true",
      dryRun: ctx.options["dry-run"] === "true",
      yes: ctx.options.yes === "true",
      outDir: typeof ctx.options["out-dir"] === "string" && ctx.options["out-dir"] !== "true" ? ctx.options["out-dir"] : undefined,
      kinds,
    });
  },
});

registerCommand({
  id: "skills:list",
  description: "List installed per-project Claude Code skills",
  exitOnSuccess: true,
  async run(ctx) {
    const { skillsList } = await import("./skills");
    return skillsList({
      outDir: typeof ctx.options["out-dir"] === "string" && ctx.options["out-dir"] !== "true" ? ctx.options["out-dir"] : undefined,
      json: ctx.options.json === "true",
    });
  },
});

// ============================================================================
// Phase 14.2 — `mandu ai` AI playground (chat + eval)
// ============================================================================

registerCommand({
  id: "ai",
  description: "Terminal AI playground: interactive chat or non-interactive eval",
  subcommands: ["chat", "eval"],
  async help(_ctx) {
    const { AI_HELP } = await import("./ai");
    process.stdout.write(AI_HELP);
  },
  async run(ctx) {
    const { aiDispatch } = await import("./ai");
    return aiDispatch(ctx);
  },
});
