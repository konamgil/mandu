/**
 * Per-subcommand `--help` routing (Wave R3 follow-up).
 *
 * Pre-fix behaviour: `mandu <cmd> --help` fell through to the global help
 * block because `main.ts:91` treated `options.help` as unconditional global.
 *
 * After-fix behaviour:
 *   - `mandu <cmd> --help`              → per-command help block (CommandRegistration.help)
 *   - `mandu <cmd> <sub> --help`        → falls through to sub-dispatch, which
 *                                         renders its own help if it handles it
 *                                         (e.g. ai/chat, ai/eval).
 *   - Unknown-command + --help          → global help (graceful fallback).
 */
import { describe, it, expect } from "bun:test";
import path from "path";

const CLI = path.resolve(import.meta.dir, "../../src/main.ts");

async function runCLI(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("per-subcommand --help routing", () => {
  it("mandu ai --help points to the Labs and stable agent paths", async () => {
    const { stdout, exitCode } = await runCLI("ai", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("optional AI playground (Labs)");
    expect(stdout).toContain("@mandujs/ate");
    expect(stdout).toContain("mandu agent plan");
    // Global help markers must NOT be present.
    expect(stdout).not.toContain("Command Groups:");
  });

  it("mandu db --help prints the db help block (not global)", async () => {
    const { stdout, exitCode } = await runCLI("db", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("mandu db");
    expect(stdout).toContain("plan");
    expect(stdout).toContain("apply");
    expect(stdout).toContain("status");
    expect(stdout).toContain("reset");
    expect(stdout).toContain("seed");
    expect(stdout).not.toContain("Command Groups:");
  });

  it("mandu mcp --help prints the mcp help block", async () => {
    const { stdout, exitCode } = await runCLI("mcp", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("mandu mcp");
    expect(stdout).toContain("register");
    expect(stdout).not.toContain("Command Groups:");
  });

  it("mandu deploy --help explains the retired provider surface", async () => {
    const { stdout, exitCode } = await runCLI("deploy", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("mandu deploy");
    expect(stdout).toContain("retired");
    expect(stdout).toContain("mandu build");
    expect(stdout).toContain("artifact-contract.md");
    expect(stdout).not.toContain("Command Groups:");
  });

  it("mandu upgrade --help prints the upgrade help block", async () => {
    const { stdout, exitCode } = await runCLI("upgrade", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("mandu upgrade");
    expect(stdout).toContain("--check");
    expect(stdout).toContain("--rollback");
    expect(stdout).not.toContain("Command Groups:");
  });

  it("mandu test --help prints the test help block", async () => {
    const { stdout, exitCode } = await runCLI("test", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("mandu test");
    expect(stdout).toContain("Subcommands:");
    expect(stdout).toContain("unit");
    expect(stdout).toContain("integration");
    expect(stdout).toContain("--coverage");
    expect(stdout).not.toContain("Command Groups:");
  });

  it("mandu build --help prints the build help block", async () => {
    const { stdout, exitCode } = await runCLI("build", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("mandu build");
    expect(stdout).toContain("--watch");
    expect(stdout).not.toContain("--target=<name>");
    expect(stdout).not.toContain("Command Groups:");
  });

  it("mandu dev --help prints the dev help block", async () => {
    const { stdout, exitCode } = await runCLI("dev", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("mandu dev");
    expect(stdout).toContain("--port=");
    expect(stdout).toContain("--open");
    expect(stdout).not.toContain("Command Groups:");
  });

  it("mandu ai chat --help does not load the Labs chat runtime", async () => {
    const { stdout, exitCode } = await runCLI("ai", "chat", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("optional AI playground (Labs)");
    expect(stdout).toContain("mandu agent plan");
    expect(stdout).not.toContain("Slash commands:");
  });

  it("mandu ai eval --help does not load the Labs eval runtime", async () => {
    const { stdout, exitCode } = await runCLI("ai", "eval", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("optional AI playground (Labs)");
    expect(stdout).toContain("mandu agent plan");
    expect(stdout).not.toContain("prompt eval");
  });

  it("mandu --help still prints the global help block", async () => {
    const { stdout, exitCode } = await runCLI("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Command Groups:");
  });
});
