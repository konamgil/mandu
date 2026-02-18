/**
 * mandu lock - Lockfile Management Command
 *
 * Lockfile generation, verification, and comparison for config integrity
 *
 * @see docs/plans/08_ont-run_adoption_plan.md
 *
 * Usage:
 *   mandu lock              # generate/update lockfile
 *   mandu lock --verify     # verify lockfile
 *   mandu lock --diff       # show changes
 *   mandu lock --show-secrets  # allow sensitive data output
 */

import {
  validateAndReport,
  generateLockfile,
  readLockfile,
  readMcpConfig,
  writeLockfile,
  lockfileExists,
  validateLockfile,
  validateWithPolicy,
  formatValidationResult,
  formatPolicyAction,
  detectMode,
  isBypassed,
  diffConfig,
  formatConfigDiff,
  summarizeDiff,
  resolveMcpSources,
  type LockfileMode,
  LOCKFILE_PATH,
} from "@mandujs/core";
import { resolveFromCwd } from "../util/fs";

// ============================================
// CLI option types
// ============================================

export interface LockOptions {
  /** Verify lockfile only */
  verify?: boolean;
  /** Show changes */
  diff?: boolean;
  /** Allow sensitive data output */
  showSecrets?: boolean;
  /** Force mode override */
  mode?: LockfileMode;
  /** Include snapshot */
  includeSnapshot?: boolean;
  /** Quiet output */
  quiet?: boolean;
  /** JSON output */
  json?: boolean;
}

// ============================================
// Main command
// ============================================

/**
 * Execute mandu lock command
 */
export async function lock(options: LockOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const {
    verify = false,
    diff = false,
    showSecrets = false,
    mode,
    includeSnapshot = false,
    quiet = false,
    json = false,
  } = options;

  // Load config
  const config = await validateAndReport(rootDir);
  if (!config) {
    if (!json) {
      console.error("❌ Failed to load mandu.config");
    }
    return false;
  }

  // Load MCP config (.mcp.json)
  let mcpConfig: Record<string, unknown> | null = null;
  try {
    mcpConfig = await readMcpConfig(rootDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify({ success: false, error: message }));
    } else {
      console.error(`❌ Failed to load .mcp.json: ${message}`);
    }
    return false;
  }

  const log = (msg: string) => {
    if (!quiet && !json) {
      console.log(msg);
    }
  };

  // --verify: verify only
  if (verify) {
    return await verifyLockfile(rootDir, config, mcpConfig, { mode, quiet, json });
  }

  // --diff: show changes
  if (diff) {
    return await showDiff(rootDir, config, mcpConfig, { showSecrets, quiet, json });
  }

  // Default: create/update lockfile
  return await createOrUpdateLockfile(rootDir, config, {
    includeSnapshot,
    quiet,
    json,
    mcpConfig,
  });
}

// ============================================
// Subcommands
// ============================================

/**
 * Create or update lockfile
 */
