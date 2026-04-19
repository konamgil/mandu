/**
 * deno.json generator tests.
 *
 * Focus on byte-level output correctness. Deno itself validates the
 * result during `deno task dev` / `deployctl deploy`, which we cover in
 * the demo starter.
 */

import { describe, it, expect } from "bun:test";
import { generateDenoConfig } from "../src/deno/deno-config";

describe("generateDenoConfig", () => {
  it("emits a minimal valid config with just projectName", () => {
    const json = generateDenoConfig({ projectName: "my-app" });
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed.$schema).toBeDefined();
    const tasks = parsed.tasks as Record<string, string>;
    expect(tasks.dev).toContain(".mandu/deno/server.ts");
    expect(tasks.deploy).toContain("--project=my-app");
    expect(tasks.deploy).toContain("deployctl deploy");

    const deploy = parsed.deploy as Record<string, unknown>;
    expect(deploy.project).toBe("my-app");
    expect(deploy.entrypoint).toBe(".mandu/deno/server.ts");

    const compiler = parsed.compilerOptions as Record<string, unknown>;
    expect(compiler.jsx).toBe("react-jsx");
    expect(compiler.jsxImportSource).toBe("react");
    expect(compiler.strict).toBe(true);

    expect(json.endsWith("\n")).toBe(true);
  });

  it("emits an imports map with Mandu default npm: specifiers", () => {
    const json = generateDenoConfig({ projectName: "app" });
    const parsed = JSON.parse(json) as { imports: Record<string, string> };

    expect(parsed.imports["@mandujs/core"]).toBe("npm:@mandujs/core");
    expect(parsed.imports["@mandujs/edge"]).toBe("npm:@mandujs/edge");
    expect(parsed.imports["react"]).toContain("npm:react");
    expect(parsed.imports["react-dom"]).toContain("npm:react-dom");
  });

  it("merges user-supplied imports on top of the defaults", () => {
    const json = generateDenoConfig({
      projectName: "app",
      imports: {
        "@scope/foo": "npm:@scope/foo@1.2.3",
        // User can override one of our defaults
        react: "npm:react@19.0.1",
      },
    });
    const parsed = JSON.parse(json) as { imports: Record<string, string> };
    expect(parsed.imports["@scope/foo"]).toBe("npm:@scope/foo@1.2.3");
    expect(parsed.imports["react"]).toBe("npm:react@19.0.1");
    // Defaults not overridden are still present.
    expect(parsed.imports["@mandujs/core"]).toBe("npm:@mandujs/core");
  });

  it("overrides the entry path when provided", () => {
    const json = generateDenoConfig({
      projectName: "app",
      entry: "./server/main.ts",
    });
    const parsed = JSON.parse(json) as {
      tasks: Record<string, string>;
      deploy: { entrypoint: string };
    };
    expect(parsed.tasks.dev).toContain("./server/main.ts");
    expect(parsed.deploy.entrypoint).toBe("./server/main.ts");
  });

  it("writes cron triggers when provided", () => {
    const json = generateDenoConfig({
      projectName: "app",
      crons: [
        { name: "cleanup", schedule: "@daily" },
        { name: "warmup", schedule: "0 */5 * * *" },
      ],
    });
    const parsed = JSON.parse(json) as {
      deploy: { cron: Array<{ name: string; schedule: string }> };
    };
    expect(Array.isArray(parsed.deploy.cron)).toBe(true);
    expect(parsed.deploy.cron).toHaveLength(2);
    expect(parsed.deploy.cron[0]).toEqual({ name: "cleanup", schedule: "@daily" });
    expect(parsed.deploy.cron[1]).toEqual({ name: "warmup", schedule: "0 */5 * * *" });
  });

  it("rejects cron entries missing name or schedule", () => {
    expect(() =>
      generateDenoConfig({
        projectName: "app",
        crons: [{ name: "", schedule: "@daily" }],
      })
    ).toThrow(/requires both 'name' and 'schedule'/);

    expect(() =>
      generateDenoConfig({
        projectName: "app",
        crons: [{ name: "cleanup", schedule: "" }],
      })
    ).toThrow(/requires both 'name' and 'schedule'/);
  });

  it("honors custom exclude patterns", () => {
    const json = generateDenoConfig({
      projectName: "app",
      exclude: ["custom/", "scratch/"],
    });
    const parsed = JSON.parse(json) as {
      exclude: string[];
      deploy: { exclude: string[] };
    };
    expect(parsed.exclude).toEqual(["custom/", "scratch/"]);
    expect(parsed.deploy.exclude).toEqual(["custom/", "scratch/"]);
  });

  it("rejects invalid project names (security / deployctl compatibility)", () => {
    expect(() => generateDenoConfig({ projectName: "" })).toThrow(
      /projectName is required/
    );
    expect(() =>
      generateDenoConfig({ projectName: "UPPERCASE" })
    ).toThrow(/must match/);
    expect(() =>
      generateDenoConfig({ projectName: "spaces not allowed" })
    ).toThrow(/must match/);
    expect(() =>
      generateDenoConfig({ projectName: "../escape" })
    ).toThrow(/must match/);
  });

  it("produces a parseable JSON document", () => {
    const json = generateDenoConfig({ projectName: "x" });
    // No throw means it parsed correctly.
    const parsed = JSON.parse(json);
    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();
  });
});
