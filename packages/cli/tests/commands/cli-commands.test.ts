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
    expect(output).toContain("Node:");
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

  it("clear prints the requested path", async () => {
    const output = await runCLI("cache clear /products");
    expect(output).toContain("cache clear /products");
  });
});

describe("mandu mcp", () => {
  it("lists tools", async () => {
    const output = await runCLI("mcp --list");
    expect(output).toContain("MCP Tools");
  });
});

describe("mandu help", () => {
  it("renders the semantic help output", async () => {
    const output = await runCLI("--help");
    expect(output).toContain("middleware");
    expect(output).toContain("auth");
    expect(output).toContain("collection");
    expect(output).toContain("fix");
    expect(output).toContain("Command Groups:");
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

describe("CLI aliases", () => {
  const tmpDir = path.join(os.tmpdir(), `mandu-cli-alias-${Date.now()}`);

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("middleware init supports presets", async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    const output = await runCLI("middleware init --preset jwt", tmpDir);
    expect(output).toContain("middleware.ts");
    const content = await Bun.file(path.join(tmpDir, "middleware.ts")).text();
    expect(content).toContain("Bearer");
  });

  it("session init creates a session helper", async () => {
    const output = await runCLI("session init", tmpDir);
    expect(output).toContain("src/server/session.ts");
    const exists = await Bun.file(path.join(tmpDir, "src", "server", "session.ts")).exists();
    expect(exists).toBe(true);
    const envExists = await Bun.file(path.join(tmpDir, ".env.example")).exists();
    expect(envExists).toBe(true);
  });

  it("ws command creates a WebSocket route", async () => {
    const output = await runCLI("ws chat", tmpDir);
    expect(output).toContain("app/api/chat/route.ts");
    const exists = await Bun.file(path.join(tmpDir, "app", "api", "chat", "route.ts")).exists();
    expect(exists).toBe(true);
  });

  it("auth init scaffolds JWT auth with env guidance", async () => {
    const authDir = path.join(tmpDir, "auth-project");
    await fs.mkdir(authDir, { recursive: true });
    const output = await runCLI("auth init --strategy=jwt", authDir);
    expect(output).toContain("src/server/auth.ts");
    expect(output).toContain(".env.example");
    expect(await Bun.file(path.join(authDir, "src", "server", "auth.ts")).exists()).toBe(true);
    expect(await Bun.file(path.join(authDir, "app", "api", "auth", "login", "route.ts")).exists()).toBe(true);
    expect(await Bun.file(path.join(authDir, "app", "api", "auth", "register", "route.ts")).exists()).toBe(true);
    expect(await Bun.file(path.join(authDir, "app", "api", "auth", "logout", "route.ts")).exists()).toBe(true);
    expect(await Bun.file(path.join(authDir, "middleware.ts")).exists()).toBe(true);
    const env = await Bun.file(path.join(authDir, ".env.example")).text();
    expect(env).toContain("JWT_SECRET=");
  });

  it("collection create scaffolds markdown content", async () => {
    const contentDir = path.join(tmpDir, "content-project");
    await fs.mkdir(contentDir, { recursive: true });
    const output = await runCLI("collection create blog --schema=markdown", contentDir);
    expect(output).toContain("content/blog/hello-world.md");
    expect(output).toContain("content.config.ts");
    expect(await Bun.file(path.join(contentDir, "content", "blog", "hello-world.md")).exists()).toBe(true);
    expect(await Bun.file(path.join(contentDir, "content.config.ts")).exists()).toBe(true);
    const config = await Bun.file(path.join(contentDir, "content.config.ts")).text();
    expect(config).toContain("\"blog\": defineCollection");
  });
});

describe("mandu explain", () => {
  it("formats a guard explanation", async () => {
    const output = await runCLI("explain layer-violation --from client --to server");
    expect(output).toContain("Why:");
    expect(output).toContain("How To Fix:");
  });
});
