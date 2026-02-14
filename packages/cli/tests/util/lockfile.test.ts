import { describe, expect, it } from "bun:test";
import { getLockfileGuidanceLines, LOCKFILE_COMMANDS } from "../../src/util/lockfile";

describe("lockfile util guidance", () => {
  it("returns demo-safe and lock guidance in stable order", () => {
    const lines = getLockfileGuidanceLines();

    expect(lines).toEqual([
      expect.stringContaining(LOCKFILE_COMMANDS.update),
      expect.stringContaining(LOCKFILE_COMMANDS.diff),
      expect.stringContaining(LOCKFILE_COMMANDS.safeDev),
    ]);
  });
});
