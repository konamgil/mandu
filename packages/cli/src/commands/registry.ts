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
  description: "Build client bundles (hydration)",
  exitOnSuccess: true,
  async run(ctx) {
    const { build } = await import("./build");
    return build({ watch: ctx.options.watch === "true" });
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
  description: "MCP Activity Monitor",
  async run(ctx) {
    const { monitor } = await import("./monitor");
    return monitor({
      summary: ctx.options.summary === "true",
      since: ctx.options.since,
      follow: ctx.options.follow === "false" ? false : true,
      file: ctx.options.file,
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
  subcommands: ["resource"],
  async run(ctx) {
    const subCommand = ctx.args[1];

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
  description: "Analyze or apply architecture auto-fixes",
  exitOnSuccess: true,
  async run(ctx) {
    const { fix } = await import("./fix");
    return fix({
      apply: ctx.options.apply === "true" || ctx.options["auto-fix"] === "true",
      file: ctx.options.file,
      json: ctx.options.json === "true",
      preset: ctx.options.preset,
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
  description: "Run MCP tools from terminal",
  exitOnSuccess: true,
  async run(ctx) {
    const { mcp } = await import("./mcp");
    const tool = ctx.options._positional;
    const json = ctx.options.json === "true";
    const list = !tool || ctx.options.list === "true";
    return mcp({ tool, args: ctx.options, json, list });
  },
});

registerCommand({
  id: "deploy",
  description: "Validate, build, and generate deployment artifacts",
  exitOnSuccess: true,
  async run(ctx) {
    const { deploy } = await import("./deploy");
    return deploy({ target: ctx.options.target });
  },
});

registerCommand({
  id: "upgrade",
  description: "Check for or install latest @mandujs package versions",
  exitOnSuccess: true,
  async run(ctx) {
    const { upgrade } = await import("./upgrade");
    return upgrade({ check: ctx.options.check === "true" || ctx.options.check === "" });
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
