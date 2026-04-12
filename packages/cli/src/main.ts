#!/usr/bin/env bun

/**
 * Mandu CLI - Agent-Native Fullstack Framework
 *
 * DNA-010: Command Registry Pattern
 * - Declarative command registration
 * - Lazy loading for optimized startup time
 */

import { getCommand, getAllCommandRegistrations, type CommandContext } from "./commands/registry";
import { CLI_ERROR_CODES, handleCLIError, printCLIError } from "./errors";
import { shouldShowBanner, renderHeroBanner, renderHelp, MANDU_HELP } from "./terminal";

// package.json에서 버전 동적 로딩
const VERSION = (() => {
  try {
    return require("../package.json").version as string;
  } catch {
    return "0.0.0";
  }
})();

function getHelpText(): string {
  const subcommands = getAllCommandRegistrations().map((command) => ({
    name: command.id,
    description: command.description,
    aliases: command.id === "guard" ? ["g"] : undefined,
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

  // Handle help
  if (options.help || command === "help" || !command) {
    console.log(getHelpText());
    process.exit(0);
  }

  // Show hero banner
  if (shouldShowBanner(args)) {
    await renderHeroBanner(VERSION);
  }

  // DNA-010: Look up command from registry
  const registration = getCommand(command);

  if (!registration) {
    printCLIError(CLI_ERROR_CODES.UNKNOWN_COMMAND, { command });
    console.log(getHelpText());
    process.exit(1);
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
