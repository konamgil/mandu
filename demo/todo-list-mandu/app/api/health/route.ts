/**
 * Health Check API
 *
 * GET /api/health
 */

import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => ctx.ok({
    status: "ok",
    timestamp: new Date().toISOString(),
    framework: "Mandu",
    project: "Todo List Mandu",
  }));
