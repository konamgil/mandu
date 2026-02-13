/**
 * Health Check API
 *
 * GET /api/health
 */

export function GET() {
  return Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    framework: "Mandu",
  });
}
