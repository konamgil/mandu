import { renderMarkdown } from "../cli-ux/markdown.js";
// Phase 9.R2 — Error markdown payloads are pre-embedded as strings via
// `with { type: "text" }` in the generated CLI-UX manifest. This gives us
// **synchronous** access to the template body in both dev (`bun run`) and
// compiled-binary (`bun build --compile`) modes. The old `readFileSync`
// path was broken inside compiled binaries because the file imports
// resolved to `$bunfs/...` virtual paths, which `node:fs` cannot open.
//
// See packages/cli/scripts/generate-template-manifest.ts → generateUxSources.
import { CLI_UX_TEMPLATES } from "../../generated/cli-ux-manifest.js";
import { CLI_ERROR_CODES, type CLIErrorCode } from "./codes";

interface ErrorInfo {
  message: string;
  suggestion?: string;
  docLink?: string;
  /**
   * When provided, selects a markdown payload from the CLI-UX manifest
   * (key: `errors/<template>`). The template is rendered via
   * `renderMarkdown()` and fully replaces the legacy 3-line fixed
   * format. Falls back to the legacy format when the template is
   * missing or unreadable.
   */
  template?: string;
}

export const ERROR_MESSAGES: Record<CLIErrorCode, ErrorInfo> = {
  [CLI_ERROR_CODES.INIT_DIR_EXISTS]: {
    message: "Directory already exists: {path}",
    suggestion: "Choose a different project name or remove the existing directory.",
    template: "CLI_E001",
  },
  [CLI_ERROR_CODES.INIT_BUN_NOT_FOUND]: {
    message: "Bun runtime not found.",
    suggestion: "Install Bun and ensure it is available in your PATH.",
  },
  [CLI_ERROR_CODES.INIT_TEMPLATE_NOT_FOUND]: {
    message: "Template not found: {template}",
    suggestion: "Use a valid template name (default).",
  },
  [CLI_ERROR_CODES.DEV_PORT_IN_USE]: {
    message: "Port {port} is already in use.",
    suggestion: "Set PORT or mandu.config server.port to pick a different port, or stop the process using this port.",
    template: "CLI_E010",
  },
  [CLI_ERROR_CODES.DEV_MANIFEST_NOT_FOUND]: {
    message: "Routes manifest not found.",
    suggestion: "Run `mandu routes generate` or create app/ routes before dev.",
  },
  [CLI_ERROR_CODES.DEV_NO_ROUTES]: {
    message: "No routes were found in app/.",
    suggestion: "Create app/page.tsx or app/api/*/route.ts to get started.",
  },
  [CLI_ERROR_CODES.GUARD_CONFIG_INVALID]: {
    message: "Invalid guard configuration.",
    suggestion: "Check your mandu.config and guard settings.",
  },
  [CLI_ERROR_CODES.GUARD_PRESET_NOT_FOUND]: {
    message: "Unknown architecture preset: {preset}",
    suggestion: "Available presets: mandu, fsd, clean, hexagonal, atomic.",
  },
  [CLI_ERROR_CODES.GUARD_VIOLATION_FOUND]: {
    message: "{count} architecture violation(s) found.",
    suggestion: "Fix violations above or set MANDU_OUTPUT=agent for AI-friendly output.",
    template: "CLI_E022",
  },
  [CLI_ERROR_CODES.BUILD_ENTRY_NOT_FOUND]: {
    message: "Build entry not found: {entry}",
    suggestion: "Check your routes manifest or build inputs.",
  },
  [CLI_ERROR_CODES.BUILD_BUNDLE_FAILED]: {
    message: "Bundle build failed for '{target}'.",
    suggestion: "Review build errors above for missing deps or syntax errors.",
  },
  [CLI_ERROR_CODES.BUILD_OUTDIR_NOT_WRITABLE]: {
    message: "Output directory is not writable: {path}",
    suggestion: "Ensure the directory exists and you have write permissions.",
  },
  [CLI_ERROR_CODES.CONFIG_PARSE_FAILED]: {
    message: "Failed to parse mandu.config.",
    suggestion: "Fix syntax errors in the config file.",
  },
  [CLI_ERROR_CODES.CONFIG_VALIDATION_FAILED]: {
    message: "Configuration validation failed.",
    suggestion: "Review validation errors above and fix your config.",
  },

  // Skills generator errors (CLI_E050-CLI_E059) — Wave R3 L-02
  [CLI_ERROR_CODES.SKILLS_OUTPUT_ESCAPE]: {
    message: "Skills output directory escapes project root: {path}",
    suggestion:
      "--out-dir must resolve inside the project root. Use a relative path like '.claude/skills' or '.mandu/skills'.",
  },

  // Test errors (CLI_E060-CLI_E069) — Phase 12.1
  [CLI_ERROR_CODES.TEST_NO_MATCH]: {
    message: "No test files matched '{target}' patterns.",
    suggestion:
      "Create a file matching your `test.{target}.include` globs, or adjust the include/exclude patterns in mandu.config.ts.",
  },
  [CLI_ERROR_CODES.TEST_RUNNER_FAILED]: {
    message: "`bun test` exited with code {exitCode} ({target}).",
    suggestion:
      "Review the output above for failing assertions. Re-run with `--filter <name>` to narrow scope.",
  },
  [CLI_ERROR_CODES.TEST_UNKNOWN_TARGET]: {
    message: "Unknown test target: {target}",
    suggestion: "Use one of: unit, integration, all. See `mandu test --help`.",
  },

  [CLI_ERROR_CODES.UNKNOWN_COMMAND]: {
    message: "Unknown command: {command}",
    suggestion: "Run with --help to see available commands.",
  },
  [CLI_ERROR_CODES.UNKNOWN_SUBCOMMAND]: {
    message: "Unknown subcommand '{subcommand}' for {command}.",
    suggestion: "Run the command with --help to see available subcommands.",
  },
  [CLI_ERROR_CODES.MISSING_ARGUMENT]: {
    message: "Missing required argument: {argument}",
    suggestion: "Provide the required argument and try again.",
  },

  // Deploy errors (CLI_E200-CLI_E229) — Phase 13.1
  [CLI_ERROR_CODES.DEPLOY_UNSUPPORTED_TARGET]: {
    message: "Unsupported deploy target: {target}",
    suggestion:
      "Use one of: docker, docker-compose, fly, vercel, railway, netlify, cf-pages.",
  },
  [CLI_ERROR_CODES.DEPLOY_CONFIG_INVALID]: {
    message: "mandu.config is invalid — deploy aborted.",
    suggestion: "Run `mandu check` to view configuration errors.",
  },
  [CLI_ERROR_CODES.DEPLOY_BUILD_FAILED]: {
    message: "Project build failed during `mandu deploy`.",
    suggestion: "Review build errors above or run `mandu build` to reproduce.",
  },
  [CLI_ERROR_CODES.DEPLOY_GUARD_FAILED]: {
    message: "Architecture guard found {count} error(s) — deploy refused.",
    suggestion: "Fix violations above before deploying, or run `mandu guard`.",
  },
  [CLI_ERROR_CODES.DEPLOY_ARTIFACT_WRITE_FAILED]: {
    message: "Failed to write deploy artifact at {path}.",
    suggestion: "Check filesystem permissions and free disk space, then retry.",
  },
  [CLI_ERROR_CODES.DEPLOY_PROVIDER_CLI_MISSING]: {
    message: "{binary} is not installed — required for target {target}.",
    suggestion: "Install {binary} and retry. See docs/deploy/README.md for setup.",
  },
  [CLI_ERROR_CODES.DEPLOY_PROVIDER_CLI_OUTDATED]: {
    message: "{binary} {actual} is older than required {required}.",
    suggestion: "Upgrade {binary} to at least {required} before deploying.",
  },
  [CLI_ERROR_CODES.DEPLOY_SECRET_MISSING]: {
    message: "Required secret {name} is not set for target {target}.",
    suggestion:
      "Store it with `mandu deploy --target={target} --set-secret {name}=<value>` (OS keychain).",
  },
  [CLI_ERROR_CODES.DEPLOY_SECRET_STORE_UNAVAILABLE]: {
    message: "OS keychain (Bun.secrets) is unavailable.",
    suggestion:
      "Set the secret via environment variable or upgrade to Bun >= 1.3.12.",
  },
  [CLI_ERROR_CODES.DEPLOY_SECRET_FORMAT_INVALID]: {
    message: "Secret pair {pair} is malformed — expected KEY=VALUE.",
    suggestion: "Pass `--set-secret FOO=bar` (no spaces around the =).",
  },
  [CLI_ERROR_CODES.DEPLOY_SECRET_LEAKED_IN_ARTIFACT]: {
    message:
      "Refusing to write {path}: it contains the plaintext value of secret {name}.",
    suggestion:
      "Reference the secret as ${{{name}}} placeholder. Secrets must never be written to disk.",
  },
  [CLI_ERROR_CODES.DEPLOY_EXECUTE_REQUIRES_CONFIRMATION]: {
    message: "--execute is required to invoke the provider CLI for {target}.",
    suggestion:
      "Re-run with --execute after reviewing the generated artifacts, or use --dry-run to preview.",
  },
  [CLI_ERROR_CODES.DEPLOY_MANIFEST_MISSING]: {
    message: "Routes manifest is missing — build did not produce one.",
    suggestion: "Ensure app/ contains at least one route before deploying.",
  },
  [CLI_ERROR_CODES.DEPLOY_EDGE_RUNTIME_WARNING]: {
    message: "Edge runtime compatibility for {target} is unverified (Phase 15 pending).",
    suggestion: "Artifacts are generated but SSR may not work until Phase 15 lands.",
  },
  [CLI_ERROR_CODES.DEPLOY_NOT_IMPLEMENTED]: {
    message: "Adapter {target} does not yet support this operation.",
    suggestion: "Check docs/deploy/README.md for the adapter capability matrix.",
  },

  // AI chat / eval errors (CLI_E300-CLI_E309) — Phase 14.2
  [CLI_ERROR_CODES.AI_API_KEY_MISSING]: {
    message: "{envVar} is not set for provider '{provider}'.",
    suggestion:
      "Export the environment variable or use `--provider=local` for an offline echo responder.",
  },
  [CLI_ERROR_CODES.AI_STREAM_FAILED]: {
    message: "Streaming from '{provider}' failed: {detail}",
    suggestion:
      "Check network connectivity and API key. Re-run with MANDU_DEBUG=1 for verbose output.",
  },
  [CLI_ERROR_CODES.AI_HISTORY_MALFORMED]: {
    message: "History file is malformed: {path}",
    suggestion:
      "The file must be JSON matching { version, messages: [{ role, content }] }. Regenerate via /save.",
  },
  [CLI_ERROR_CODES.AI_PRESET_NOT_FOUND]: {
    message: "Preset '{preset}' not found under docs/prompts/{preset}.md.",
    suggestion:
      "Available presets: system, mandu-conventions, phase-testing, phase-auth. Pass --system <path> for a custom file.",
  },
  [CLI_ERROR_CODES.AI_PROMPT_REQUIRED]: {
    message: "No prompt provided for `mandu ai eval`.",
    suggestion:
      "Pass --prompt \"your prompt\" or --prompt-file <path> with the text to evaluate.",
  },
  [CLI_ERROR_CODES.AI_UNKNOWN_PROVIDER]: {
    message: "Unknown provider: {provider}",
    suggestion: "Use one of: claude, openai, gemini, local.",
  },
  [CLI_ERROR_CODES.AI_UNKNOWN_SLASH]: {
    message: "Unknown slash command: {command}",
    suggestion:
      "Available: /help, /reset, /save <path>, /load <path>, /preset <name>, /provider <name>, /model <name>, /quit.",
  },
  [CLI_ERROR_CODES.AI_TIMEOUT]: {
    message: "Streaming from '{provider}' exceeded the {seconds}s timeout.",
    suggestion:
      "Set MANDU_AI_TIMEOUT_MS to a higher value or retry. Local echo never times out.",
  },
  [CLI_ERROR_CODES.AI_INVALID_INPUT]: {
    message: "Input rejected: {reason}",
    suggestion:
      "Chat input must be valid UTF-8. Paste printable text (reserved bytes are filtered).",
  },
  [CLI_ERROR_CODES.AI_SYSTEM_FILE_NOT_FOUND]: {
    message: "System prompt file not found: {path}",
    suggestion:
      "Verify the --system path is correct. Paths are resolved relative to the current working directory.",
  },
  [CLI_ERROR_CODES.AI_PATH_ESCAPE]: {
    message: "Path escapes the AI chat working directory: {path}",
    suggestion:
      "Use a bare filename or a relative path under .mandu/ai-chat/ (e.g. \"session.json\" or \"./subdir/session.json\"). Absolute paths and '..' traversals are rejected.",
  },

  // Phase 12.2/12.3 — E2E/coverage/watch/heal extensions (CLI_E063-CLI_E067).
  [CLI_ERROR_CODES.TEST_E2E_PLAYWRIGHT_MISSING]: {
    message: "@playwright/test peer dependency is not installed.",
    suggestion:
      "Run 'bun add -d @playwright/test' then re-run 'mandu test --e2e'.",
  },
  [CLI_ERROR_CODES.TEST_E2E_CONFIG_MISSING]: {
    message: "Playwright config not found at {configPath}.",
    suggestion:
      "Create tests/e2e/playwright.config.ts or pass --config. See docs/testing/e2e.md.",
  },
  [CLI_ERROR_CODES.TEST_COVERAGE_THRESHOLD]: {
    message: "Coverage below threshold: {actual}% lines < {expected}%.",
    suggestion:
      "Add tests for uncovered code paths or lower test.coverage.lines in mandu.config.ts.",
  },
  [CLI_ERROR_CODES.TEST_WATCH_NO_WATCH_DIRS]: {
    message: "No directories available to watch (app/, src/, packages/ all missing).",
    suggestion:
      "Create app/ or src/ before running 'mandu test --watch'. See docs/testing/watch.md.",
  },
  [CLI_ERROR_CODES.TEST_HEAL_NO_RESULTS]: {
    message: "Heal invoked without any prior E2E failures to heal.",
    suggestion:
      "Run 'mandu test --e2e' first. --heal only operates on the latest Playwright run.",
  },
};

