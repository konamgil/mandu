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
import { type McpProfile, getProfileCategories } from "../profiles.js";

// 도구 모듈 export
export { agentTools, agentToolDefinitions } from "./agent.js";
export { specTools, specToolDefinitions } from "./spec.js";
export { generateTools, generateToolDefinitions } from "./generate.js";
export { transactionTools, transactionToolDefinitions } from "./transaction.js";
export { historyTools, historyToolDefinitions } from "./history.js";
export { guardTools, guardToolDefinitions } from "./guard.js";
export { decisionTools, decisionToolDefinitions } from "./decisions.js";
export { negotiateTools, negotiateToolDefinitions } from "./negotiate.js";
export { slotValidationTools, slotValidationToolDefinitions } from "./slot-validation.js";
export { slotTools, slotToolDefinitions } from "./slot.js";
export { hydrationTools, hydrationToolDefinitions } from "./hydration.js";
export { contractTools, contractToolDefinitions } from "./contract.js";
export { brainTools, brainToolDefinitions } from "./brain.js";
export { runtimeTools, runtimeToolDefinitions } from "./runtime.js";
export { seoTools, seoToolDefinitions } from "./seo.js";
export { projectTools, projectToolDefinitions, getDevServerState } from "./project.js";
export { resourceTools, resourceToolDefinitions } from "./resource.js";
export { componentTools, componentToolDefinitions } from "./component.js";
export { kitchenTools, kitchenToolDefinitions } from "./kitchen.js";
export { compositeTools, compositeToolDefinitions } from "./composite.js";
// Phase 14.3 — AI/agent loop-closure tool suite
export { runTestsTools, runTestsToolDefinitions } from "./run-tests.js";
export { designTools, designToolDefinitions } from "./design.js";
export { aiBriefTools, aiBriefToolDefinitions } from "./ai-brief.js";
// #243 — docs search/get for agents grounding answers in real framework docs
export { docsTools, docsToolDefinitions } from "./docs.js";
// #240 guardrail-default — lint run + setup for existing projects
export { lintTools, lintToolDefinitions } from "./lint.js";
// Phase 18.ι — AI refactor MCP tools
export {
  rewriteGeneratedBarrelTools,
  rewriteGeneratedBarrelToolDefinitions,
} from "./rewrite-generated-barrel.js";
export {
  migrateRouteConventionsTools,
  migrateRouteConventionsToolDefinitions,
} from "./migrate-route-conventions.js";
export {
  extractContractTools,
  extractContractToolDefinitions,
} from "./extract-contract.js";

// 도구 모듈 import (등록용)
import { agentTools, agentToolDefinitions } from "./agent.js";
import { specTools, specToolDefinitions } from "./spec.js";
import { generateTools, generateToolDefinitions } from "./generate.js";
import { transactionTools, transactionToolDefinitions } from "./transaction.js";
import { historyTools, historyToolDefinitions } from "./history.js";
import { guardTools, guardToolDefinitions } from "./guard.js";
import { decisionTools, decisionToolDefinitions } from "./decisions.js";
import { negotiateTools, negotiateToolDefinitions } from "./negotiate.js";
import { slotValidationTools, slotValidationToolDefinitions } from "./slot-validation.js";
import { slotTools, slotToolDefinitions } from "./slot.js";
import { hydrationTools, hydrationToolDefinitions } from "./hydration.js";
import { contractTools, contractToolDefinitions } from "./contract.js";
import { brainTools, brainToolDefinitions } from "./brain.js";
import { runtimeTools, runtimeToolDefinitions } from "./runtime.js";
import { seoTools, seoToolDefinitions } from "./seo.js";
import { projectTools, projectToolDefinitions } from "./project.js";
import { resourceTools, resourceToolDefinitions } from "./resource.js";
import { componentTools, componentToolDefinitions } from "./component.js";
import { kitchenTools, kitchenToolDefinitions } from "./kitchen.js";
import { compositeTools, compositeToolDefinitions } from "./composite.js";
import { runTestsTools, runTestsToolDefinitions } from "./run-tests.js";
import { designTools, designToolDefinitions } from "./design.js";
import { aiBriefTools, aiBriefToolDefinitions } from "./ai-brief.js";
import { docsTools, docsToolDefinitions } from "./docs.js";
import { lintTools, lintToolDefinitions } from "./lint.js";
// Phase 18.ι — AI refactor MCP tools
import {
  rewriteGeneratedBarrelTools,
  rewriteGeneratedBarrelToolDefinitions,
} from "./rewrite-generated-barrel.js";
import {
  migrateRouteConventionsTools,
  migrateRouteConventionsToolDefinitions,
} from "./migrate-route-conventions.js";
import {
  extractContractTools,
  extractContractToolDefinitions,
} from "./extract-contract.js";

/**
 * 도구 모듈 정보
 */
export interface ToolModule {
  category: string;
  definitions: Tool[];
  handlers: (
    projectRoot: string,
    server?: Server,
    monitor?: ActivityMonitor
  ) => Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
  /**
   * Hard requirement: skip registration entirely when `server` is
   * absent. Used for tools that cannot function without MCP transport
   * access (e.g. brain, project).
   */
  requiresServer?: boolean;
  /**
   * Soft requirement: forward the `Server` instance when one is
   * available, but register the tool either way. Used for tools that
   * gracefully degrade (e.g. notifications/progress silently no-ops
   * when the transport isn't attached).
   */
  acceptsServer?: boolean;
}

