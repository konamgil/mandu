/**
 * MCP Profiles – category filtering & validation tests
 */
import { describe, it, expect } from "bun:test";
import {
  getProfileCategories,
  isValidProfile,
  PROFILE_CATEGORIES,
  resolveMcpProfile,
} from "../src/profiles";

describe("getProfileCategories", () => {
  it("agent-core returns only official agent categories", () => {
    const cats = getProfileCategories("agent-core");
    expect(Array.isArray(cats)).toBe(true);
    expect(cats).toEqual(["agent", "docs"]);
  });

  it("agent-full returns official and domain categories", () => {
    const cats = getProfileCategories("agent-full");
    expect(Array.isArray(cats)).toBe(true);
    expect(cats).toHaveLength(11);
    expect(cats).toContain("agent");
    expect(cats).toContain("spec");
    expect(cats).toContain("guard");
    expect(cats).toContain("contract");
  });

  it("internal returns null (no filtering)", () => {
    expect(getProfileCategories("internal")).toBeNull();
  });

  it("agent-core is a strict subset of agent-full", () => {
    const core = getProfileCategories("agent-core")!;
    const full = getProfileCategories("agent-full")!;
    for (const cat of core) expect(full).toContain(cat);
  });
});

describe("isValidProfile", () => {
  it("accepts agent-core, agent-full, internal", () => {
    expect(isValidProfile("agent-core")).toBe(true);
    expect(isValidProfile("agent-full")).toBe(true);
    expect(isValidProfile("internal")).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isValidProfile("invalid")).toBe(false);
    expect(isValidProfile("")).toBe(false);
    expect(isValidProfile("full")).toBe(false);
  });
});

describe("resolveMcpProfile", () => {
  it("defaults to agent-core", () => {
    expect(resolveMcpProfile(undefined)).toBe("agent-core");
    expect(resolveMcpProfile("invalid")).toBe("agent-core");
  });

  it("maps legacy profile names to the consolidated profiles", () => {
    expect(resolveMcpProfile("minimal")).toBe("agent-core");
    expect(resolveMcpProfile("standard")).toBe("agent-full");
    expect(resolveMcpProfile("full")).toBe("internal");
  });
});

describe("PROFILE_CATEGORIES record", () => {
  it("has exactly 3 profile keys", () => {
    expect(Object.keys(PROFILE_CATEGORIES)).toHaveLength(3);
  });
});
