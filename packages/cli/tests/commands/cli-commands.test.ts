// @ts-nocheck — CLI 통합 테스트
/**
 * CLI Commands Integration Tests
 */
import { describe, it, expect, afterAll } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

const CLI = path.resolve(import.meta.dir, "../../src/main.ts");

async function runCLI(args: string, cwd?: string): Promise<string> {
  const proc = Bun.spawn(["bun", CLI, ...args.split(" ")], {
    cwd: cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return text + err;
}

describe("mandu info", () => {
  it("prints version and environment", async () => {
    const output = await runCLI("info");
    expect(output).toContain("Mandu Info");
    expect(output).toContain("Bun:");
    expect(output).toContain("OS:");
  });
});

describe("mandu clean", () => {
  it("handles missing .mandu gracefully", async () => {
    const output = await runCLI("clean");
    expect(output).toContain("Clean");
  });
});

describe("mandu cache", () => {
  it("stats shows kitchen guidance", async () => {
    const output = await runCLI("cache stats");
    expect(output).toContain("__kitchen");
  });
});

describe("mandu mcp", () => {
  it("lists tools", async () => {
    const output = await runCLI("mcp --list");
    expect(output).toContain("MCP Tools");
  });
});

describe("mandu scaffold", () => {
  const tmpDir = path.join(os.tmpdir(), `mandu-cli-test-${Date.now()}`);

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("generates middleware.ts", async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const output = await runCLI("scaffold middleware", tmpDir);
    expect(output).toContain("middleware.ts");
    const exists = await Bun.file(path.join(tmpDir, "middleware.ts")).exists();
    expect(exists).toBe(true);
  });

  it("does not overwrite existing files", async () => {
    const output = await runCLI("scaffold middleware", tmpDir);
    expect(output).toContain("already exists");
  });
});
