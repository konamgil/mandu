import {
  readLockfile,
  readMcpConfig,
  validateWithPolicy,
  detectMode,
  formatPolicyAction,
  formatValidationResult,
  type LockfileValidationResult,
} from "@mandujs/core";

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

export function handleBlockedLockfile(action: "pass" | "warn" | "error" | "block", lockResult: LockfileValidationResult | null): void {
  if (action !== "block") return;

  console.error("🛑 서버 시작 차단: Lockfile 불일치");
  console.error("   설정이 변경되었습니다. 의도한 변경이라면 아래 중 하나를 실행하세요:");
  console.error("   $ mandu lock");
  console.error("   $ bunx mandu lock");
  console.error("");
  console.error("   변경 사항 확인:");
  console.error("   $ mandu lock --diff");
  console.error("   $ bunx mandu lock --diff");
  if (lockResult) {
    console.error("");
    console.error(formatValidationResult(lockResult));
  }
  process.exit(1);
}

export function printRuntimeLockfileStatus(
  action: "pass" | "warn" | "error" | "block",
  bypassed: boolean,
  lockfile: unknown,
  lockResult: LockfileValidationResult | null
): void {
  if (action === "warn") {
    console.log(`⚠️  ${formatPolicyAction(action, bypassed)}`);
    console.log(`   ↳ lock 갱신: mandu lock  (or bunx mandu lock)`);
    console.log(`   ↳ 변경 확인: mandu lock --diff  (or bunx mandu lock --diff)`);
  } else if (lockfile && lockResult?.valid) {
    console.log(`🔒 설정 무결성 확인됨 (${lockResult.currentHash?.slice(0, 8)})`);
  } else if (!lockfile) {
    console.log(`💡 Lockfile 없음 - 'mandu lock' 또는 'bunx mandu lock'으로 생성 권장`);
  }
}