function interpolate(text: string, context?: Record<string, string | number>): string {
  if (!context) return text;
  let result = text;
  for (const [key, value] of Object.entries(context)) {
    // Support both legacy {key} and markdown {{key}} placeholder styles.
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value));
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
  }
  return result;
}

/**
 * Look up an error markdown payload from the CLI-UX manifest.
 *
 * Keys in the manifest follow the form `errors/<code>` (e.g.
 * `"errors/CLI_E001"`). The returned string is the exact on-disk content
 * of `packages/cli/templates/errors/<code>.md`, embedded at compile-time
 * by `bun build --compile`. Returns `null` when the code isn't registered
 * so callers can fall back to the legacy format.
 */
function loadErrorTemplate(code: string): string | null {
  return CLI_UX_TEMPLATES.get(`errors/${code}`) ?? null;
}

function formatLegacy(
  code: CLIErrorCode,
  info: ErrorInfo | undefined,
  context?: Record<string, string | number>
): string {
  const message = interpolate(info?.message ?? "Unknown error", context);
  const suggestion = info?.suggestion ? interpolate(info.suggestion, context) : undefined;

  const lines = ["", `❌ Error [${code}]`, `   ${message}`];
  if (suggestion) {
    lines.push("", `💡 ${suggestion}`);
  }
  if (info?.docLink) {
    lines.push(`📖 ${info.docLink}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Format a CLI error for human display.
 *
 * External signature is stable — all call sites continue to receive a
 * plain string. Internally we now look up an optional markdown template
 * from the pre-embedded CLI-UX manifest, interpolate `{{placeholders}}`,
 * and pipe the result through `renderMarkdown()` so the output adapts
 * to the terminal (ANSI in TTY, plain text under NO_COLOR / CI / pipes).
 *
 * When no template is registered for a code (or the manifest lookup
 * misses), we fall back to the legacy 3-line format so nothing regresses.
 */
export function formatCLIError(
  code: CLIErrorCode,
  context?: Record<string, string | number>
): string {
  const info = ERROR_MESSAGES[code];
  const templateName = info?.template;

  if (templateName) {
    const raw = loadErrorTemplate(templateName);
    if (raw) {
      const interpolated = interpolate(raw, {
        ...(context ?? {}),
        message: interpolate(info?.message ?? "", context),
        title: `${code}`,
      });
      try {
        const rendered = renderMarkdown(interpolated);
        return `\n${rendered}\n`;
      } catch {
        // Fall through to legacy format on any unexpected renderer failure.
      }
    }
  }

  return formatLegacy(code, info, context);
}

export class CLIError extends Error {
  readonly code: CLIErrorCode;
  readonly context?: Record<string, string | number>;

  constructor(code: CLIErrorCode, context?: Record<string, string | number>) {
    super(formatCLIError(code, context));
    this.code = code;
    this.context = context;
    this.name = "CLIError";
  }
}

export function printCLIError(
  code: CLIErrorCode,
  context?: Record<string, string | number>
): void {
  console.error(formatCLIError(code, context));
}

export function handleCLIError(error: unknown): never {
  if (error instanceof CLIError) {
    console.error(error.message);
    process.exit(1);
  }

  if (error instanceof Error) {
    console.error(`\n❌ Unexpected error: ${error.message}\n`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }

  console.error("\n❌ Unknown error occurred (non-Error thrown)\n");
  if (process.env.DEBUG) {
    // eslint-disable-next-line no-console
    console.error("Thrown value:", error);
  }
  process.exit(1);
}
