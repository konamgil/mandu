/**
 * MCP Tools Index
 *
 * 도구 정의 및 레지스트리 등록
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ActivityMonitor } from "../activity-monitor.js";
import { mcpToolRegistry } from "../registry/mcp-tool-registry.js";
import { moduleToPlugins } from "../adapters/tool-adapter.js";

// 도구 모듈 export
export { specTools, specToolDefinitions } from "./spec.js";
export { generateTools, generateToolDefinitions } from "./generate.js";
export { transactionTools, transactionToolDefinitions } from "./transaction.js";
export { historyTools, historyToolDefinitions } from "./history.js";
export { guardTools, guardToolDefinitions } from "./guard.js";
export { slotTools, slotToolDefinitions } from "./slot.js";
export { hydrationTools, hydrationToolDefinitions } from "./hydration.js";
export { contractTools, contractToolDefinitions } from "./contract.js";
export { brainTools, brainToolDefinitions } from "./brain.js";
export { runtimeTools, runtimeToolDefinitions } from "./runtime.js";
export { seoTools, seoToolDefinitions } from "./seo.js";
export { projectTools, projectToolDefinitions } from "./project.js";
export { ateTools, ateToolDefinitions } from "./ate.js";
export { resourceTools, resourceToolDefinitions } from "./resource.js";
export { componentTools, componentToolDefinitions } from "./component.js";

// 도구 모듈 import (등록용)
import { specTools, specToolDefinitions } from "./spec.js";
import { generateTools, generateToolDefinitions } from "./generate.js";
import { transactionTools, transactionToolDefinitions } from "./transaction.js";
import { historyTools, historyToolDefinitions } from "./history.js";
import { guardTools, guardToolDefinitions } from "./guard.js";
import { slotTools, slotToolDefinitions } from "./slot.js";
import { hydrationTools, hydrationToolDefinitions } from "./hydration.js";
import { contractTools, contractToolDefinitions } from "./contract.js";
import { brainTools, brainToolDefinitions } from "./brain.js";
import { runtimeTools, runtimeToolDefinitions } from "./runtime.js";
import { seoTools, seoToolDefinitions } from "./seo.js";
import { projectTools, projectToolDefinitions } from "./project.js";
import { ateTools, ateToolDefinitions } from "./ate.js";
import { resourceTools, resourceToolDefinitions } from "./resource.js";
import { componentTools, componentToolDefinitions } from "./component.js";

/**
 * 도구 모듈 정보
 */
interface ToolModule {
  category: string;
  definitions: Tool[];
  handlers: (
    projectRoot: string,
    server?: Server,
    monitor?: ActivityMonitor
  ) => Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
  requiresServer?: boolean;
}

/**
 * 빌트인 도구 모듈 목록
 */
const TOOL_MODULES: ToolModule[] = [
  { category: "spec", definitions: specToolDefinitions, handlers: specTools },
  { category: "generate", definitions: generateToolDefinitions, handlers: generateTools },
  { category: "transaction", definitions: transactionToolDefinitions, handlers: transactionTools },
  { category: "history", definitions: historyToolDefinitions, handlers: historyTools },
  { category: "guard", definitions: guardToolDefinitions, handlers: guardTools },
  { category: "slot", definitions: slotToolDefinitions, handlers: slotTools },
  { category: "hydration", definitions: hydrationToolDefinitions, handlers: hydrationTools },
  { category: "contract", definitions: contractToolDefinitions, handlers: contractTools },
  { category: "brain", definitions: brainToolDefinitions, handlers: brainTools as ToolModule["handlers"], requiresServer: true },
  { category: "runtime", definitions: runtimeToolDefinitions, handlers: runtimeTools },
  { category: "seo", definitions: seoToolDefinitions, handlers: seoTools },
  { category: "project", definitions: projectToolDefinitions, handlers: projectTools as ToolModule["handlers"], requiresServer: true },
  { category: "ate", definitions: ateToolDefinitions, handlers: ateTools as ToolModule["handlers"] },
  { category: "resource", definitions: resourceToolDefinitions, handlers: resourceTools },
  { category: "component", definitions: componentToolDefinitions, handlers: componentTools },
];

/**
 * 빌트인 도구들을 레지스트리에 등록
 *
 * @param projectRoot - 프로젝트 루트 경로
 * @param server - MCP Server 인스턴스 (선택, brain/project 도구에 필요)
 * @param monitor - ActivityMonitor 인스턴스 (선택)
 *
 * @example
 * ```ts
 * // 기본 등록
 * registerBuiltinTools("/path/to/project");
 *
 * // 서버와 함께 등록 (brain, project 도구 포함)
 * registerBuiltinTools("/path/to/project", server, monitor);
 * ```
 */
export function registerBuiltinTools(
  projectRoot: string,
  server?: Server,
  monitor?: ActivityMonitor
): void {
  for (const module of TOOL_MODULES) {
    // Server가 필요한 모듈은 Server가 있을 때만 등록
    if (module.requiresServer && !server) {
      continue;
    }

    try {
      const handlers = module.requiresServer
        ? (module.handlers as (root: string, srv: Server, mon: ActivityMonitor) => Record<string, (args: Record<string, unknown>) => Promise<unknown>>)(
            projectRoot,
            server!,
            monitor!
          )
        : module.handlers(projectRoot);

      const plugins = moduleToPlugins(module.definitions, handlers);
      mcpToolRegistry.registerAll(plugins, module.category);
    } catch (err) {
      console.error(`[MCP] Failed to register ${module.category} tools:`, err);
    }
  }
}

/**
 * 카테고리별 도구 수 반환
 */
export function getToolCounts(): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const category of mcpToolRegistry.getCategories()) {
    counts[category] = mcpToolRegistry.getByCategory(category).length;
  }

  return counts;
}

/**
 * 등록된 도구 요약 정보
 */
export function getToolsSummary(): {
  total: number;
  enabled: number;
  categories: string[];
  byCategory: Record<string, number>;
} {
  return {
    total: mcpToolRegistry.size,
    enabled: mcpToolRegistry.enabledCount,
    categories: mcpToolRegistry.getCategories(),
    byCategory: getToolCounts(),
  };
}
