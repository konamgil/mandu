import { describe, expect, it } from "bun:test";
import { getLockfileGuidanceLines, LOCKFILE_COMMANDS } from "../../src/util/lockfile";

describe("lockfile util guidance", () => {
  it("returns guidance lines in stable order with all commands", () => {
    const lines = getLockfileGuidanceLines();

    // Verify all commands are present
    expect(lines).toEqual([
      expect.stringContaining(LOCKFILE_COMMANDS.update),
      expect.stringContaining(LOCKFILE_COMMANDS.diff),
      expect.stringContaining(LOCKFILE_COMMANDS.safeDev),
    ]);

    // Verify exact length (prevent accidental additions/removals)
    expect(lines).toHaveLength(3);
  });

  it("includes alternative bunx/bun commands", () => {
    const lines = getLockfileGuidanceLines();

    expect(lines[0]).toContain("bunx mandu lock");
    expect(lines[1]).toContain("bunx mandu lock --diff");
    expect(lines[2]).toContain("bun run dev:safe");
  });

  it("maintains consistent English labels", () => {
    const lines = getLockfileGuidanceLines();

    expect(lines[0]).toStartWith("Update lock:");
    expect(lines[1]).toStartWith("Diff check:");
    expect(lines[2]).toStartWith("Safe start:");
  });
});
