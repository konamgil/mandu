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

async function runCommand(command: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(["bun", CLI, ...command], {
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
  it("stats reports server and kitchen status", async () => {
    const output = await runCLI("cache stats");
    expect(output).toContain("Cache Status");
    expect(output).toContain("Server:");
  });

  it("stats --json returns structured output", async () => {
    const output = await runCLI("cache stats --json");
    const parsed = JSON.parse(output.trim());
    expect(parsed.action).toBe("stats");
    expect(typeof parsed.serverStatus).toBe("string");
  });

  it("clear prints the requested target", async () => {
    const output = await runCLI("cache clear /products");
    expect(output).toContain("Cache Clear Request");
    expect(output).toContain("Target: path=/products");
  });
});

describe("mandu cache runtime control", () => {
  const tmpDir = path.join(os.tmpdir(), `mandu-cache-control-${Date.now()}`);
  let server: ReturnType<typeof Bun.serve> | null = null;

  afterAll(async () => {
    server?.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("uses runtime-control.json to talk to the running server", async () => {
    await fs.mkdir(path.join(tmpDir, ".mandu"), { recursive: true });

    server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname !== "/_mandu/cache") {
          return new Response("not found", { status: 404 });
        }
        if (req.headers.get("x-mandu-control-token") !== "secret-token") {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        if (req.method === "GET") {
          return Response.json({
            enabled: true,
            message: "Runtime cache is available.",
            stats: {
              entries: 2,
              maxEntries: 1000,
              staleEntries: 1,
              hitRate: 0.5,
            },
          });
        }

        if (req.method === "POST") {
          return Response.json({
            enabled: true,
            target: "path=/products",
            cleared: 1,
            stats: {
              entries: 1,
              maxEntries: 1000,
            },
          });
        }

        return new Response("method not allowed", { status: 405 });
      },
    });

    await fs.writeFile(
      path.join(tmpDir, ".mandu", "runtime-control.json"),
      JSON.stringify({
        mode: "dev",
        port: server.port,
        token: "secret-token",
        baseUrl: `http://localhost:${server.port}`,
        startedAt: new Date().toISOString(),
      }, null, 2)
    );

    const statsOutput = await runCLI("cache stats", tmpDir);
    expect(statsOutput).toContain("Mode: dev");
    expect(statsOutput).toContain("Entries: 2/1000");
    expect(statsOutput).toContain("Hit rate: 50%");

    const clearOutput = await runCLI("cache clear /products", tmpDir);
    expect(clearOutput).toContain("Target: path=/products");
    expect(clearOutput).toContain("Cleared: 1");
    expect(clearOutput).toContain("Remaining entries: 1/1000");
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
    expect(output).toContain("cache");
    expect(output).toContain("middleware");
    expect(output).toContain("auth");
    expect(output).toContain("collection");
    expect(output).toContain("review");
    expect(output).toContain("ask");
    expect(output).toContain("fix");
    expect(output).toContain("deploy");
    expect(output).toContain("upgrade");
    expect(output).toContain("completion");
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

describe("AI workflow commands", () => {
  const tmpDir = path.join(os.tmpdir(), `mandu-cli-ai-${Date.now()}`);

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("ask provides actionable fallback guidance", async () => {
    const output = await runCLI("ask auth");
    expect(output).toContain("Relevant commands:");
    expect(output).toContain("mandu auth init --strategy=jwt");
  });

  it("review handles a simple git repo gracefully", async () => {
    const repoDir = path.join(tmpDir, "review-repo");
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "README.md"), "# Demo\n");
    await Bun.spawn(["git", "init"], { cwd: repoDir, stdout: "ignore", stderr: "ignore" }).exited;
    await Bun.spawn(["git", "config", "user.email", "test@example.com"], { cwd: repoDir, stdout: "ignore", stderr: "ignore" }).exited;
    await Bun.spawn(["git", "config", "user.name", "Test User"], { cwd: repoDir, stdout: "ignore", stderr: "ignore" }).exited;
    await Bun.spawn(["git", "add", "README.md"], { cwd: repoDir, stdout: "ignore", stderr: "ignore" }).exited;
    await Bun.spawn(["git", "commit", "-m", "init"], { cwd: repoDir, stdout: "ignore", stderr: "ignore" }).exited;
    await fs.writeFile(path.join(repoDir, "README.md"), "# Demo\n\nUpdated\n");

    const output = await runCLI("review", repoDir);
    expect(output).toContain("Changed files:");
    expect(output).toContain("README.md");
  });

  it("generate --ai supports dry-run planning", async () => {
    const aiDir = path.join(tmpDir, "ai-generate");
    await fs.mkdir(aiDir, { recursive: true });
    const output = await runCommand(["generate", "page", "dashboard", "--ai", "analytics", "--dry-run"], aiDir);
    expect(output).toContain("AI Generation Plan");
    expect(output).toContain("Feature: dashboard");
  });
});
