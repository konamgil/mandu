/**
 * vercel.json generator tests.
 *
 * Focus on byte-level output correctness and schema compliance. Vercel's
 * own build pipeline validates the final file during `vercel build`.
 */

import { describe, it, expect } from "bun:test";
import { generateVercelEdgeConfig } from "../src/vercel/vercel-config";

describe("generateVercelEdgeConfig", () => {
  it("emits a minimal valid config with just projectName", () => {
    const json = generateVercelEdgeConfig({ projectName: "my-app" });
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed.$schema).toBe("https://openapi.vercel.sh/vercel.json");
    const functions = parsed.functions as Record<string, { runtime: string }>;
    expect(functions["api/_mandu.ts"]).toBeDefined();
    expect(functions["api/_mandu.ts"]?.runtime).toBe("edge");

    const rewrites = parsed.rewrites as Array<{ source: string; destination: string }>;
    // Our injected catch-all is always present.
    const catchAll = rewrites.find((r) => r.source === "/(.*)");
    expect(catchAll).toBeDefined();

    expect(json.endsWith("\n")).toBe(true);
  });

  it("uses the provided function path when explicit", () => {
    const json = generateVercelEdgeConfig({
      projectName: "app",
      functionPath: "api/edge/handler.ts",
    });
    const parsed = JSON.parse(json) as {
      functions: Record<string, { runtime: string }>;
    };
    expect(parsed.functions["api/edge/handler.ts"]).toBeDefined();
    expect(parsed.functions["api/edge/handler.ts"]?.runtime).toBe("edge");
  });

  it("rejects function paths that do not live under api/", () => {
    expect(() =>
      generateVercelEdgeConfig({
        projectName: "app",
        functionPath: "server/handler.ts",
      })
    ).toThrow(/must live under api\//);

    expect(() =>
      generateVercelEdgeConfig({
        projectName: "app",
        functionPath: "./handler.ts",
      })
    ).toThrow(/must live under api\//);
  });

  it("emits regions array when provided", () => {
    const json = generateVercelEdgeConfig({
      projectName: "app",
      regions: ["iad1", "fra1"],
    });
    const parsed = JSON.parse(json) as { regions: string[] };
    expect(parsed.regions).toEqual(["iad1", "fra1"]);
  });

  it("rejects invalid region codes", () => {
    expect(() =>
      generateVercelEdgeConfig({ projectName: "app", regions: ["usa"] })
    ).toThrow(/not a valid Vercel region/);

    expect(() =>
      generateVercelEdgeConfig({ projectName: "app", regions: ["IAD1"] })
    ).toThrow(/not a valid Vercel region/);

    expect(() =>
      generateVercelEdgeConfig({ projectName: "app", regions: ["iad"] })
    ).toThrow(/not a valid Vercel region/);
  });

  it("emits crons array when provided", () => {
    const json = generateVercelEdgeConfig({
      projectName: "app",
      crons: [
        { path: "/api/cron/daily", schedule: "0 0 * * *" },
        { path: "/api/cron/hourly", schedule: "0 * * * *" },
      ],
    });
    const parsed = JSON.parse(json) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(parsed.crons).toHaveLength(2);
    expect(parsed.crons[0]?.path).toBe("/api/cron/daily");
    expect(parsed.crons[1]?.schedule).toBe("0 * * * *");
  });

  it("rejects cron entries missing path or schedule", () => {
    expect(() =>
      generateVercelEdgeConfig({
        projectName: "app",
        crons: [{ path: "", schedule: "@daily" }],
      })
    ).toThrow(/requires both 'path' and 'schedule'/);

    expect(() =>
      generateVercelEdgeConfig({
        projectName: "app",
        crons: [{ path: "/api/cron", schedule: "" }],
      })
    ).toThrow(/requires both 'path' and 'schedule'/);
  });

  it("rejects cron paths that do not start with /", () => {
    expect(() =>
      generateVercelEdgeConfig({
        projectName: "app",
        crons: [{ path: "api/cron/daily", schedule: "0 0 * * *" }],
      })
    ).toThrow(/must start with "\/"/);
  });

  it("preserves user rewrites and always appends the catch-all at the end", () => {
    const json = generateVercelEdgeConfig({
      projectName: "app",
      rewrites: [
        { source: "/legacy/:path*", destination: "/new/:path*" },
      ],
    });
    const parsed = JSON.parse(json) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    expect(parsed.rewrites).toHaveLength(2);
    expect(parsed.rewrites[0]?.source).toBe("/legacy/:path*");
    expect(parsed.rewrites[1]?.source).toBe("/(.*)");
  });

  it("emits headers block when supplied", () => {
    const json = generateVercelEdgeConfig({
      projectName: "app",
      headers: [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "X-Frame-Options", value: "DENY" },
          ],
        },
      ],
    });
    const parsed = JSON.parse(json) as {
      headers: Array<{
        source: string;
        headers: Array<{ key: string; value: string }>;
      }>;
    };
    expect(parsed.headers).toHaveLength(1);
    expect(parsed.headers[0]?.headers).toHaveLength(2);
    expect(parsed.headers[0]?.headers[0]?.key).toBe("X-Content-Type-Options");
  });

  it("rejects invalid project names", () => {
    expect(() => generateVercelEdgeConfig({ projectName: "" })).toThrow(
      /projectName is required/
    );
    expect(() =>
      generateVercelEdgeConfig({ projectName: "UPPERCASE" })
    ).toThrow(/must match/);
    expect(() =>
      generateVercelEdgeConfig({ projectName: "spaces not allowed" })
    ).toThrow(/must match/);
    expect(() =>
      generateVercelEdgeConfig({ projectName: "../escape" })
    ).toThrow(/must match/);
  });

  it("produces a parseable JSON document", () => {
    const json = generateVercelEdgeConfig({ projectName: "x" });
    const parsed = JSON.parse(json);
    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();
  });
});
