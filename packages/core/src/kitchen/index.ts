/**
 * Kitchen Module - Dev-only dashboard for Mandu projects.
 *
 * Provides real-time MCP activity stream, route explorer,
 * and architecture guard dashboard at /__kitchen.
 */

export { KitchenHandler, KITCHEN_PREFIX } from "./kitchen-handler";
export type { KitchenOptions } from "./kitchen-handler";
export { ActivitySSEBroadcaster } from "./stream/activity-sse";
export { FileTailer } from "./stream/file-tailer";
export { GuardAPI } from "./api/guard-api";
export { handleRoutesRequest } from "./api/routes-api";
export { FileAPI } from "./api/file-api";
export { parseUnifiedDiff } from "./api/diff-parser";
export type { FileDiff, DiffHunk, DiffLine } from "./api/diff-parser";
export type { RecentFileChange } from "./api/file-api";
export { GuardDecisionManager } from "./api/guard-decisions";
export type { GuardDecision } from "./api/guard-decisions";
export { ContractPlaygroundAPI } from "./api/contract-api";
export type { ContractListItem } from "./api/contract-api";
