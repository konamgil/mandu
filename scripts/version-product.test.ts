import { describe, expect, test } from "bun:test";
import { changesetPackages, classifyChangeset } from "./version-product";

const changeset = (entries: string) => `---\n${entries}\n---\n\nSummary.\n`;

describe("product changeset partitioning", () => {
  test("recognizes Product-only changesets", () => {
    const contents = changeset('"@mandujs/core": minor\n"@mandujs/cli": patch');
    expect(changesetPackages(contents)).toEqual(["@mandujs/core", "@mandujs/cli"]);
    expect(classifyChangeset(contents)).toBe("product");
  });

  test("recognizes non-Product changesets", () => {
    expect(classifyChangeset(changeset('"@mandujs/skills": minor'))).toBe("other");
  });

  test("rejects mixed release trains", () => {
    const contents = changeset('"@mandujs/mcp": minor\n"@mandujs/skills": minor');
    expect(classifyChangeset(contents)).toBe("mixed");
  });
});
