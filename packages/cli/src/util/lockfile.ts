import {
  readLockfile,
  readMcpConfig,
  validateWithPolicy,
  detectMode,
  formatPolicyAction,
  formatValidationResult,
  type LockfileValidationResult,
} from "@mandujs/core";

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
 * @returns Array of guidance messages with Korean labels
 *
 * @example
 * ```typescript
 * const lines = getLockfileGuidanceLines();
 * lines.forEach(line => console.log(`   ↳ ${line}`));
 * // Output:
 * //    ↳ lock 갱신: mandu lock  (or bunx mandu lock)
 * //    ↳ 변경 확인: mandu lock --diff  (or bunx mandu lock --diff)
 * //    ↳ 안정 실행: mandu lock && mandu dev --watch  (or bun run dev:safe)
 * ```
 */
export function getLockfileGuidanceLines(): string[] {
  return [
    `lock 갱신: ${LOCKFILE_GUIDE_LINES.update}`,
    `변경 확인: ${LOCKFILE_GUIDE_LINES.diff}`,
    `안정 실행: ${LOCKFILE_GUIDE_LINES.safeDev}`,
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
      `⚠️  MCP 설정 로드 실패: ${error instanceof Error ? error.message : String(error)}`
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
  console.error("🛑 서버 시작 차단: Lockfile 불일치");
  console.error("   설정이 변경되었습니다. 의도한 변경이라면 아래를 실행하세요:");
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
    console.log(`🔒 설정 무결성 확인됨 (${lockResult.currentHash?.slice(0, 8)})`);
  } else if (!lockfile) {
    console.log(`💡 Lockfile 없음 - '${LOCKFILE_COMMANDS.update}'으로 생성 권장`);
  }
}
