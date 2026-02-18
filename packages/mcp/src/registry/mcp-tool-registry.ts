/**
 * MCP Tool Registry
 *
 * DNA-001 플러그인 시스템 기반 MCP 도구 레지스트리
 * - 동적 도구 등록/해제
 * - 카테고리별 관리
 * - MCP SDK 형식 변환
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpToolPlugin } from "@mandujs/core/plugins";
import { pluginToTool } from "../adapters/tool-adapter.js";

/**
 * 도구 등록 정보
 */
export interface ToolRegistration {
  plugin: McpToolPlugin;
  category?: string;
  registeredAt: Date;
  enabled: boolean;
}

/**
 * MCP 도구 레지스트리
 *
 * @example
 * ```ts
 * // 도구 등록
 * mcpToolRegistry.register({
 *   name: "custom_tool",
 *   description: "My custom tool",
 *   inputSchema: { type: "object", properties: {} },
 *   execute: async (args) => ({ success: true }),
 * }, "custom");
 *
 * // MCP SDK 형식으로 변환
 * const tools = mcpToolRegistry.toToolDefinitions();
 * ```
 */
export class McpToolRegistry {
  private tools = new Map<string, ToolRegistration>();
  private categories = new Map<string, Set<string>>();
  private listeners = new Set<(event: RegistryEvent) => void>();

  /**
   * 도구 등록
   *
   * @param plugin - McpToolPlugin 인스턴스
   * @param category - 도구 카테고리 (선택)
   * @returns 등록 해제 함수
   */
  register(plugin: McpToolPlugin, category?: string): () => void {
    const registration: ToolRegistration = {
      plugin,
      category,
      registeredAt: new Date(),
      enabled: true,
    };

    this.tools.set(plugin.name, registration);

    if (category) {
      if (!this.categories.has(category)) {
        this.categories.set(category, new Set());
      }
      this.categories.get(category)!.add(plugin.name);
    }

    this.emit({ type: "register", toolName: plugin.name, category });

    return () => this.unregister(plugin.name);
  }

  /**
   * 여러 도구 일괄 등록
   */
  registerAll(plugins: McpToolPlugin[], category?: string): void {
    for (const plugin of plugins) {
      this.register(plugin, category);
    }
  }

  /**
   * 도구 해제
   */
  unregister(name: string): boolean {
    const registration = this.tools.get(name);
    if (!registration) return false;

    this.tools.delete(name);

    // 카테고리에서도 제거
    if (registration.category) {
      const categorySet = this.categories.get(registration.category);
      categorySet?.delete(name);
      if (categorySet?.size === 0) {
        this.categories.delete(registration.category);
      }
    }

    this.emit({ type: "unregister", toolName: name });
    return true;
  }

  /**
   * 카테고리 전체 해제
   */
  unregisterCategory(category: string): number {
    const names = this.categories.get(category);
    if (!names) return 0;

    let count = 0;
    for (const name of Array.from(names)) {
      if (this.unregister(name)) count++;
    }
    return count;
  }

  /**
   * 도구 조회
   */
  get(name: string): McpToolPlugin | undefined {
    return this.tools.get(name)?.plugin;
  }

  /**
   * 도구 존재 여부
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 도구 활성화/비활성화
   */
  setEnabled(name: string, enabled: boolean): void {
    const registration = this.tools.get(name);
    if (registration) {
      registration.enabled = enabled;
      this.emit({ type: enabled ? "enable" : "disable", toolName: name });
    }
  }

  /**
   * MCP SDK Tool 형식으로 변환
   *
   * 활성화된 도구만 반환
   */
  toToolDefinitions(): Tool[] {
    const tools: Tool[] = [];

    for (const registration of this.tools.values()) {
      if (registration.enabled) {
        tools.push(pluginToTool(registration.plugin));
      }
    }

    return tools;
  }

  /**
   * 핸들러 맵 반환
   *
   * 활성화된 도구의 핸들러만 반환
   */
  toHandlers(): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
    const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};

    for (const [name, registration] of this.tools) {
      if (registration.enabled) {
        handlers[name] = async (args) => registration.plugin.execute(args);
      }
    }

    return handlers;
  }

  /**
   * 카테고리별 도구 목록
   */
  getByCategory(category: string): McpToolPlugin[] {
    const names = this.categories.get(category);
    if (!names) return [];

    return Array.from(names)
      .map((name) => this.tools.get(name)?.plugin)
      .filter((p): p is McpToolPlugin => p !== undefined);
  }

  /**
   * 모든 카테고리 목록
   */
  getCategories(): string[] {
    return Array.from(this.categories.keys());
  }

  /**
   * 등록된 도구 수
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 활성화된 도구 수
   */
  get enabledCount(): number {
    let count = 0;
    for (const registration of this.tools.values()) {
      if (registration.enabled) count++;
    }
    return count;
  }

  /**
   * 모든 도구 이름
   */
  get names(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 모든 도구 초기화
   */
  clear(): void {
    this.tools.clear();
    this.categories.clear();
    this.emit({ type: "clear" });
  }

  /**
   * 이벤트 리스너 등록
   */
  on(listener: (event: RegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 이벤트 발생
   */
  private emit(event: RegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[McpToolRegistry] Listener error:", err);
      }
    }
  }

  /**
   * 디버그용 상태 덤프
   */
  dump(): RegistryDump {
    const tools: Record<string, { category?: string; enabled: boolean; registeredAt: string }> = {};

    for (const [name, reg] of this.tools) {
      tools[name] = {
        category: reg.category,
        enabled: reg.enabled,
        registeredAt: reg.registeredAt.toISOString(),
      };
    }

    return {
      totalTools: this.size,
      enabledTools: this.enabledCount,
      categories: this.getCategories(),
      tools,
    };
  }
}

/**
 * 레지스트리 이벤트
 */
export interface RegistryEvent {
  type: "register" | "unregister" | "enable" | "disable" | "clear";
  toolName?: string;
  category?: string;
}

/**
 * 레지스트리 상태 덤프
 */
export interface RegistryDump {
  totalTools: number;
  enabledTools: number;
  categories: string[];
  tools: Record<string, { category?: string; enabled: boolean; registeredAt: string }>;
}

/**
 * 전역 MCP 도구 레지스트리 인스턴스
 */
export const mcpToolRegistry = new McpToolRegistry();
