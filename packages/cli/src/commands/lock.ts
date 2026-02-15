/**
 * mandu lock - Lockfile Management Command
 *
 * 설정 무결성을 위한 lockfile 생성, 검증, 비교
 *
 * @see docs/plans/08_ont-run_adoption_plan.md
 *
 * 사용법:
 *   mandu lock              # lockfile 생성/갱신
 *   mandu lock --verify     # lockfile 검증
 *   mandu lock --diff       # 변경사항 표시
 *   mandu lock --show-secrets  # 민감정보 출력 허용
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
// CLI 옵션 타입
// ============================================

export interface LockOptions {
  /** lockfile 검증만 수행 */
  verify?: boolean;
  /** 변경사항 표시 */
  diff?: boolean;
  /** 민감정보 출력 허용 */
  showSecrets?: boolean;
  /** 강제 모드 지정 */
  mode?: LockfileMode;
  /** 스냅샷 포함 */
  includeSnapshot?: boolean;
  /** 조용한 출력 */
  quiet?: boolean;
  /** JSON 출력 */
  json?: boolean;
}

// ============================================
// 메인 명령어
// ============================================

/**
 * mandu lock 명령 실행
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

  // 설정 로드
  const config = await validateAndReport(rootDir);
  if (!config) {
    if (!json) {
      console.error("❌ mandu.config 로드 실패");
    }
    return false;
  }

  // MCP 설정 로드 (.mcp.json)
  let mcpConfig: Record<string, unknown> | null = null;
  try {
    mcpConfig = await readMcpConfig(rootDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify({ success: false, error: message }));
    } else {
      console.error(`❌ .mcp.json 로드 실패: ${message}`);
    }
    return false;
  }

  const log = (msg: string) => {
    if (!quiet && !json) {
      console.log(msg);
    }
  };

  // --verify: 검증만 수행
  if (verify) {
    return await verifyLockfile(rootDir, config, mcpConfig, { mode, quiet, json });
  }

  // --diff: 변경사항 표시
  if (diff) {
    return await showDiff(rootDir, config, mcpConfig, { showSecrets, quiet, json });
  }

  // 기본: lockfile 생성/갱신
  return await createOrUpdateLockfile(rootDir, config, {
    includeSnapshot,
    quiet,
    json,
    mcpConfig,
  });
}

// ============================================
// 서브 명령어
// ============================================

/**
 * lockfile 생성 또는 갱신
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

    // lockfile 생성
    const lockfile = generateLockfile(
      config,
      {
        includeSnapshot,
        includeMcpServerHashes: true,
      },
      mcpConfig
    );

    // 쓰기
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
        console.log("✅ Lockfile 갱신 완료");
      } else {
        console.log("✅ Lockfile 생성 완료");
      }
      console.log(`   경로: ${LOCKFILE_PATH}`);
      console.log(`   해시: ${lockfile.configHash}`);
      console.log(`   시각: ${lockfile.generatedAt}`);
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
      console.error("❌ Lockfile 생성 실패:", error);
    }
    return false;
  }
}

/**
 * lockfile 검증
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
          message: "Lockfile이 존재하지 않습니다. 'mandu lock'으로 생성하세요.",
        })
      );
    } else {
      console.error("❌ Lockfile이 존재하지 않습니다.");
      console.error("   'mandu lock' 명령으로 생성하세요.");
    }
    return false;
  }

  // 정책 기반 검증
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
    console.log(`   모드: ${resolvedMode}`);

    if (result) {
      console.log(formatValidationResult(result));
    }
  }

  // action이 pass나 warn이면 성공으로 간주 (CI에서는 다르게 처리 가능)
  return action === "pass" || action === "warn";
}

/**
 * 변경사항 표시
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
      console.error("❌ Lockfile이 존재하지 않습니다.");
      console.error("   'mandu lock' 명령으로 생성하세요.");
    }
    return false;
  }

  // 스냅샷이 없으면 전체 설정을 변경사항으로 표시
  if (!lockfile.snapshot) {
    if (json) {
      console.log(
        JSON.stringify({
          success: true,
          warning: "SNAPSHOT_MISSING",
          message: "스냅샷이 없어 전체 설정을 변경사항으로 표시",
          hasChanges: true,
        })
      );
    } else {
      console.log("⚠️  Lockfile에 스냅샷이 없습니다.");
      console.log("   전체 설정을 변경사항으로 표시합니다.");
      console.log("   정확한 diff를 보려면: mandu lock --include-snapshot\n");
    }

    // Show entire config as additions
    const { mcpServers } = resolveMcpSources(config, mcpConfig);
    const configForDiff = mcpServers ? { ...config, mcpServers } : config;
    const fullDiff = diffConfig({}, configForDiff);
    console.log(formatConfigDiff(fullDiff, { color: true, verbose: true, showSecrets }));
    return true;
  }

  // diff 계산
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
      console.log(`\n요약: ${summarizeDiff(diff)}`);
    } else {
      console.log("✅ 변경사항 없음");
      console.log(`   현재 설정이 lockfile과 일치합니다.`);
    }
  }

  return true;
}

// ============================================
// CLI 진입점 (main.ts에서 호출)
// ============================================

/**
 * CLI 인자 파싱 및 실행
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
// 도움말
// ============================================

export const lockHelp = `
mandu lock - Lockfile 관리

사용법:
  mandu lock                    lockfile 생성/갱신
  mandu lock --verify           lockfile 검증
  mandu lock --diff             변경사항 표시

옵션:
  --verify, -v          lockfile 검증만 수행
  --diff, -d            lockfile과 현재 설정 비교
  --show-secrets        민감정보 출력 허용 (기본: 마스킹)
  --include-snapshot    설정 스냅샷 포함 (diff 기능에 필요)
  --mode=<mode>         검증 모드 지정 (development|build|ci|production)
  --quiet, -q           조용한 출력
  --json                JSON 형식 출력

예시:
  mandu lock                         # lockfile 생성
  mandu lock --verify                # 검증
  mandu lock --diff --show-secrets   # 민감정보 포함 diff

환경변수:
  MANDU_LOCK_BYPASS=1   lockfile 검증 우회 (긴급 상황용)
`;
