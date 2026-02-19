/**
 * Guard API - Exposes architecture guard data to Kitchen UI.
 *
 * GET /__kitchen/api/guard       → latest cached violation report
 * POST /__kitchen/api/guard/scan → trigger full directory scan
 */

import type { GuardConfig, ViolationReport } from "../../guard/types";
import { checkDirectory } from "../../guard/watcher";

export class GuardAPI {
  private cachedReport: ViolationReport | null = null;
  private scanning = false;

  constructor(
    private config: GuardConfig | null,
    private rootDir: string,
  ) {}

  /** Update config at runtime (e.g., when mandu.config.ts changes) */
  updateConfig(config: GuardConfig | null): void {
    this.config = config;
  }

  /** Handle GET /__kitchen/api/guard */
  handleGetReport(): Response {
    if (!this.config) {
      return Response.json(
        { enabled: false, message: "Guard is not configured" },
        { status: 200 },
      );
    }

    if (!this.cachedReport) {
      return Response.json({
        enabled: true,
        preset: this.config.preset,
        report: null,
        message: "No scan has been run yet. POST /__kitchen/api/guard/scan to trigger.",
      });
    }

    return Response.json({
      enabled: true,
      preset: this.config.preset,
      report: this.cachedReport,
    });
  }

  /** Handle POST /__kitchen/api/guard/scan */
  async handleScan(): Promise<Response> {
    if (!this.config) {
      return Response.json(
        { enabled: false, message: "Guard is not configured" },
        { status: 200 },
      );
    }

    if (this.scanning) {
      return Response.json(
        { message: "Scan already in progress" },
        { status: 409 },
      );
    }

    this.scanning = true;
    try {
      this.cachedReport = await checkDirectory(this.config, this.rootDir);
      return Response.json({
        enabled: true,
        preset: this.config.preset,
        report: this.cachedReport,
      });
    } finally {
      this.scanning = false;
    }
  }

  /** Called by guard watcher's onViolation to push incremental updates */
  pushViolationReport(report: ViolationReport): void {
    this.cachedReport = report;
  }
}
