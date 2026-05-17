#!/usr/bin/env bun

/**
 * Mandu CLI - Agent-Native Fullstack Framework
 *
 * DNA-010: Command Registry Pattern
 * - Declarative command registration
 * - Lazy loading for optimized startup time
 */

import {
  getCommand,
  getAllCommandRegistrations,
  type CommandContext,
  type CommandRegistration,
} from "./commands/registry";
import { CLI_ERROR_CODES, handleCLIError, printCLIError } from "./errors";
import { shouldShowBanner, renderHeroBanner, renderHelp, MANDU_HELP } from "./terminal";

/**
 * Render a minimal help block for a command that didn't define its own
 * `help` field. Issue #269 — better than falling through to the global
 * help, which forced the user to scan a 30-item list to find the command
 * they just asked about.
 */
function renderFallbackHelp(registration: CommandRegistration): string {
  const lines: string[] = [
    "",
    `  mandu ${registration.id} — ${registration.description}`,
    "",
  ];
  if (registration.aliases && registration.aliases.length > 0) {
    lines.push(`  Aliases: ${registration.aliases.join(", ")}`, "");
  }
  if (registration.subcommands && registration.subcommands.length > 0) {
    lines.push(
      "  Subcommands:",
      ...registration.subcommands.map((s) => `    ${s}`),
      "",
    );
    if (registration.defaultSubcommand) {
      lines.push(`  Default subcommand: ${registration.defaultSubcommand}`, "");
    }
    lines.push(
      `  Tip: run \`mandu ${registration.id} <subcommand> --help\` for subcommand details.`,
      "",
    );
  }
  return lines.join("\n");
}

// Phase 9b B — static JSON import so the CLI version survives `bun --compile`.
// The previous `require("../package.json")` form used CommonJS path resolution
// that does not exist inside a compiled binary's `$bunfs` virtual root, and
// always fell through to "0.0.0". Static imports are inlined by Bun at bundle
// time and work identically in dev and compiled modes.
import pkg from "../package.json" with { type: "json" };

const VERSION = (pkg as { version?: string }).version ?? "0.0.0";

function getHelpText(): string {
  const subcommands = getAllCommandRegistrations().map((command) => ({
    name: command.id,
    description: command.description,
    aliases: command.aliases,
  }));

  return renderHelp({
    ...MANDU_HELP,
    description: `${MANDU_HELP.description} v${VERSION}`,
    subcommands,
  });
}

/**
 * Parse arguments
 */
export function parseArgs(args: string[]): { command: string; options: Record<string, string> } {
  const options: Record<string, string> = {};
  let command = "";
  const shortFlags: Record<string, string> = {
    h: "help",
    q: "quiet",
    v: "verify",
    d: "diff",
    y: "yes",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle flags
    if (arg.startsWith("--")) {
      const equalsIndex = arg.indexOf("=");
      const key = equalsIndex >= 0 ? arg.slice(2, equalsIndex) : arg.slice(2);
      const inlineValue = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : undefined;
      const value = inlineValue ?? (args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true");
      options[key] = value;
    } else if (arg.startsWith("-") && arg.length > 1) {
      const flags = arg.slice(1).split("");
      for (const flag of flags) {
        const mapped = shortFlags[flag];
        if (mapped) {
          options[mapped] = "true";
        } else {
          options[flag] = "true";
        }
      }
    } else if (!command) {
      // First non-flag argument is the command
      command = arg;
    } else if (!options._positional) {
      // Second non-flag argument is positional
      options._positional = arg;
    }
  }

  return { command, options };
}

/**
 * Main function
 */
export async function main(args = process.argv.slice(2)): Promise<void> {
  const { command, options } = parseArgs(args);

  // Global help: no command, explicit "help" command, or --help with no command.
  if (command === "help" || !command) {
    console.log(getHelpText());
    process.exit(0);
  }

  // DNA-010: Look up command from registry (needed before --help routing so
  // `mandu <cmd> --help` can dispatch to the per-command help when available).
  const registration = getCommand(command);

  if (!registration) {
    if (options.help) {
      // --help after an unknown command falls back to the global help.
      console.log(getHelpText());
      process.exit(0);
    }
    printCLIError(CLI_ERROR_CODES.UNKNOWN_COMMAND, { command });
    console.log(getHelpText());
    process.exit(1);
  }

  // Per-command --help routing. Known subcommands get first chance to
  // render their own help, e.g. `mandu ai chat --help` -> CHAT_HELP.
  const positional = options._positional;
  const isKnownSubcommandHelp = !!(
    options.help &&
    positional &&
    registration.subcommands?.includes(positional)
  );
  if (options.help && !isKnownSubcommandHelp) {
    const helpCtx: CommandContext = { args, options };
    const help = registration.help;
    if (typeof help === "string") {
      process.stdout.write(help.endsWith("\n") ? help : help + "\n");
    } else if (typeof help === "function") {
      await help(helpCtx);
    } else {
      // No rich help defined — synthesize one from the registration
      // metadata so the user at least learns the description, the
      // available subcommands, and the aliases.
      process.stdout.write(renderFallbackHelp(registration));
    }
    process.exit(0);
  }

  // Show hero banner (after help routing so `--help` never prints it).
  if (shouldShowBanner(args)) {
    await renderHeroBanner(VERSION);
  }

  // Command execution context
  const ctx: CommandContext = { args, options };

  // Execute command
  const success = await registration.run(ctx);

  // Handle subcommand errors
  if (!success) {
    const subCommand = args[1];
    const hasSubCommand = !!(subCommand && !subCommand.startsWith("--"));
    const isKnownSubCommand = !!(
      registration.subcommands &&
      hasSubCommand &&
      registration.subcommands.includes(subCommand)
    );

    if (registration.subcommands && hasSubCommand && !isKnownSubCommand) {
      printCLIError(CLI_ERROR_CODES.UNKNOWN_SUBCOMMAND, {
        command,
        subcommand: subCommand,
      });
      console.log(`\nUsage: bunx mandu ${command} <${registration.subcommands.join("|")}>`);
    } else if (registration.subcommands && !hasSubCommand && !registration.defaultSubcommand) {
      // Subcommand required
      printCLIError(CLI_ERROR_CODES.MISSING_ARGUMENT, {
        argument: "subcommand",
      });
      console.log(`\nUsage: bunx mandu ${command} <${registration.subcommands.join("|")}>`);
    }
    process.exit(1);
  }

  if (registration.exitOnSuccess) {
    process.exit(0);
  }

}

if (import.meta.main) {
  main().catch((error) => handleCLIError(error));
}
