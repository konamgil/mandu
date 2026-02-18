/**
 * DNA-015: Semantic Help System
 *
 * Semantic help formatting
 * - Example-based help
 * - Themed output
 * - Section-based structure
 */

import { theme, colorize, isRich } from "./theme.js";

/**
 * Help example type
 * [command, description]
 */
export type HelpExample = readonly [command: string, description: string];

/**
 * Command option definition
 */
export interface HelpOption {
  /** Flag (e.g., "--port", "-p, --port") */
  flags: string;
  /** Description */
  description: string;
  /** Default value */
  default?: string;
  /** Whether required */
  required?: boolean;
}

/**
 * Subcommand definition
 */
export interface HelpSubcommand {
  /** Subcommand name */
  name: string;
  /** Description */
  description: string;
  /** Aliases */
  aliases?: string[];
}

/**
 * Help section
 */
export interface HelpSection {
  /** Section title */
  title: string;
  /** Section content */
  content: string;
}

/**
 * Help definition
 */
export interface HelpDefinition {
  /** Command name */
  name: string;
  /** Short description */
  description: string;
  /** Usage */
  usage?: string;
  /** Option list */
  options?: HelpOption[];
  /** Subcommand list */
  subcommands?: HelpSubcommand[];
  /** Example list */
  examples?: HelpExample[];
  /** Additional sections */
  sections?: HelpSection[];
  /** Reference links */
  seeAlso?: string[];
}

/**
 * Format example
 *
 * @example
 * ```ts
 * formatHelpExample("mandu dev", "Start development server");
 * // "  mandu dev"
 * // "    Start development server"
 * ```
 */
export function formatHelpExample(command: string, description: string): string {
  const rich = isRich();
  const cmd = rich ? theme.accent(command) : command;
  const desc = rich ? theme.muted(description) : description;

  return `  ${cmd}\n    ${desc}`;
}

/**
 * Format example group
 *
 * @example
 * ```ts
 * formatHelpExampleGroup("Examples:", [
 *   ["mandu dev", "Start development server"],
 *   ["mandu build --prod", "Build for production"],
 * ]);
 * ```
 */
export function formatHelpExampleGroup(
  label: string,
  examples: ReadonlyArray<HelpExample>
): string {
  const rich = isRich();
  const heading = rich ? theme.heading(label) : label;
  const formatted = examples
    .map(([cmd, desc]) => formatHelpExample(cmd, desc))
    .join("\n\n");

  return `${heading}\n${formatted}`;
}

/**
 * Format option
 */
export function formatHelpOption(option: HelpOption): string {
  const rich = isRich();
  const flags = rich ? theme.option(option.flags) : option.flags;

  let desc = option.description;
  if (option.default) {
    desc += rich
      ? ` ${theme.muted(`(default: ${option.default})`)}`
      : ` (default: ${option.default})`;
  }
  if (option.required) {
    desc += rich ? ` ${theme.warn("[required]")}` : " [required]";
  }

  // Align flags and description
  const padding = Math.max(0, 24 - option.flags.length);
  return `  ${flags}${" ".repeat(padding)}${desc}`;
}

/**
 * Format subcommand
 */
export function formatHelpSubcommand(subcommand: HelpSubcommand): string {
  const rich = isRich();
  let name = subcommand.name;

  if (subcommand.aliases && subcommand.aliases.length > 0) {
    name += `, ${subcommand.aliases.join(", ")}`;
  }

  const cmd = rich ? theme.command(name) : name;
  const desc = rich ? subcommand.description : subcommand.description;

  const padding = Math.max(0, 20 - name.length);
  return `  ${cmd}${" ".repeat(padding)}${desc}`;
}

/**
 * Format section title
 */
export function formatSectionTitle(title: string): string {
  const rich = isRich();
  return rich ? theme.heading(title) : title;
}

/**
 * Render full help
 */
