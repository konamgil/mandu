#!/usr/bin/env bun

/**
 * Mandu CLI - Agent-Native Fullstack Framework
 *
 * DNA-010: Command Registry Pattern
 * - Declarative command registration
 * - Lazy loading for optimized startup time
 */

import { commandRegistry, getCommand, type CommandContext } from "./commands/registry";
import { CLI_ERROR_CODES, handleCLIError, printCLIError } from "./errors";
import { shouldShowBanner, renderHeroBanner, theme } from "./terminal";

const VERSION = "0.10.0";

const HELP_TEXT = `
${theme.heading("🥟 Mandu CLI")} ${theme.muted(`v${VERSION}`)} - Agent-Native Fullstack Framework

${theme.heading("Usage:")} ${theme.command("bunx mandu")} ${theme.option("<command>")} [options]

Commands:
  init                    Create new project (interactive / non-interactive with --yes)
  check                   FS Routes + Guard integrated check
  routes generate         Scan FS Routes and generate manifest
  routes list             List current routes
  routes watch            Watch routes in real-time
  dev                     Start development server (FS Routes + Guard enabled)
  build                   Build client bundles (Hydration)
  start                   Start production server (after build)
  guard                   Architecture violation check (default)
  guard arch              Architecture violation check (FSD/Clean/Hexagonal)
  guard legacy            Legacy Spec Guard check
  generate                Generate code from FS Routes + Resources
  generate resource       Generate resource (interactive or flag-based)
  spec-upsert             Validate spec file and update lock (legacy)

  doctor            Analyze Guard failures + suggest patches (Brain)
  watch             Watch files in real-time - warnings only (Brain)
  monitor           MCP Activity Monitor log stream

  brain setup       Configure sLLM (optional)
  brain status      Check Brain status

  contract create <routeId>  Create Contract for a route
  contract validate          Validate Contract-Slot consistency
  contract build             Build Contract registry
  contract diff              Compare Contract changes

  openapi generate           Generate OpenAPI 3.0 spec
  openapi serve              Start Swagger UI local server

  change begin      Start change transaction (create snapshot)
  change commit     Commit changes
  change rollback   Restore from snapshot
  change status     Show current transaction status
  change list       List change history
  change prune      Clean up old snapshots

  lock              Create/update lockfile
  lock --verify     Verify lockfile (check config integrity)
  lock --diff       Compare lockfile with current config

  add test          Install ATE + prepare Playwright browsers
  test:auto         ATE extract→generate→run→report
  test:auto --ci    CI mode (headless/enhanced artifacts)
  test:auto --impact  Run subset based on changed files
  test:auto --base-url <url>  Set target server baseURL (default: http://localhost:3333)
  test:heal         Generate healing suggestions from recent failures (no auto-commit)

Options:
  --name <name>       Project name for init (default: my-mandu-app)
  --template <name>   init template: default, realtime-chat (default: default)
  --css <framework>   CSS framework for init: tailwind, panda, none (default: tailwind)
  --ui <library>      UI library for init: shadcn, ark, none (default: shadcn)
  --theme             Add dark mode theme system on init
  --minimal           Create minimal template without CSS/UI on init (--css none --ui none)
  --with-ci           Include GitHub Actions CI/CD workflow on init (ATE E2E tests)
  --yes, -y             Skip interactive prompts on init (non-interactive mode)
  --no-install          Skip package installation on init
  --file <path>       spec-upsert spec file / monitor log file path
  --watch             File watch mode for build/guard arch
  --output <path>     Output path for routes/openapi/doctor/contract/guard
  --verbose           Verbose output for routes list/watch, contract validate, brain status
  --from <path>       Base registry path for contract diff
  --to <path>         Target registry path for contract diff
  --json              JSON output for contract diff
  --title <title>     openapi generate title
  --version <ver>     openapi generate version
  --summary           Summary output for monitor (JSON logs only)
  --since <duration>  Summary period for monitor (e.g., 5m, 30s, 1h)
  --follow <bool>     Follow mode for monitor (default: true)
  --message <msg>     Description message for change begin
  --id <id>           Specific change ID for change rollback
  --keep <n>          Number of snapshots to keep for change prune (default: 5)
  --verify, -v        Verify lockfile only
  --diff, -d          Compare lockfile with current config
  --show-secrets      Allow sensitive data in lock diff output
  --include-snapshot  Include config snapshot in lock (required for diff)
  --mode <mode>       Mode for lock verify (development|build|ci|production)
  --no-llm            Disable LLM in doctor (template mode)
  --status            Show watch status only
  --debounce <ms>     watch debounce (ms)
  --model <name>      Model name for brain setup (default: llama3.2)
  --url <url>         Ollama URL for brain setup
  --skip-check        Skip model/server check on brain setup
  --fields <fields>   Field definitions for generate resource (e.g., name:string,email:email)
  --timestamps        Auto-add createdAt/updatedAt for generate resource
  --methods <methods> HTTP methods for generate resource (e.g., GET,POST,PUT,DELETE)
  --force             Overwrite existing slots for generate/generate resource
  --help, -h          Show help

Notes:
  - Output format is auto-detected based on environment (TTY/CI/MANDU_OUTPUT).
  - Doctor output is saved as JSON for .json extension, markdown otherwise.
  - Guard arch report auto-detects format from .json/.html/.md extension.
  - Port is set via PORT env variable or mandu.config server.port.
  - On port conflict, automatically switches to the next available port.

Examples:
  bunx mandu init --name my-app                        # Tailwind + shadcn/ui default
  bunx mandu init --name my-app --with-ci              # Include CI/CD workflow
  bunx mandu init --name chat-app --template realtime-chat  # Realtime chat starter template
  bunx mandu init my-app --minimal                     # Minimal template without CSS/UI
  bunx mandu dev
  bunx mandu build --watch
  bunx mandu guard
  bunx mandu guard arch --watch
  bunx mandu guard arch --output guard-report.md
  bunx mandu check
  bunx mandu routes list --verbose
  bunx mandu contract create users
  bunx mandu contract validate --verbose
  bunx mandu contract build --output .mandu/contracts.json
  bunx mandu contract diff --json
  bunx mandu openapi generate --output docs/openapi.json
  bunx mandu openapi serve
  bunx mandu monitor --summary --since 5m
  bunx mandu doctor --output reports/doctor.json
  bunx mandu brain setup --model codellama
  bunx mandu change begin --message "Add new route"
  bunx mandu lock                          # Create/update lockfile
  bunx mandu lock --verify                 # Verify config integrity
  bunx mandu lock --diff --show-secrets    # Detailed change comparison
  bunx mandu generate resource             # Interactive resource generation
  bunx mandu generate resource user --fields name:string,email:email --timestamps
  bunx mandu generate resource product --fields name:string,price:number --methods GET,POST,PUT
  bunx mandu generate                      # Generate code from FS Routes + Resources
  bunx mandu generate --force              # Overwrite existing slots

FS Routes Workflow (recommended):
  1. init → 2. Create page.tsx in app/ folder → 3. dev → 4. build → 5. start

Resource-Centric Workflow (new approach):
  1. init → 2. generate resource → 3. Edit slot → 4. generate → 5. dev

Legacy Workflow:
  1. init → 2. spec-upsert → 3. generate → 4. build → 5. guard → 6. dev

Contract-first Workflow:
  1. contract create → 2. Edit contract → 3. generate → 4. Edit slot → 5. contract validate

Brain (sLLM) Workflow:
  1. brain setup → 2. doctor (analyze) → 3. watch (monitor)
`;

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
      const key = arg.slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
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
    console.log(HELP_TEXT);
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
    console.log(HELP_TEXT);
    process.exit(1);
  }

  // Command execution context
  const ctx: CommandContext = { args, options };

  // Execute command
  const success = await registration.run(ctx);

  // Handle subcommand errors
  if (!success) {
    const subCommand = args[1];
    if (registration.subcommands && subCommand && !subCommand.startsWith("--")) {
      // Unknown subcommand
      printCLIError(CLI_ERROR_CODES.UNKNOWN_SUBCOMMAND, {
        command,
        subcommand: subCommand,
      });
      console.log(`\nUsage: bunx mandu ${command} <${registration.subcommands.join("|")}>`);
    } else if (registration.subcommands) {
      // Subcommand required
      printCLIError(CLI_ERROR_CODES.MISSING_ARGUMENT, {
        argument: "subcommand",
      });
      console.log(`\nUsage: bunx mandu ${command} <${registration.subcommands.join("|")}>`);
    }
    process.exit(1);
  }

}

if (import.meta.main) {
  main().catch((error) => handleCLIError(error));
}
