import {
  generateLockfile,
  readLockfile,
  readMcpConfig,
  writeLockfile,
  validateWithPolicy,
  detectMode,
  formatPolicyAction,
  formatValidationResult,
  type LockfileValidationResult,
  type LockfileMode,
} from "@mandujs/core/compat/lockfile/index";

/**
 * Lockfile command templates for consistent messaging
 */
export const LOCKFILE_COMMANDS = {
  update: "mandu lock",
  diff: "mandu lock --diff",
  safeDev: "mandu lock && mandu dev --watch",
} as const;

/**
 * Formatted lockfile guidance lines with alternative commands
 */
export const LOCKFILE_GUIDE_LINES = {
  update: `${LOCKFILE_COMMANDS.update}  (or bunx mandu lock)`,
  diff: `${LOCKFILE_COMMANDS.diff}  (or bunx mandu lock --diff)`,
  safeDev: `${LOCKFILE_COMMANDS.safeDev}  (or bun run dev:safe)`,
} as const;

/**
 * Returns formatted lockfile guidance lines for display
 *
 * @returns Array of guidance messages
 *
 * @example
 * ```typescript
 * const lines = getLockfileGuidanceLines();
 * lines.forEach(line => console.log(`   ↳ ${line}`));
 * // Output:
 * //    ↳ Update lock: mandu lock  (or bunx mandu lock)
 * //    ↳ Diff check: mandu lock --diff  (or bunx mandu lock --diff)
 * //    ↳ Safe start: mandu lock && mandu dev --watch  (or bun run dev:safe)
 * ```
 */
export function getLockfileGuidanceLines(): string[] {
  return [
    `Update lock: ${LOCKFILE_GUIDE_LINES.update}`,
    `Diff check: ${LOCKFILE_GUIDE_LINES.diff}`,
    `Safe start: ${LOCKFILE_GUIDE_LINES.safeDev}`,
  ];
}

/**
 * Validates runtime lockfile against current config
 *
 * @param config - Mandu configuration object
 * @param rootDir - Project root directory
 * @returns Validation result with lockfile, action, and bypass status
 */
export async function validateRuntimeLockfile(config: Record<string, unknown>, rootDir: string) {
  const lockfile = await readLockfile(rootDir);

  let mcpConfig: Record<string, unknown> | null = null;
  try {
    mcpConfig = await readMcpConfig(rootDir);
  } catch (error) {
    console.warn(
      `⚠️  Failed to load MCP config: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const { result: lockResult, action, bypassed } = validateWithPolicy(
    config,
    lockfile,
    detectMode(),
    mcpConfig
  );

  return { lockfile, lockResult, action, bypassed };
}

export type RuntimeLockfileRefreshReason =
  | "refreshed"
  | "missing-lockfile"
  | "invalid-lockfile"
  | "valid-lockfile"
  | "policy-blocked"
  | "bypassed"
  | "invalid-mcp-config"
  | "write-failed";

export interface RuntimeLockfileRefreshResult {
  refreshed: boolean;
  reason: RuntimeLockfileRefreshReason;
  hash?: string;
  previousHash?: string;
  error?: string;
}

/**
 * Refreshes an existing lockfile when a local one-shot guard run sees drift.
 *
 * This is deliberately scoped to development policy (`warn`) so CI/build/prod
 * still fail closed. It also never creates a new lockfile; users opt into the
 * integrity workflow with `mandu lock`, and package/framework updates can keep
 * that existing lock current.
 */
export async function refreshStaleRuntimeLockfile(
  config: Record<string, unknown>,
  rootDir: string,
  options: { mode?: LockfileMode } = {}
): Promise<RuntimeLockfileRefreshResult> {
  let lockfile: Awaited<ReturnType<typeof readLockfile>>;
  try {
    lockfile = await readLockfile(rootDir);
  } catch (error) {
    return {
      refreshed: false,
      reason: "invalid-lockfile",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!lockfile) {
    return { refreshed: false, reason: "missing-lockfile" };
  }

  let mcpConfig: Record<string, unknown> | null = null;
  try {
    mcpConfig = await readMcpConfig(rootDir);
  } catch (error) {
    return {
      refreshed: false,
      reason: "invalid-mcp-config",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const { result, action, bypassed } = validateWithPolicy(
    config,
    lockfile,
    options.mode ?? detectMode(),
    mcpConfig
  );

  if (bypassed) {
    return { refreshed: false, reason: "bypassed" };
  }

  if (!result || result.valid) {
    return { refreshed: false, reason: "valid-lockfile" };
  }

  if (action !== "warn") {
    return { refreshed: false, reason: "policy-blocked" };
  }

  try {
    const nextLockfile = generateLockfile(
      config,
      {
        includeSnapshot: lockfile.snapshot !== undefined,
        includeMcpServerHashes: true,
      },
      mcpConfig
    );
    await writeLockfile(rootDir, nextLockfile);
    return {
      refreshed: true,
      reason: "refreshed",
      hash: nextLockfile.configHash,
      previousHash: lockfile.configHash,
    };
  } catch (error) {
    return {
      refreshed: false,
      reason: "write-failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Handles blocked server start due to lockfile mismatch
 *
 * Exits process with error code 1 if action is "block"
 *
 * @param action - Policy action from lockfile validation
 * @param lockResult - Validation result with details
 */
export function handleBlockedLockfile(action: "pass" | "warn" | "error" | "block", lockResult: LockfileValidationResult | null): void {
  if (action !== "block") return;

  const guidance = getLockfileGuidanceLines();
  console.error("🛑 Server start blocked: Lockfile mismatch");
  console.error("   Config has changed. If this is intentional, run:");
  console.error(`   ↳ ${guidance[0]}`);
  console.error(`   ↳ ${guidance[1]}`);
  if (lockResult) {
    console.error("");
    console.error(formatValidationResult(lockResult));
  }
  process.exit(1);
}

/**
 * Prints runtime lockfile validation status
 *
 * @param action - Policy action from lockfile validation
 * @param bypassed - Whether validation was bypassed
 * @param lockfile - Lockfile data (null if not found)
 * @param lockResult - Validation result with hash and validity
 */
export function printRuntimeLockfileStatus(
  action: "pass" | "warn" | "error" | "block",
  bypassed: boolean,
  lockfile: unknown,
  lockResult: LockfileValidationResult | null
): void {
  if (action === "warn") {
    console.log(`⚠️  ${formatPolicyAction(action, bypassed)}`);
    for (const line of getLockfileGuidanceLines()) {
      console.log(`   ↳ ${line}`);
    }
  } else if (lockfile && lockResult?.valid) {
    console.log(`🔒 Config integrity verified (${lockResult.currentHash?.slice(0, 8)})`);
  } else if (!lockfile) {
    console.log(`💡 No lockfile found - run '${LOCKFILE_COMMANDS.update}' to generate`);
  }
}
