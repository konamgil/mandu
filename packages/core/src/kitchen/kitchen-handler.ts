/**
 * Kitchen HTTP Handler - Dispatches /__kitchen/* requests.
 *
 * Mounted inside handleRequestInternal() when isDev === true.
 * All Kitchen routes are under /__kitchen prefix.
 */

import type { RoutesManifest } from "../spec/schema";
import type { GuardConfig } from "../guard/types";
import { ActivitySSEBroadcaster } from "./stream/activity-sse";
import { GuardAPI } from "./api/guard-api";
import { handleRoutesRequest } from "./api/routes-api";
import { renderKitchenHTML } from "./kitchen-ui";

export const KITCHEN_PREFIX = "/__kitchen";

export interface KitchenOptions {
  rootDir: string;
  manifest: RoutesManifest;
  guardConfig: GuardConfig | null;
}

export class KitchenHandler {
  private sse: ActivitySSEBroadcaster;
  private guardAPI: GuardAPI;
  private manifest: RoutesManifest;

  constructor(private options: KitchenOptions) {
    this.manifest = options.manifest;
    this.sse = new ActivitySSEBroadcaster(options.rootDir);
    this.guardAPI = new GuardAPI(options.guardConfig, options.rootDir);
  }

  start(): void {
    this.sse.start();
  }

  stop(): void {
    this.sse.stop();
  }

  /** Update manifest when routes change (HMR rebuild) */
  updateManifest(manifest: RoutesManifest): void {
    this.manifest = manifest;
  }

  /** Update guard config when mandu.config.ts changes */
  updateGuardConfig(config: GuardConfig | null): void {
    this.guardAPI.updateConfig(config);
  }

  /** Get the SSE broadcaster for external event injection */
  get broadcaster(): ActivitySSEBroadcaster {
    return this.sse;
  }

  /** Get the Guard API for pushing violation reports */
  get guard(): GuardAPI {
    return this.guardAPI;
  }

  /**
   * Handle a /__kitchen/* request.
   * Returns Response or null if path doesn't match.
   */
  async handle(req: Request, pathname: string): Promise<Response | null> {
    if (!pathname.startsWith(KITCHEN_PREFIX)) {
      return null;
    }

    const sub = pathname.slice(KITCHEN_PREFIX.length) || "/";

    // Kitchen dashboard UI
    if (sub === "/" || sub === "") {
      return new Response(renderKitchenHTML(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // SSE activity stream
    if (sub === "/sse/activity") {
      return this.sse.createResponse();
    }

    // Routes API
    if (sub === "/api/routes") {
      return handleRoutesRequest(this.manifest);
    }

    // Guard API
    if (sub === "/api/guard" && req.method === "GET") {
      return this.guardAPI.handleGetReport();
    }

    if (sub === "/api/guard/scan" && req.method === "POST") {
      return this.guardAPI.handleScan();
    }

    // Unknown kitchen route
    return Response.json(
      { error: "Not found", path: pathname },
      { status: 404 },
    );
  }
}