async function createOrUpdateLockfile(
  rootDir: string,
  config: Record<string, unknown>,
  options: { includeSnapshot?: boolean; quiet?: boolean; json?: boolean; mcpConfig?: Record<string, unknown> | null }
): Promise<boolean> {
  const { includeSnapshot = false, quiet = false, json = false, mcpConfig } = options;

  try {
    const existingLockfile = await readLockfile(rootDir);
    const isUpdate = existingLockfile !== null;

    // Generate lockfile
    const lockfile = generateLockfile(
      config,
      {
        includeSnapshot,
        includeMcpServerHashes: true,
      },
      mcpConfig
    );

    // Write
    await writeLockfile(rootDir, lockfile);

    if (json) {
      console.log(
        JSON.stringify({
          success: true,
          action: isUpdate ? "updated" : "created",
          path: LOCKFILE_PATH,
          hash: lockfile.configHash,
        })
      );
    } else if (!quiet) {
      if (isUpdate) {
        console.log("✅ Lockfile updated");
      } else {
        console.log("✅ Lockfile created");
      }
      console.log(`   Path: ${LOCKFILE_PATH}`);
      console.log(`   Hash: ${lockfile.configHash}`);
      console.log(`   Time: ${lockfile.generatedAt}`);
    }

    return true;
  } catch (error) {
    if (json) {
      console.log(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error("❌ Lockfile generation failed:", error);
    }
    return false;
  }
}

/**
 * Verify lockfile
 */
async function verifyLockfile(
  rootDir: string,
  config: Record<string, unknown>,
  mcpConfig: Record<string, unknown> | null,
  options: { mode?: LockfileMode; quiet?: boolean; json?: boolean }
): Promise<boolean> {
  const { mode, quiet = false, json = false } = options;

  const lockfile = await readLockfile(rootDir);

  if (!lockfile) {
    if (json) {
      console.log(
        JSON.stringify({
          success: false,
          error: "LOCKFILE_NOT_FOUND",
          message: "Lockfile not found. Run 'mandu lock' to generate one.",
        })
      );
    } else {
      console.error("❌ Lockfile not found.");
      console.error("   Run 'mandu lock' to generate one.");
    }
    return false;
  }

  // Policy-based verification
  const resolvedMode = mode ?? detectMode();
  const { result, action, bypassed } = validateWithPolicy(
    config,
    lockfile,
    resolvedMode,
    mcpConfig
  );

  if (json) {
    console.log(
      JSON.stringify({
        success: result?.valid ?? false,
        action,
        bypassed,
        mode: resolvedMode,
        currentHash: result?.currentHash,
        lockedHash: result?.lockedHash,
        errors: result?.errors ?? [],
        warnings: result?.warnings ?? [],
      })
    );
    return result?.valid ?? false;
  }

  if (!quiet) {
    console.log(formatPolicyAction(action, bypassed));
    console.log(`   Mode: ${resolvedMode}`);

    if (result) {
      console.log(formatValidationResult(result));
    }
  }

  // Treat pass or warn as success (CI may handle differently)
  return action === "pass" || action === "warn";
}

/**
 * Show changes
 */
async function showDiff(
  rootDir: string,
  config: Record<string, unknown>,
  mcpConfig: Record<string, unknown> | null,
  options: { showSecrets?: boolean; quiet?: boolean; json?: boolean }
): Promise<boolean> {
  const { showSecrets = false, quiet = false, json = false } = options;

  const lockfile = await readLockfile(rootDir);

  if (!lockfile) {
    if (json) {
      console.log(
        JSON.stringify({
          success: false,
          error: "LOCKFILE_NOT_FOUND",
        })
      );
    } else {
      console.error("❌ Lockfile not found.");
      console.error("   Run 'mandu lock' to generate one.");
    }
    return false;
  }

  // If no snapshot, show entire config as changes
  if (!lockfile.snapshot) {
    if (json) {
      console.log(
        JSON.stringify({
          success: true,
          warning: "SNAPSHOT_MISSING",
          message: "No snapshot found, showing entire config as changes",
          hasChanges: true,
        })
      );
    } else {
      console.log("⚠️  Lockfile has no snapshot.");
      console.log("   Showing entire config as changes.");
      console.log("   For accurate diff: mandu lock --include-snapshot\n");
    }

    // Show entire config as additions
    const { mcpServers } = resolveMcpSources(config, mcpConfig);
    const configForDiff = mcpServers ? { ...config, mcpServers } : config;
    const fullDiff = diffConfig({}, configForDiff);
    console.log(formatConfigDiff(fullDiff, { color: true, verbose: true, showSecrets }));
    return true;
  }

  // Calculate diff
  const { mcpServers } = resolveMcpSources(config, mcpConfig);
  const configForDiff = mcpServers ? { ...config, mcpServers } : config;
  const diff = diffConfig(lockfile.snapshot.config, configForDiff);

  if (json) {
    console.log(
      JSON.stringify({
        success: true,
        hasChanges: diff.hasChanges,
        diff,
      })
    );
    return true;
  }

  if (!quiet) {
    if (diff.hasChanges) {
      console.log(
        formatConfigDiff(diff, {
          color: true,
          verbose: true,
          showSecrets,
        })
      );
      console.log(`\nSummary: ${summarizeDiff(diff)}`);
    } else {
      console.log("✅ No changes");
      console.log(`   Current config matches lockfile.`);
    }
  }

  return true;
}

// ============================================
// CLI entry point (called from main.ts)
// ============================================

/**
 * Parse CLI arguments and execute
 */
export async function runLockCommand(args: string[]): Promise<boolean> {
  const options: LockOptions = {};

  const setMode = (value?: string) => {
    switch (value) {
      case "development":
      case "build":
      case "ci":
      case "production":
        options.mode = value;
        break;
    }
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--verify":
      case "-v":
        options.verify = true;
        break;
      case "--diff":
      case "-d":
        options.diff = true;
        break;
      case "--show-secrets":
        options.showSecrets = true;
        break;
      case "--include-snapshot":
        options.includeSnapshot = true;
        break;
      case "--quiet":
      case "-q":
        options.quiet = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--mode": {
        const value = args[i + 1];
        if (value) {
          setMode(value);
          i++;
        }
        break;
      }
      default:
        if (arg.startsWith("--mode=")) {
          setMode(arg.split("=", 2)[1]);
        }
        break;
    }
  }

  return lock(options);
}

// ============================================
// Help
// ============================================

export const lockHelp = `
mandu lock - Lockfile management

Usage:
  mandu lock                    Generate/update lockfile
  mandu lock --verify           Verify lockfile
  mandu lock --diff             Show changes

Options:
  --verify, -v          Verify lockfile only
  --diff, -d            Compare lockfile with current config
  --show-secrets        Allow sensitive data output (default: masked)
  --include-snapshot    Include config snapshot (required for diff)
  --mode=<mode>         Set verification mode (development|build|ci|production)
  --quiet, -q           Quiet output
  --json                JSON output

Examples:
  mandu lock                         # Generate lockfile
  mandu lock --verify                # Verify
  mandu lock --diff --show-secrets   # Diff with sensitive data

Environment variables:
  MANDU_LOCK_BYPASS=1   Bypass lockfile verification (emergency use)
`;
