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
    expect(cats).toHaveLength(20);
    // Official agent loop
    expect(cats).toContain("agent");
    expect(cats).toContain("docs");
    // Generation / scaffolding
    expect(cats).toContain("spec");
    expect(cats).toContain("generate");
    expect(cats).toContain("composite");
    // Domain primitives
    expect(cats).toContain("slot");
    expect(cats).toContain("slot-validation");
    expect(cats).toContain("hydration");
    expect(cats).toContain("contract");
    expect(cats).toContain("design");
    expect(cats).toContain("seo");
    // Quality / validation
    expect(cats).toContain("guard");
    expect(cats).toContain("lint");
    expect(cats).toContain("run-tests");
    expect(cats).toContain("ate");
    // Deploy
    expect(cats).toContain("deploy-plan");
    expect(cats).toContain("deploy-preview");
    // AI refactor
    expect(cats).toContain("refactor-barrel");
    expect(cats).toContain("refactor-routes");
    expect(cats).toContain("refactor-contract");
  });

  it("agent-full excludes internal plumbing categories", () => {
    const cats = getProfileCategories("agent-full")!;
    // State/transaction internals should NOT leak into agent-full
    expect(cats).not.toContain("transaction");
    expect(cats).not.toContain("history");
    expect(cats).not.toContain("decisions");
    expect(cats).not.toContain("negotiate");
    // Runtime/project introspection stays internal
    expect(cats).not.toContain("brain");
    expect(cats).not.toContain("runtime");
    expect(cats).not.toContain("project");
    // Specialized ATE phases stay internal (core "ate" is exposed)
    expect(cats).not.toContain("ate-oracle-replay");
    expect(cats).not.toContain("ate-mutate");
    expect(cats).not.toContain("ate-mutation-report");
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
