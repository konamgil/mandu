/**
 * CLI Commands: deploy, upgrade, completion, fix – integration tests
 */
import { describe, it, expect } from "bun:test";
import path from "path";

const CLI = path.resolve(import.meta.dir, "../../src/main.ts");

async function runCLI(args: string): Promise<string> {
  const proc = Bun.spawn(["bun", CLI, ...args.split(" ")], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return text + err;
}

describe("mandu deploy", () => {
  it("--help does not crash", async () => {
    const output = await runCLI("deploy --help");
    // Should not contain unhandled exception traces
    expect(output).not.toContain("TypeError");
    expect(output).not.toContain("ReferenceError");
  });
});

describe("mandu upgrade", () => {
  it("--check shows package table or connection error", async () => {
    const output = await runCLI("upgrade --check");
    // Either shows version info or fails gracefully on network issues
    const hasVersionInfo = output.includes("@mandujs") || output.includes("Installed");
    const hasGracefulError = output.includes("fetch failed") || output.includes("not installed");
    expect(hasVersionInfo || hasGracefulError).toBe(true);
  });
});

describe("mandu completion", () => {
  it("bash outputs a valid completion script", async () => {
    const output = await runCLI("completion bash");
    expect(output).toContain("mandu");
    expect(output).toContain("_mandu");
    expect(output).toContain("complete");
    expect(output).toContain("COMPREPLY");
  });

  it("zsh outputs a valid completion script", async () => {
    const output = await runCLI("completion zsh");
    expect(output).toContain("mandu");
    expect(output).toContain("compdef");
    expect(output).toContain("_mandu");
  });

  it("fish outputs a valid completion script", async () => {
    const output = await runCLI("completion fish");
    expect(output).toContain("mandu");
    expect(output).toContain("complete -c mandu");
  });

  it("unsupported shell prints error", async () => {
    const output = await runCLI("completion powershell");
    expect(output).toContain("Unsupported shell");
  });
});

describe("mandu fix", () => {
  it("prints the multi-stage fix report", async () => {
    const output = await runCLI("fix");
    expect(output).toContain("Mandu Fix");
    expect(output).toContain("Stage: guard-heal");
    expect(output).toContain("Stage: diagnose");
    expect(output).not.toContain("TypeError");
    expect(output).not.toContain("ReferenceError");
  });

  it("--json flag returns parseable stage output", async () => {
    const output = await runCLI("fix --json");
    const parsed = JSON.parse(output.trim());
    expect(Array.isArray(parsed.stages)).toBe(true);
    expect(parsed.stages.length).toBeGreaterThan(0);
    expect(typeof parsed.success).toBe("boolean");
  });
});