/**
 * 빌트인 도구 모듈 목록
 */
export const TOOL_MODULES: ToolModule[] = [
  { category: "agent", definitions: agentToolDefinitions, handlers: agentTools },
  { category: "spec", definitions: specToolDefinitions, handlers: specTools },
  { category: "generate", definitions: generateToolDefinitions, handlers: generateTools },
  { category: "transaction", definitions: transactionToolDefinitions, handlers: transactionTools },
  { category: "history", definitions: historyToolDefinitions, handlers: historyTools },
  { category: "guard", definitions: guardToolDefinitions, handlers: guardTools },
  { category: "decisions", definitions: decisionToolDefinitions, handlers: decisionTools },
  { category: "negotiate", definitions: negotiateToolDefinitions, handlers: negotiateTools },
  { category: "slot-validation", definitions: slotValidationToolDefinitions, handlers: slotValidationTools },
  { category: "slot", definitions: slotToolDefinitions, handlers: slotTools },
  { category: "hydration", definitions: hydrationToolDefinitions, handlers: hydrationTools },
  { category: "contract", definitions: contractToolDefinitions, handlers: contractTools },
  { category: "brain", definitions: brainToolDefinitions, handlers: brainTools, requiresServer: true },
  { category: "runtime", definitions: runtimeToolDefinitions, handlers: runtimeTools },
  { category: "seo", definitions: seoToolDefinitions, handlers: seoTools },
  { category: "project", definitions: projectToolDefinitions, handlers: projectTools, requiresServer: true },
  { category: "resource", definitions: resourceToolDefinitions, handlers: resourceTools },
  { category: "component", definitions: componentToolDefinitions, handlers: componentTools },
  { category: "kitchen", definitions: kitchenToolDefinitions, handlers: kitchenTools },
  { category: "composite", definitions: compositeToolDefinitions, handlers: compositeTools },
  // Phase 14.3 — AI/agent loop-closure suite
  { category: "run-tests", definitions: runTestsToolDefinitions, handlers: runTestsTools },
  // #245 M4 — Design system discovery (DESIGN.md / Guard / component inventory)
  { category: "design", definitions: designToolDefinitions, handlers: designTools },
  { category: "ai-brief", definitions: aiBriefToolDefinitions, handlers: aiBriefTools },
  { category: "docs", definitions: docsToolDefinitions, handlers: docsTools },
  { category: "lint", definitions: lintToolDefinitions, handlers: lintTools },
  // Phase 18.ι — AI refactor tools (destructive writes; dry-run by default)
  {
    category: "refactor-barrel",
    definitions: rewriteGeneratedBarrelToolDefinitions,
    handlers: rewriteGeneratedBarrelTools,
  },
  {
    category: "refactor-routes",
    definitions: migrateRouteConventionsToolDefinitions,
    handlers: migrateRouteConventionsTools,
  },
  {
    category: "refactor-contract",
    definitions: extractContractToolDefinitions,
    handlers: extractContractTools,
  },
];

export function validateBuiltinToolModules(
  modules: readonly ToolModule[] = TOOL_MODULES
): string[] {
  const issues: string[] = [];
  const categories = new Set<string>();
  const toolNames = new Map<string, string>();
  const descriptions = new Map<string, string>();

  for (const module of modules) {
    if (categories.has(module.category)) {
      issues.push(`duplicate tool category: ${module.category}`);
    }
    categories.add(module.category);

    if (module.definitions.length === 0) {
      issues.push(`tool category has no definitions: ${module.category}`);
    }

    for (const definition of module.definitions) {
      if (!definition.description?.trim()) {
        issues.push(`tool definition is missing description: ${definition.name} in ${module.category}`);
      }
      const normalizedDescription = definition.description?.trim().replace(/\s+/g, " ").toLowerCase();
      if (normalizedDescription) {
        const previousTool = descriptions.get(normalizedDescription);
        if (previousTool) {
          issues.push(
            `duplicate tool description: ${definition.name} and ${previousTool} both describe the same action`
          );
        }
        descriptions.set(normalizedDescription, definition.name);
      }
      const previousCategory = toolNames.get(definition.name);
      if (previousCategory) {
        issues.push(
          `duplicate tool definition: ${definition.name} in ${previousCategory} and ${module.category}`
        );
      }
      toolNames.set(definition.name, module.category);
    }
  }

  return issues;
}

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
  monitor?: ActivityMonitor,
  options?: { profile?: McpProfile }
): void {
  const allowedCategories = options?.profile
    ? getProfileCategories(options.profile)
    : null;
  const definitionIssues = validateBuiltinToolModules();
  if (definitionIssues.length > 0) {
    throw new Error(`Invalid MCP tool module registry:\n${definitionIssues.join("\n")}`);
  }

  for (const module of TOOL_MODULES) {
    // Profile filtering: skip categories not in the allowed list
    if (allowedCategories && !allowedCategories.includes(module.category)) {
      continue;
    }

    // Server가 필요한 모듈은 Server가 있을 때만 등록
    if (module.requiresServer && !server) {
      continue;
    }

    try {
      let handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
      if (module.requiresServer) {
        handlers = module.handlers(projectRoot, server, monitor);
      } else if (module.acceptsServer) {
        // Forward the Server when available; fall back to just projectRoot.
        handlers = server
          ? module.handlers(projectRoot, server)
          : module.handlers(projectRoot);
      } else {
        handlers = module.handlers(projectRoot);
      }

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