export function renderHelp(def: HelpDefinition): string {
  const lines: string[] = [];
  const rich = isRich();

  // Header
  const name = rich ? theme.accent(def.name) : def.name;
  lines.push(`${name} - ${def.description}`);
  lines.push("");

  // Usage
  if (def.usage) {
    lines.push(formatSectionTitle("Usage:"));
    lines.push(`  ${def.usage}`);
    lines.push("");
  }

  // Subcommands
  if (def.subcommands && def.subcommands.length > 0) {
    lines.push(formatSectionTitle("Commands:"));
    for (const sub of def.subcommands) {
      lines.push(formatHelpSubcommand(sub));
    }
    lines.push("");
  }

  // Options
  if (def.options && def.options.length > 0) {
    lines.push(formatSectionTitle("Options:"));
    for (const opt of def.options) {
      lines.push(formatHelpOption(opt));
    }
    lines.push("");
  }

  // Examples
  if (def.examples && def.examples.length > 0) {
    lines.push(formatHelpExampleGroup("Examples:", def.examples));
    lines.push("");
  }

  // Additional sections
  if (def.sections) {
    for (const section of def.sections) {
      lines.push(formatSectionTitle(section.title));
      lines.push(section.content);
      lines.push("");
    }
  }

  // See also
  if (def.seeAlso && def.seeAlso.length > 0) {
    lines.push(formatSectionTitle("See Also:"));
    for (const ref of def.seeAlso) {
      lines.push(`  ${ref}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Mandu CLI default help definition
 */
export const MANDU_HELP: HelpDefinition = {
  name: "mandu",
  description: "Agent-Native Web Framework",
  usage: "mandu <command> [options]",
  subcommands: [
    { name: "init", description: "Create a new Mandu project" },
    { name: "dev", description: "Start development server with HMR" },
    { name: "build", description: "Build for production" },
    { name: "start", description: "Start production server" },
    { name: "guard", description: "Check architecture violations", aliases: ["g"] },
    { name: "routes", description: "Manage file-system routes" },
    { name: "openapi", description: "Generate OpenAPI spec" },
    { name: "brain", description: "Setup local AI with Ollama" },
  ],
  options: [
    { flags: "--version, -v", description: "Show version number" },
    { flags: "--help, -h", description: "Show help" },
    { flags: "--json", description: "Output in JSON format" },
    { flags: "--no-color", description: "Disable colored output" },
    { flags: "--verbose", description: "Enable verbose logging" },
  ],
  examples: [
    ["mandu init my-app", "Create a new project"],
    ["mandu dev --port 4000", "Start dev server on port 4000"],
    ["mandu build --prod", "Build for production"],
    ["mandu guard --fix", "Check and auto-fix violations"],
  ],
  sections: [
    {
      title: "Environment Variables:",
      content: `  MANDU_OUTPUT    Output format (json|pretty|plain)
  NO_COLOR        Disable colors (set to any value)
  FORCE_COLOR     Force colors even in non-TTY`,
    },
  ],
  seeAlso: [
    "https://mandujs.com/docs",
    "https://github.com/mandujs/mandu",
  ],
};

/**
 * Render command-specific help
 */
export function renderCommandHelp(
  commandName: string,
  def: Partial<HelpDefinition>
): string {
  return renderHelp({
    name: `mandu ${commandName}`,
    description: def.description ?? "",
    ...def,
  });
}

/**
 * Format usage hint
 */
export function formatUsageHint(command: string, hint: string): string {
  const rich = isRich();
  const cmd = rich ? theme.accent(command) : command;
  const tip = rich ? theme.muted(hint) : hint;
  return `${tip}\n  ${cmd}`;
}

/**
 * Format error hint with help command
 */
export function formatErrorHint(errorMessage: string, helpCommand: string): string {
  const rich = isRich();
  const error = rich ? theme.error(errorMessage) : errorMessage;
  const help = rich ? theme.muted(`Run '${helpCommand}' for more information.`) : `Run '${helpCommand}' for more information.`;
  return `${error}\n\n${help}`;
}
