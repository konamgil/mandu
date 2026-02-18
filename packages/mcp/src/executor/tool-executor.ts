/**
 * MCP Tool Executor
 *
 * 도구 실행 + 훅 + 에러 처리 통합
 */

import type { McpToolPlugin } from "@mandujs/core/plugins";
import type { ManduConfig } from "@mandujs/core";
import { mcpToolRegistry } from "../registry/mcp-tool-registry.js";
import { mcpHookRegistry, type McpToolContext } from "../hooks/mcp-hooks.js";
import { createToolResponse, logToolError, type McpToolResponse } from "./error-handler.js";

/**
 * Tool Executor 옵션
 */
export interface ToolExecutorOptions {
  /** 프로젝트 루트 */
  projectRoot: string;
  /** Mandu 설정 */
  config?: ManduConfig;
  /** 활동 모니터 로깅 함수 */
  logTool?: (name: string, args?: Record<string, unknown>, result?: unknown, error?: string) => void;
  /** 결과 로깅 함수 */
  logResult?: (name: string, result: unknown) => void;
}

/**
 * 도구 실행 결과
 */
export interface ExecutionResult {
  success: boolean;
  response: McpToolResponse;
  duration: number;
  toolName: string;
}

/**
 * 도구 실행기
 *
 * DNA 기능들(플러그인, 훅, 에러 처리)을 통합한 도구 실행
 */
export class ToolExecutor {
  private options: ToolExecutorOptions;

  constructor(options: ToolExecutorOptions) {
    this.options = options;
  }

  /**
   * 도구 실행
   *
   * @param name - 도구 이름
   * @param args - 도구 인자
   * @returns 실행 결과
   */
  async execute(name: string, args: Record<string, unknown> = {}): Promise<ExecutionResult> {
    const startTime = Date.now();

    // 도구 조회
    const tool = mcpToolRegistry.get(name);
    if (!tool) {
      const response = createToolResponse(name, null, new Error(`Unknown tool: ${name}`));
      return {
        success: false,
        response,
        duration: Date.now() - startTime,
        toolName: name,
      };
    }

    // 실행 컨텍스트 생성
    const ctx: McpToolContext = {
      toolName: name,
      args,
      projectRoot: this.options.projectRoot,
      config: this.options.config,
      startTime,
    };

    try {
      // Pre-Tool 훅 실행
      await mcpHookRegistry.runPreHooks(ctx);

      // 활동 로깅 (호출)
      this.options.logTool?.(name, args);

      // 도구 실행
      const result = await tool.execute(args);

      // 활동 로깅 (결과)
      this.options.logResult?.(name, result);

      // Post-Tool 훅 실행
      await mcpHookRegistry.runPostHooks(ctx, result);

      const response = createToolResponse(name, result);
      return {
        success: true,
        response,
        duration: Date.now() - startTime,
        toolName: name,
      };
    } catch (error) {
      // 에러 로깅
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.options.logTool?.(name, args, null, errorMsg);
      logToolError(name, error, args);

      // Post-Tool 훅 실행 (에러와 함께)
      await mcpHookRegistry.runPostHooks(ctx, null, error);

      const response = createToolResponse(name, null, error);
      return {
        success: false,
        response,
        duration: Date.now() - startTime,
        toolName: name,
      };
    }
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: ManduConfig): void {
    this.options.config = config;
  }

  /**
   * 도구 존재 여부 확인
   */
  hasTool(name: string): boolean {
    return mcpToolRegistry.has(name);
  }

  /**
   * 등록된 도구 목록
   */
  getToolNames(): string[] {
    return mcpToolRegistry.names;
  }
}

/**
 * Tool Executor 팩토리 함수
 */
export function createToolExecutor(options: ToolExecutorOptions): ToolExecutor {
  return new ToolExecutor(options);
}
