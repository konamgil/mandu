/**
 * MCP Profiles – category filtering & validation tests
 */
import { describe, it, expect } from "bun:test";
import {
  getProfileCategories,
  isValidProfile,
  PROFILE_CATEGORIES,
} from "../src/profiles";

describe("getProfileCategories", () => {
  it("minimal returns 4 categories", () => {
    const cats = getProfileCategories("minimal");
    expect(Array.isArray(cats)).toBe(true);
    expect(cats).toHaveLength(4);
    expect(cats).toContain("spec");
    expect(cats).toContain("guard");
  });

  it("standard returns 11 categories", () => {
    const cats = getProfileCategories("standard");
    expect(Array.isArray(cats)).toBe(true);
    expect(cats).toHaveLength(11);
    expect(cats).toContain("composite");
    expect(cats).toContain("kitchen");
  });

  it("full returns null (no filtering)", () => {
    expect(getProfileCategories("full")).toBeNull();
  });

  it("minimal is a strict subset of standard", () => {
    const min = getProfileCategories("minimal")!;
    const std = getProfileCategories("standard")!;
    for (const cat of min) expect(std).toContain(cat);
  });
});

describe("isValidProfile", () => {
  it("accepts minimal, standard, full", () => {
    expect(isValidProfile("minimal")).toBe(true);
    expect(isValidProfile("standard")).toBe(true);
    expect(isValidProfile("full")).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isValidProfile("invalid")).toBe(false);
    expect(isValidProfile("")).toBe(false);
    expect(isValidProfile("FULL")).toBe(false);
  });
});

describe("PROFILE_CATEGORIES record", () => {
  it("has exactly 3 profile keys", () => {
    expect(Object.keys(PROFILE_CATEGORIES)).toHaveLength(3);
  });
});
