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
    });
  },
});

registerCommand({
  id: "dev",
  description: "Start dev server (FS Routes + Guard enabled by default)",
  async run() {
    const { dev } = await import("./dev");
    await dev();
    return true;
  },
});

registerCommand({
  id: "build",
  description: "Build client bundles (hydration)",
  async run(ctx) {
    const { build } = await import("./build");
    return build({ watch: ctx.options.watch === "true" });
  },
});

registerCommand({
  id: "start",
  description: "Start production server (after build)",
  async run() {
    const { start } = await import("./start");
    await start();
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
  subcommands: ["arch", "legacy", "spec"],
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


// Legacy commands (DEPRECATED)
registerCommand({
  id: "spec-upsert",
  description: "[DEPRECATED] Spec file validation and lock update -> use routes generate",
  async run(ctx) {
    const { specUpsert } = await import("./spec-upsert");
    return specUpsert({ file: ctx.options.file });
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
