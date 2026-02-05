/**
 * MCP Pre/Post Tool Hooks
 *
 * DNA-016 Pre-Action 훅 시스템 기반 MCP 도구 훅
 */

import type { ManduConfig } from "@mandujs/core";

/**
 * MCP 도구 실행 컨텍스트
 */
export interface McpToolContext {
  /** 도구 이름 */
  toolName: string;
  /** 도구 인자 */
  args: Record<string, unknown>;
  /** 프로젝트 루트 */
  projectRoot: string;
  /** Mandu 설정 */
  config?: ManduConfig;
  /** 실행 시작 시간 */
  startTime: number;
  /** 커스텀 데이터 (훅 간 공유용) */
  custom?: Record<string, unknown>;
}

/**
 * Pre-Tool 훅 타입
 *
 * 도구 실행 전에 호출됨
 * - 권한 검사
 * - 인자 검증
 * - 로깅
 */
export type McpPreToolHook = (ctx: McpToolContext) => void | Promise<void>;

/**
 * Post-Tool 훅 타입
 *
 * 도구 실행 후에 호출됨
 * - 결과 로깅
 * - 통계 수집
 * - 정리 작업
 */
export type McpPostToolHook = (
  ctx: McpToolContext,
  result: unknown,
  error?: unknown
) => void | Promise<void>;

/**
 * MCP 훅 레지스트리
 */
class McpHookRegistry {
  private preHooks: Array<{ hook: McpPreToolHook; priority: number }> = [];
  private postHooks: Array<{ hook: McpPostToolHook; priority: number }> = [];

  /**
   * Pre-Tool 훅 등록
   *
   * @param hook - 훅 함수
   * @param priority - 우선순위 (낮을수록 먼저 실행, 기본값 100)
   * @returns 등록 해제 함수
   */
  registerPreHook(hook: McpPreToolHook, priority = 100): () => void {
    const entry = { hook, priority };
    this.preHooks.push(entry);
    this.preHooks.sort((a, b) => a.priority - b.priority);

    return () => {
      const idx = this.preHooks.indexOf(entry);
      if (idx >= 0) this.preHooks.splice(idx, 1);
    };
  }

  /**
   * Post-Tool 훅 등록
   *
   * @param hook - 훅 함수
   * @param priority - 우선순위 (낮을수록 먼저 실행, 기본값 100)
   * @returns 등록 해제 함수
   */
  registerPostHook(hook: McpPostToolHook, priority = 100): () => void {
    const entry = { hook, priority };
    this.postHooks.push(entry);
    this.postHooks.sort((a, b) => a.priority - b.priority);

    return () => {
      const idx = this.postHooks.indexOf(entry);
      if (idx >= 0) this.postHooks.splice(idx, 1);
    };
  }

  /**
   * 모든 Pre-Tool 훅 실행
   */
  async runPreHooks(ctx: McpToolContext): Promise<void> {
    for (const { hook } of this.preHooks) {
      try {
        await hook(ctx);
      } catch (err) {
        console.error(`[MCP:PreHook] Error in hook for ${ctx.toolName}:`, err);
        throw err; // Pre 훅 에러는 도구 실행을 중단
      }
    }
  }

  /**
   * 모든 Post-Tool 훅 실행
   */
  async runPostHooks(ctx: McpToolContext, result: unknown, error?: unknown): Promise<void> {
    for (const { hook } of this.postHooks) {
      try {
        await hook(ctx, result, error);
      } catch (err) {
        // Post 훅 에러는 로깅만 하고 계속 진행
        console.error(`[MCP:PostHook] Error in hook for ${ctx.toolName}:`, err);
      }
    }
  }

  /**
   * 모든 훅 제거
   */
  clear(): void {
    this.preHooks = [];
    this.postHooks = [];
  }

  /**
   * 등록된 훅 수
   */
  get counts(): { pre: number; post: number } {
    return {
      pre: this.preHooks.length,
      post: this.postHooks.length,
    };
  }
}

/**
 * 전역 MCP 훅 레지스트리
 */
export const mcpHookRegistry = new McpHookRegistry();

// ============================================
// 기본 훅 구현
// ============================================

/**
 * 실행 시간 로깅 훅
 */
export const slowToolLoggingHook: McpPostToolHook = (ctx, _result, _error) => {
  const duration = Date.now() - ctx.startTime;
  if (duration > 5000) {
    console.warn(`[MCP] Slow tool execution: ${ctx.toolName} (${duration}ms)`);
  }
};

/**
 * 도구별 통계 수집 훅
 */
const toolStats = new Map<string, { calls: number; errors: number; totalDuration: number }>();

export const statsCollectorHook: McpPostToolHook = (ctx, _result, error) => {
  const duration = Date.now() - ctx.startTime;
  const stats = toolStats.get(ctx.toolName) ?? { calls: 0, errors: 0, totalDuration: 0 };

  stats.calls += 1;
  stats.totalDuration += duration;
  if (error) stats.errors += 1;

  toolStats.set(ctx.toolName, stats);
};

/**
 * 도구 통계 조회
 */
export function getToolStats(): Record<string, { calls: number; errors: number; avgDuration: number }> {
  const result: Record<string, { calls: number; errors: number; avgDuration: number }> = {};

  for (const [name, stats] of toolStats) {
    result[name] = {
      calls: stats.calls,
      errors: stats.errors,
      avgDuration: stats.calls > 0 ? Math.round(stats.totalDuration / stats.calls) : 0,
    };
  }

  return result;
}

/**
 * 도구 통계 초기화
 */
export function resetToolStats(): void {
  toolStats.clear();
}

/**
 * 인자 검증 훅 생성기
 */
export function createArgValidationHook(
  validations: Record<string, (args: Record<string, unknown>) => boolean | string>
): McpPreToolHook {
  return (ctx) => {
    const validator = validations[ctx.toolName];
    if (!validator) return;

    const result = validator(ctx.args);
    if (result === true) return;

    const message = typeof result === "string" ? result : `Invalid arguments for ${ctx.toolName}`;
    throw new Error(message);
  };
}

/**
 * 기본 훅 등록
 */
export function registerDefaultMcpHooks(): void {
  // 느린 도구 경고 (우선순위 낮음 - 마지막에 실행)
  mcpHookRegistry.registerPostHook(slowToolLoggingHook, 900);

  // 통계 수집 (우선순위 높음 - 먼저 실행)
  mcpHookRegistry.registerPostHook(statsCollectorHook, 10);
}
