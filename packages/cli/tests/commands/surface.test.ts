import { describe, expect, it } from "bun:test";
import {
  getAllCommandRegistrations,
  getOfficialCommandRegistrations,
} from "../../src/commands/registry";
import {
  COMMAND_SURFACE,
  OFFICIAL_COMMANDS,
  getCommandReplacement,
} from "../../src/commands/surface";

describe("CLI product surface", () => {
  it("classifies every canonical registry command exactly once", () => {
    const registered = getAllCommandRegistrations().map((command) => command.id).sort();
    const classified = Object.keys(COMMAND_SURFACE).sort();
    expect(classified).toEqual(registered);
  });

  it("keeps the official surface at exactly six commands", () => {
    expect(OFFICIAL_COMMANDS).toEqual([
      "create",
      "dev",
      "build",
      "start",
      "check",
      "agent",
    ]);
    expect(getOfficialCommandRegistrations().map((command) => command.id)).toEqual(
      OFFICIAL_COMMANDS,
    );
  });

  it("retires provider deployment with actionable replacements", () => {
    expect(COMMAND_SURFACE.deploy).toBe("retired");
    expect(COMMAND_SURFACE["deploy:plan"]).toBe("retired");
    expect(getCommandReplacement("deploy")).toContain("mandu build");
  });
});
