/**
 * DNA-016: Pre-Action Hooks
 *
 * Common tasks before command execution
 * - Set process title
 * - Conditional banner display
 * - Verbose mode configuration
 * - Config loading
 */

import { shouldShowBanner, renderMiniBanner } from "../terminal/banner.js";
import { loadManduConfig, type ManduConfig } from "@mandujs/core";

/**
 * Pre-Action context
 */
export interface PreActionContext {
  /** Current command */
  command: string;
  /** Subcommand */
  subcommand?: string;
  /** Command options */
  options: Record<string, string>;
  /** Loaded config */
  config?: ManduConfig;
  /** Whether verbose mode is enabled */
  verbose: boolean;
  /** Working directory */
  cwd: string;
}

/**
 * Pre-Action hook type
 */
export type PreActionHook = (ctx: PreActionContext) => void | Promise<void>;

/**
 * Pre-Action hook registry
 */
class PreActionRegistry {
  private hooks: PreActionHook[] = [];

  /**
   * Register hook
   */
  register(hook: PreActionHook): void {
    this.hooks.push(hook);
  }

  /**
   * Unregister hook
   */
  unregister(hook: PreActionHook): boolean {
    const index = this.hooks.indexOf(hook);
    if (index >= 0) {
      this.hooks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Run all hooks
   */
  async runAll(ctx: PreActionContext): Promise<void> {
    for (const hook of this.hooks) {
      await hook(ctx);
    }
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks = [];
  }

  /**
   * Number of registered hooks
   */
  get size(): number {
    return this.hooks.length;
  }
}

/**
 * Global Pre-Action hook registry
 */
export const preActionRegistry = new PreActionRegistry();

/**
 * Commands that don't need config loading
 */
const SKIP_CONFIG_COMMANDS = new Set([
  "init",
  "help",
  "version",
  "completion",
]);

/**
 * Commands that don't need banner display
 */
const SKIP_BANNER_COMMANDS = new Set([
  "completion",
  "version",
]);

/**
 * Verbose global state
 */
let globalVerbose = false;

/**
 * Set verbose mode
 */
export function setVerbose(value: boolean): void {
  globalVerbose = value;
}

/**
 * Check verbose mode
 */
export function isVerbose(): boolean {
  return globalVerbose;
}

/**
 * Set process title
 */
export function setProcessTitle(command: string, subcommand?: string): void {
  const title = subcommand
    ? `mandu ${command} ${subcommand}`
    : `mandu ${command}`;

  if (typeof process.title !== "undefined") {
    process.title = title;
  }
}

/**
 * Run default Pre-Action
 *
 * @example
 * ```ts
 * const ctx = await runPreAction({
 *   command: "dev",
 *   options: { port: "3000" },
 * });
 *
 * // Use loaded config from ctx.config
 * // Check verbose mode via ctx.verbose
 * ```
 */
export async function runPreAction(params: {
  command: string;
  subcommand?: string;
  options: Record<string, string>;
  cwd?: string;
  version?: string;
}): Promise<PreActionContext> {
  const {
    command,
    subcommand,
    options,
    cwd = process.cwd(),
    version,
  } = params;

  // 1. Check verbose mode
  const verbose = options.verbose === "true" || process.env.MANDU_VERBOSE === "true";
  setVerbose(verbose);

  // 2. Set process title
  setProcessTitle(command, subcommand);

  // 3. Conditional banner display
  const showBanner =
    !SKIP_BANNER_COMMANDS.has(command) &&
    !isTruthyEnv("MANDU_HIDE_BANNER") &&
    shouldShowBanner(process.argv);

  if (showBanner && version) {
    console.log(renderMiniBanner(version));
    console.log();
  }

  // 4. Load config (only for commands that need it)
  let config: ManduConfig | undefined;
  if (!SKIP_CONFIG_COMMANDS.has(command)) {
    try {
      config = await loadManduConfig(cwd);
    } catch {
      // Ignore config load failure (use option defaults only)
      if (verbose) {
        console.warn("[mandu] Config load failed, using defaults");
      }
    }
  }

  // Create Pre-Action context
  const ctx: PreActionContext = {
    command,
    subcommand,
    options,
    config,
    verbose,
    cwd,
  };

  // 5. Run registered hooks
  await preActionRegistry.runAll(ctx);

  return ctx;
}

/**
 * Check if environment variable is truthy
 */
function isTruthyEnv(key: string): boolean {
  const value = process.env[key];
  if (!value) return false;
  return !["0", "false", "no", ""].includes(value.toLowerCase());
}

/**
 * Pre-Action hook registration helper
 *
 * @example
 * ```ts
 * registerPreActionHook(async (ctx) => {
 *   if (ctx.command === "dev") {
 *     console.log("Starting development mode...");
 *   }
 * });
 * ```
 */
export function registerPreActionHook(hook: PreActionHook): () => void {
  preActionRegistry.register(hook);
  return () => preActionRegistry.unregister(hook);
}

/**
 * Register default hooks
 */
export function registerDefaultHooks(): void {
  // Example: show extra info in dev mode
  registerPreActionHook((ctx) => {
    if (ctx.verbose && ctx.config) {
      console.log(`[mandu] Config loaded from ${ctx.cwd}`);
      if (ctx.config.server?.port) {
        console.log(`[mandu] Server port: ${ctx.config.server.port}`);
      }
    }
  });
}
