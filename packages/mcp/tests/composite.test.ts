/**
 * Composite Tools – structure & definition tests
 */
import { describe, it, expect } from "bun:test";
import { compositeToolDefinitions, compositeTools } from "../src/tools/composite";

const EXPECTED_NAMES = [
  "mandu.feature.create",
  "mandu.diagnose",
  "mandu.island.add",
  "mandu.middleware.add",
  "mandu.test.route",
  "mandu.deploy.check",
  "mandu.cache.manage",
] as const;

describe("compositeToolDefinitions", () => {
  it("is an array of 7 tools", () => {
    expect(Array.isArray(compositeToolDefinitions)).toBe(true);
    expect(compositeToolDefinitions).toHaveLength(7);
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
  it("returns a map with all 7 handler functions", () => {
    const handlers = compositeTools("/fake/root");
    for (const n of EXPECTED_NAMES) {
      expect(typeof handlers[n]).toBe("function");
    }
    expect(Object.keys(handlers)).toHaveLength(7);
  });
});
