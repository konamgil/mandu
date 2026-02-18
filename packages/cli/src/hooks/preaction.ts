/**
 * DNA-016: Pre-Action Hooks
 *
 * 명령어 실행 전 공통 작업 수행
 * - 프로세스 타이틀 설정
 * - 조건부 배너 표시
 * - Verbose 모드 설정
 * - 설정 로드
 */

import { shouldShowBanner, renderMiniBanner } from "../terminal/banner.js";
import { loadManduConfig, type ManduConfig } from "@mandujs/core";

/**
 * Pre-Action 컨텍스트
 */
export interface PreActionContext {
  /** 현재 명령어 */
  command: string;
  /** 서브커맨드 */
  subcommand?: string;
  /** 명령어 옵션 */
  options: Record<string, string>;
  /** 로드된 설정 */
  config?: ManduConfig;
  /** verbose 모드 여부 */
  verbose: boolean;
  /** 작업 디렉토리 */
  cwd: string;
}

/**
 * Pre-Action 훅 타입
 */
export type PreActionHook = (ctx: PreActionContext) => void | Promise<void>;

/**
 * Pre-Action 훅 레지스트리
 */
class PreActionRegistry {
  private hooks: PreActionHook[] = [];

  /**
   * 훅 등록
   */
  register(hook: PreActionHook): void {
    this.hooks.push(hook);
  }

  /**
   * 훅 제거
   */
  unregister(hook: PreActionHook): boolean {
    const index = this.hooks.indexOf(hook);
    if (index >= 0) {
      this.hooks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 모든 훅 실행
   */
  async runAll(ctx: PreActionContext): Promise<void> {
    for (const hook of this.hooks) {
      await hook(ctx);
    }
  }

  /**
   * 훅 초기화
   */
  clear(): void {
    this.hooks = [];
  }

  /**
   * 등록된 훅 수
   */
  get size(): number {
    return this.hooks.length;
  }
}

/**
 * 전역 Pre-Action 훅 레지스트리
 */
export const preActionRegistry = new PreActionRegistry();

/**
 * 설정 로드가 필요없는 명령어
 */
const SKIP_CONFIG_COMMANDS = new Set([
  "init",
  "help",
  "version",
  "completion",
]);

/**
 * 배너 표시가 필요없는 명령어
 */
const SKIP_BANNER_COMMANDS = new Set([
  "completion",
  "version",
]);

/**
 * verbose 전역 상태
 */
let globalVerbose = false;

/**
 * verbose 모드 설정
 */
export function setVerbose(value: boolean): void {
  globalVerbose = value;
}

/**
 * verbose 모드 확인
 */
export function isVerbose(): boolean {
  return globalVerbose;
}

/**
 * 프로세스 타이틀 설정
 */
export function setProcessTitle(command: string, subcommand?: string): void {
  const title = subcommand
    ? `mandu ${command} ${subcommand}`
    : `mandu ${command}`;

  if (typeof process.title !== "undefined") {
    process.title = title;
  }
}

/**
 * 기본 Pre-Action 실행
 *
 * @example
 * ```ts
 * const ctx = await runPreAction({
 *   command: "dev",
 *   options: { port: "3000" },
 * });
 *
 * // ctx.config 에서 로드된 설정 사용
 * // ctx.verbose 로 verbose 모드 확인
 * ```
 */
export async function runPreAction(params: {
  command: string;
  subcommand?: string;
  options: Record<string, string>;
  cwd?: string;
  version?: string;
}): Promise<PreActionContext> {
  const {
    command,
    subcommand,
    options,
    cwd = process.cwd(),
    version,
  } = params;

  // 1. verbose 모드 확인
  const verbose = options.verbose === "true" || process.env.MANDU_VERBOSE === "true";
  setVerbose(verbose);

  // 2. 프로세스 타이틀 설정
  setProcessTitle(command, subcommand);

  // 3. 조건부 배너 표시
  const showBanner =
    !SKIP_BANNER_COMMANDS.has(command) &&
    !isTruthyEnv("MANDU_HIDE_BANNER") &&
    shouldShowBanner(process.argv);

  if (showBanner && version) {
    console.log(renderMiniBanner(version));
    console.log();
  }

  // 4. 설정 로드 (필요한 명령어만)
  let config: ManduConfig | undefined;
  if (!SKIP_CONFIG_COMMANDS.has(command)) {
    try {
      config = await loadManduConfig(cwd);
    } catch {
      // 설정 로드 실패 시 무시 (옵션 설정만 사용)
      if (verbose) {
        console.warn("[mandu] Config load failed, using defaults");
      }
    }
  }

  // Pre-Action 컨텍스트 생성
  const ctx: PreActionContext = {
    command,
    subcommand,
    options,
    config,
    verbose,
    cwd,
  };

  // 5. 등록된 훅 실행
  await preActionRegistry.runAll(ctx);

  return ctx;
}

/**
 * 환경변수가 truthy인지 확인
 */
function isTruthyEnv(key: string): boolean {
  const value = process.env[key];
  if (!value) return false;
  return !["0", "false", "no", ""].includes(value.toLowerCase());
}

/**
 * Pre-Action 훅 등록 헬퍼
 *
 * @example
 * ```ts
 * registerPreActionHook(async (ctx) => {
 *   if (ctx.command === "dev") {
 *     console.log("Starting development mode...");
 *   }
 * });
 * ```
 */
export function registerPreActionHook(hook: PreActionHook): () => void {
  preActionRegistry.register(hook);
  return () => preActionRegistry.unregister(hook);
}

/**
 * 기본 훅들 등록
 */
export function registerDefaultHooks(): void {
  // 예: 개발 모드에서 추가 정보 표시
  registerPreActionHook((ctx) => {
    if (ctx.verbose && ctx.config) {
      console.log(`[mandu] Config loaded from ${ctx.cwd}`);
      if (ctx.config.server?.port) {
        console.log(`[mandu] Server port: ${ctx.config.server.port}`);
      }
    }
  });
}
