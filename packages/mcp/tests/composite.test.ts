/**
 * Composite Tools – structure & definition tests
 */
import { describe, it, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { compositeToolDefinitions, compositeTools } from "../src/tools/composite";

const EXPECTED_NAMES = [
  "mandu.feature.create",
  "mandu.diagnose",
  "mandu.island.add",
  "mandu.middleware.add",
  "mandu.deploy.check",
  "mandu.cache.manage",
] as const;

describe("compositeToolDefinitions", () => {
  it("is an array of 6 product tools", () => {
    expect(Array.isArray(compositeToolDefinitions)).toBe(true);
    expect(compositeToolDefinitions).toHaveLength(6);
  });

  it("contains all expected tool names", () => {
    const names = compositeToolDefinitions.map((t) => t.name);
    for (const n of EXPECTED_NAMES) expect(names).toContain(n);
  });

  it("each definition has name, description, inputSchema, annotations", () => {
    for (const def of compositeToolDefinitions) {
      expect(typeof def.name).toBe("string");
      expect(typeof def.description).toBe("string");
      expect(def.inputSchema).toBeDefined();
      expect(def.inputSchema.type).toBe("object");
      expect(def.annotations).toBeDefined();
    }
  });

  it("feature.create has destructiveHint true", () => {
    const fc = compositeToolDefinitions.find((t) => t.name === "mandu.feature.create")!;
    expect(fc.annotations!.destructiveHint).toBe(true);
    expect(fc.annotations!.readOnlyHint).toBe(false);
  });

  it("diagnose has readOnlyHint true", () => {
    const diag = compositeToolDefinitions.find((t) => t.name === "mandu.diagnose")!;
    expect(diag.annotations!.readOnlyHint).toBe(true);
  });

  it("middleware.add has destructiveHint false", () => {
    const mw = compositeToolDefinitions.find((t) => t.name === "mandu.middleware.add")!;
    expect(mw.annotations!.destructiveHint).toBe(false);
  });
});

describe("compositeTools()", () => {
  it("returns a map with all 6 product handler functions", () => {
    const handlers = compositeTools("/fake/root");
    for (const n of EXPECTED_NAMES) {
      expect(typeof handlers[n]).toBe("function");
    }
    expect(Object.keys(handlers)).toHaveLength(6);
  });

  it("mandu.island.add emits the supported @mandujs/core/client wrapper API", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mandu-mcp-island-"));
    try {
      const handlers = compositeTools(root);
      const result = await handlers["mandu.island.add"]({
        route: "home",
        name: "Counter",
        strategy: "visible",
      }) as { success: boolean; file: string };

      expect(result.success).toBe(true);
      const source = await readFile(path.join(root, result.file), "utf8");
      expect(source).toContain('import { wrapComponent } from "@mandujs/core/client"');
      expect(source).toContain("export default wrapComponent(CounterInner)");
      expect(source).not.toContain('island("visible"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
