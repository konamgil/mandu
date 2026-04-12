/**
 * MCP Prompts – definition structure & handler tests
 */
import { describe, it, expect } from "bun:test";
import { manduPrompts, getPromptResult } from "../src/prompts";

describe("manduPrompts", () => {
  it("is an array of 3 prompts", () => {
    expect(Array.isArray(manduPrompts)).toBe(true);
    expect(manduPrompts).toHaveLength(3);
  });

  it("contains new-feature, debug, add-crud", () => {
    const names = manduPrompts.map((p) => p.name);
    expect(names).toContain("new-feature");
    expect(names).toContain("debug");
    expect(names).toContain("add-crud");
  });

  it("each prompt has name, description, arguments", () => {
    for (const p of manduPrompts) {
      expect(typeof p.name).toBe("string");
      expect(typeof p.description).toBe("string");
      expect(Array.isArray(p.arguments)).toBe(true);
    }
  });

  it("new-feature requires description argument", () => {
    const nf = manduPrompts.find((p) => p.name === "new-feature")!;
    const descArg = nf.arguments!.find((a) => a.name === "description");
    expect(descArg).toBeDefined();
    expect(descArg!.required).toBe(true);
  });
});

describe("getPromptResult", () => {
  it("new-feature returns messages with user role", () => {
    const result = getPromptResult("new-feature", { description: "test" });
    expect(result).not.toBeNull();
    expect(Array.isArray(result!.messages)).toBe(true);
    expect(result!.messages[0].role).toBe("user");
    expect((result!.messages[0].content as { text: string }).text).toContain("test");
  });

  it("debug works without symptom arg", () => {
    const result = getPromptResult("debug", {});
    expect(result).not.toBeNull();
    expect(result!.messages).toHaveLength(1);
  });

  it("add-crud capitalizes resource name in output", () => {
    const result = getPromptResult("add-crud", { resource: "products" });
    expect(result).not.toBeNull();
    const text = (result!.messages[0].content as { text: string }).text;
    expect(text).toContain("Products");
    expect(text).toContain("products");
  });

  it("unknown prompt returns null", () => {
    expect(getPromptResult("nonexistent", {})).toBeNull();
  });
});
