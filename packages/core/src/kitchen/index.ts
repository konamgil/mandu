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
