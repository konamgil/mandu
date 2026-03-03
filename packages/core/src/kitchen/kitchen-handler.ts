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
import { FileAPI } from "./api/file-api";
import { GuardDecisionManager } from "./api/guard-decisions";
import { ContractPlaygroundAPI } from "./api/contract-api";
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
  private fileAPI: FileAPI;
  private guardDecisions: GuardDecisionManager;
  private contractAPI: ContractPlaygroundAPI;
  private manifest: RoutesManifest;

  constructor(private options: KitchenOptions) {
    this.manifest = options.manifest;
    this.sse = new ActivitySSEBroadcaster(options.rootDir);
    this.guardAPI = new GuardAPI(options.guardConfig, options.rootDir);
    this.fileAPI = new FileAPI(options.rootDir);
    this.guardDecisions = new GuardDecisionManager(options.rootDir);
    this.contractAPI = new ContractPlaygroundAPI(options.manifest, options.rootDir);
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
    this.contractAPI.updateManifest(manifest);
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

    // Guard Decisions API
    if (sub === "/api/guard/decisions" && req.method === "GET") {
      const decisions = await this.guardDecisions.load();
      return Response.json({ decisions });
    }

    if (sub === "/api/guard/approve" && req.method === "POST") {
      try {
        const body = await req.json();
        const decision = await this.guardDecisions.save({
          violationKey: `${body.ruleId}::${body.filePath}`,
          action: "approve",
          ruleId: body.ruleId,
          filePath: body.filePath,
          reason: body.reason,
        });
        return Response.json({ decision });
      } catch {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }
    }

    if (sub === "/api/guard/reject" && req.method === "POST") {
      try {
        const body = await req.json();
        const decision = await this.guardDecisions.save({
          violationKey: `${body.ruleId}::${body.filePath}`,
          action: "reject",
          ruleId: body.ruleId,
          filePath: body.filePath,
          reason: body.reason,
        });
        return Response.json({ decision });
      } catch {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }
    }

    if (sub.startsWith("/api/guard/decisions/") && req.method === "DELETE") {
      const id = sub.slice("/api/guard/decisions/".length);
      const removed = await this.guardDecisions.remove(id);
      if (!removed) {
        return Response.json({ error: "Decision not found" }, { status: 404 });
      }
      return Response.json({ removed: true });
    }

    // File API
    if (sub === "/api/file" && req.method === "GET") {
      return this.fileAPI.handleReadFile(new URL(req.url));
    }

    if (sub === "/api/file/diff" && req.method === "GET") {
      return this.fileAPI.handleFileDiff(new URL(req.url));
    }

    if (sub === "/api/file/changes" && req.method === "GET") {
      return this.fileAPI.handleRecentChanges();
    }

    // Contract API
    if (sub === "/api/contracts" && req.method === "GET") {
      return this.contractAPI.handleList();
    }

    if (sub === "/api/contracts/validate" && req.method === "POST") {
      return this.contractAPI.handleValidate(req);
    }

    if (sub === "/api/contracts/openapi" && req.method === "GET") {
      return this.contractAPI.handleOpenAPI();
    }

    if (sub === "/api/contracts/openapi.yaml" && req.method === "GET") {
      return this.contractAPI.handleOpenAPIYAML();
    }

    if (sub.startsWith("/api/contracts/") && req.method === "GET") {
      const id = sub.slice("/api/contracts/".length);
      if (id && !id.includes("/")) {
        return this.contractAPI.handleDetail(id);
      }
    }

    // Unknown kitchen route
    return Response.json(
      { error: "Not found", path: pathname },
      { status: 404 },
    );
  }
}
