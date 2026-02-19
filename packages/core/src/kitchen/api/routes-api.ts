/**
 * Routes API - Exposes RoutesManifest data to Kitchen UI.
 *
 * GET /__kitchen/api/routes → JSON list of all registered routes.
 */

import type { RoutesManifest, RouteSpec } from "../../spec/schema";

export interface RouteInfo {
  id: string;
  pattern: string;
  kind: "page" | "api";
  module: string;
  methods?: string[];
  hasSlot: boolean;
  hasContract: boolean;
  hasClient: boolean;
  hasLayout: boolean;
  hydration?: string;
}

function toRouteInfo(route: RouteSpec): RouteInfo {
  return {
    id: route.id,
    pattern: route.pattern,
    kind: route.kind,
    module: route.module,
    methods: route.methods,
    hasSlot: !!route.slotModule,
    hasContract: !!route.contractModule,
    hasClient: !!route.clientModule,
    hasLayout: !!(route.kind === "page" && route.layoutChain?.length),
    hydration: route.kind === "page" ? route.hydration?.strategy : undefined,
  };
}

export function handleRoutesRequest(manifest: RoutesManifest): Response {
  const routes = manifest.routes.map(toRouteInfo);

  const summary = {
    total: routes.length,
    pages: routes.filter((r) => r.kind === "page").length,
    apis: routes.filter((r) => r.kind === "api").length,
    withSlots: routes.filter((r) => r.hasSlot).length,
    withContracts: routes.filter((r) => r.hasContract).length,
    withIslands: routes.filter((r) => r.hasClient).length,
  };

  return Response.json({ routes, summary });
}
