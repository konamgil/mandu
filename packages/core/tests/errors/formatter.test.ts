import { describe, expect, it } from "bun:test";
import {
  createPageLoadErrorResponse,
  formatErrorForConsole,
  formatErrorResponse,
} from "../../src/error/formatter";

describe("error formatter", () => {
  it("exposes cause, file path, solution, and route context in JSON responses", () => {
    const error = createPageLoadErrorResponse("dashboard-page", "/dashboard", new Error("bad import"));
    const response = formatErrorResponse(error, { isDev: false }) as Record<string, unknown>;

    expect(response.cause).toBe(error.summary);
    expect(response.filePath).toBe(".mandu/generated/web/routes/dashboard-page.route.tsx");
    expect(response.solution).toContain("import");
    expect(response.routeId).toBe("dashboard-page");
    expect(response.routePattern).toBe("/dashboard");
    expect(response.debug).toBeUndefined();
  });

  it("prints actionable console labels without colors", () => {
    const error = createPageLoadErrorResponse("dashboard-page", "/dashboard", new Error("bad import"));
    const output = formatErrorForConsole(error, {
      useColors: false,
      includeStack: false,
      isDev: false,
    });

    expect(output).toContain("Cause:");
    expect(output).toContain("File: .mandu/generated/web/routes/dashboard-page.route.tsx");
    expect(output).toContain("Solution:");
    expect(output).toContain("Route ID: dashboard-page");
    expect(output).toContain("Route: /dashboard");
  });
});
