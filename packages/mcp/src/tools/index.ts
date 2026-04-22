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
export { ateTools, ateToolDefinitions, atePhase5ToolDefinitions, createAtePhase5Handlers } from "./ate.js";
export { ateContextTools, ateContextToolDefinitions } from "./ate-context.js";
export { ateRunTools, ateRunToolDefinitions } from "./ate-run.js";
export { ateFlakesTools, ateFlakesToolDefinitions } from "./ate-flakes.js";
export { atePromptTools, atePromptToolDefinitions } from "./ate-prompt.js";
export { ateExemplarTools, ateExemplarToolDefinitions } from "./ate-exemplar.js";
export { ateSaveTools, ateSaveToolDefinitions } from "./ate-save.js";
export { ateBoundaryProbeTools, ateBoundaryProbeToolDefinitions } from "./ate-boundary-probe.js";
export { ateRecallTools, ateRecallToolDefinitions } from "./ate-recall.js";
export { ateRememberTools, ateRememberToolDefinitions } from "./ate-remember.js";
export { ateCoverageTools, ateCoverageToolDefinitions } from "./ate-coverage.js";
// Phase C tool suite
export { ateMutateTools, ateMutateToolDefinitions } from "./ate-mutate.js";
export {
  ateMutationReportTools,
  ateMutationReportToolDefinitions,
} from "./ate-mutation-report.js";
export {
  ateOraclePendingTools,
  ateOraclePendingToolDefinitions,
} from "./ate-oracle-pending.js";
export {
  ateOracleVerdictTools,
  ateOracleVerdictToolDefinitions,
} from "./ate-oracle-verdict.js";
export {
  ateOracleReplayTools,
  ateOracleReplayToolDefinitions,
} from "./ate-oracle-replay.js";
export { resourceTools, resourceToolDefinitions } from "./resource.js";
export { componentTools, componentToolDefinitions } from "./component.js";
export { kitchenTools, kitchenToolDefinitions } from "./kitchen.js";
export { compositeTools, compositeToolDefinitions } from "./composite.js";
// Phase 14.3 — AI/agent loop-closure tool suite
export { runTestsTools, runTestsToolDefinitions } from "./run-tests.js";
export { deployPreviewTools, deployPreviewToolDefinitions } from "./deploy-preview.js";
export { aiBriefTools, aiBriefToolDefinitions } from "./ai-brief.js";
export { loopCloseTools, loopCloseToolDefinitions } from "./loop-close.js";
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
import { ateTools, ateToolDefinitions, atePhase5ToolDefinitions, createAtePhase5Handlers } from "./ate.js";
import { ateContextTools, ateContextToolDefinitions } from "./ate-context.js";
import { ateRunTools, ateRunToolDefinitions } from "./ate-run.js";
import { ateFlakesTools, ateFlakesToolDefinitions } from "./ate-flakes.js";
import { atePromptTools, atePromptToolDefinitions } from "./ate-prompt.js";
import { ateExemplarTools, ateExemplarToolDefinitions } from "./ate-exemplar.js";
import { ateSaveTools, ateSaveToolDefinitions } from "./ate-save.js";
import {
  ateBoundaryProbeTools,
  ateBoundaryProbeToolDefinitions,
} from "./ate-boundary-probe.js";
import { ateRecallTools, ateRecallToolDefinitions } from "./ate-recall.js";
import { ateRememberTools, ateRememberToolDefinitions } from "./ate-remember.js";
import { ateCoverageTools, ateCoverageToolDefinitions } from "./ate-coverage.js";
// Phase C tool suite
import { ateMutateTools, ateMutateToolDefinitions } from "./ate-mutate.js";
import {
  ateMutationReportTools,
  ateMutationReportToolDefinitions,
} from "./ate-mutation-report.js";
import {
  ateOraclePendingTools,
  ateOraclePendingToolDefinitions,
} from "./ate-oracle-pending.js";
import {
  ateOracleVerdictTools,
  ateOracleVerdictToolDefinitions,
} from "./ate-oracle-verdict.js";
import {
  ateOracleReplayTools,
  ateOracleReplayToolDefinitions,
} from "./ate-oracle-replay.js";
import { resourceTools, resourceToolDefinitions } from "./resource.js";
import { componentTools, componentToolDefinitions } from "./component.js";
import { kitchenTools, kitchenToolDefinitions } from "./kitchen.js";
import { compositeTools, compositeToolDefinitions } from "./composite.js";
import { runTestsTools, runTestsToolDefinitions } from "./run-tests.js";
import { deployPreviewTools, deployPreviewToolDefinitions } from "./deploy-preview.js";
import { aiBriefTools, aiBriefToolDefinitions } from "./ai-brief.js";
import { loopCloseTools, loopCloseToolDefinitions } from "./loop-close.js";
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
interface ToolModule {
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
const TOOL_MODULES: ToolModule[] = [
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
  { category: "brain", definitions: brainToolDefinitions, handlers: brainTools as ToolModule["handlers"], requiresServer: true },
  { category: "runtime", definitions: runtimeToolDefinitions, handlers: runtimeTools },
  { category: "seo", definitions: seoToolDefinitions, handlers: seoTools },
  { category: "project", definitions: projectToolDefinitions, handlers: projectTools as ToolModule["handlers"], requiresServer: true },
  // ate + ate-run accept an optional Server so notifications/progress
  // can flow (issue #238). `acceptsServer: true` forwards the server
  // when available but still registers when it isn't — callers that
  // boot without an MCP transport get progress no-oped silently.
  { category: "ate", definitions: ateToolDefinitions, handlers: ateTools as ToolModule["handlers"], acceptsServer: true },
  { category: "ate-phase5", definitions: atePhase5ToolDefinitions, handlers: createAtePhase5Handlers as unknown as ToolModule["handlers"] },
  { category: "ate-context", definitions: ateContextToolDefinitions, handlers: ateContextTools },
  { category: "ate-run", definitions: ateRunToolDefinitions, handlers: ateRunTools as ToolModule["handlers"], acceptsServer: true },
  { category: "ate-flakes", definitions: ateFlakesToolDefinitions, handlers: ateFlakesTools },
  { category: "ate-prompt", definitions: atePromptToolDefinitions, handlers: atePromptTools },
  { category: "ate-exemplar", definitions: ateExemplarToolDefinitions, handlers: ateExemplarTools },
  { category: "ate-save", definitions: ateSaveToolDefinitions, handlers: ateSaveTools },
  // Phase B tool suite
  {
    category: "ate-boundary-probe",
    definitions: ateBoundaryProbeToolDefinitions,
    handlers: ateBoundaryProbeTools,
  },
  { category: "ate-recall", definitions: ateRecallToolDefinitions, handlers: ateRecallTools },
  { category: "ate-remember", definitions: ateRememberToolDefinitions, handlers: ateRememberTools },
  {
    category: "ate-coverage",
    definitions: ateCoverageToolDefinitions,
    handlers: ateCoverageTools,
  },
  // Phase C tool suite
  { category: "ate-mutate", definitions: ateMutateToolDefinitions, handlers: ateMutateTools },
  {
    category: "ate-mutation-report",
    definitions: ateMutationReportToolDefinitions,
    handlers: ateMutationReportTools,
  },
  {
    category: "ate-oracle-pending",
    definitions: ateOraclePendingToolDefinitions,
    handlers: ateOraclePendingTools,
  },
  {
    category: "ate-oracle-verdict",
    definitions: ateOracleVerdictToolDefinitions,
    handlers: ateOracleVerdictTools,
  },
  {
    category: "ate-oracle-replay",
    definitions: ateOracleReplayToolDefinitions,
    handlers: ateOracleReplayTools,
  },
  { category: "resource", definitions: resourceToolDefinitions, handlers: resourceTools },
  { category: "component", definitions: componentToolDefinitions, handlers: componentTools },
  { category: "kitchen", definitions: kitchenToolDefinitions, handlers: kitchenTools },
  { category: "composite", definitions: compositeToolDefinitions, handlers: compositeTools },
  // Phase 14.3 — AI/agent loop-closure suite
  { category: "run-tests", definitions: runTestsToolDefinitions, handlers: runTestsTools },
  { category: "deploy-preview", definitions: deployPreviewToolDefinitions, handlers: deployPreviewTools },
  { category: "ai-brief", definitions: aiBriefToolDefinitions, handlers: aiBriefTools },
  { category: "loop-close", definitions: loopCloseToolDefinitions, handlers: loopCloseTools },
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
        handlers = (module.handlers as (root: string, srv: Server, mon: ActivityMonitor) => Record<string, (args: Record<string, unknown>) => Promise<unknown>>)(
          projectRoot,
          server!,
          monitor!,
        );
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
