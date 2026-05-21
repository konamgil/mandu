import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { __test__, init, isAllowedTemplate } from "../../src/commands/init";
import {
  validateAndReport,
} from "@mandujs/core";
import {
  readLockfile,
  readMcpConfig,
  validateLockfile,
} from "@mandujs/core/lockfile";

describe("init command template validation", () => {
  const cwd = process.cwd();
  const tempDirs: string[] = [];

  afterEach(async () => {
    process.chdir(cwd);
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts known template names", () => {
    expect(isAllowedTemplate("default")).toBe(true);
    expect(isAllowedTemplate("realtime-chat")).toBe(true);
  });

  it("rejects unknown template names", () => {
    expect(isAllowedTemplate("../../etc/passwd")).toBe(false);
    expect(isAllowedTemplate("custom-template")).toBe(false);
  });

  it("rejects path traversal template input in init", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-init-test-"));
    tempDirs.push(dir);
    process.chdir(dir);

    const ok = await init({
      name: "sample-app",
      template: "../default",
    });

    expect(ok).toBe(false);
    await expect(fs.access(path.join(dir, "sample-app"))).rejects.toBeDefined();
  });
});

describe("init command mcp backup naming", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to timestamp backup when suffix attempts are exhausted", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-mcp-test-"));
    tempDirs.push(dir);

    const mcpPath = path.join(dir, ".mcp.json");
    await fs.writeFile(mcpPath, "{ invalid json");
    await fs.writeFile(`${mcpPath}.bak`, "existing");
    await fs.writeFile(`${mcpPath}.bak.1`, "existing");
    await fs.writeFile(`${mcpPath}.bak.2`, "existing");

    const result = await __test__.setupMcpConfig(dir, {
      maxBackupSuffixAttempts: 2,
    });

    expect(result.mcpJson.status).toBe("backed-up");
    expect(result.mcpJson.backupPath).toBeDefined();
    expect(result.mcpJson.backupPath?.startsWith(`${mcpPath}.bak.`)).toBe(true);
    expect(result.mcpJson.backupPath).not.toBe(`${mcpPath}.bak.1`);
    expect(result.mcpJson.backupPath).not.toBe(`${mcpPath}.bak.2`);

    const recreated = JSON.parse(await fs.readFile(mcpPath, "utf-8"));
    expect(recreated?.mcpServers?.mandu?.command).toBe("bunx");
  });

  it("creates .gemini/settings.json with mandu server", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-gemini-test-"));
    tempDirs.push(dir);

    const result = await __test__.setupMcpConfig(dir);

    expect(result.geminiJson.status).toBe("created");

    const geminiPath = path.join(dir, ".gemini", "settings.json");
    const content = JSON.parse(await fs.readFile(geminiPath, "utf-8"));
    expect(content.mcpServers.mandu.command).toBe("bunx");
    expect(content.mcpServers.mandu.args).toEqual(["mandu-mcp"]);
  });

  it("generates a lockfile that matches the validated project config", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-lock-test-"));
    tempDirs.push(dir);

    await fs.writeFile(
      path.join(dir, "mandu.config.json"),
      JSON.stringify({ server: { port: 3333 }, guard: { preset: "mandu" } }, null, 2),
    );
    await __test__.setupMcpConfig(dir);

    const result = await __test__.setupLockfile(dir);
    expect(result.success).toBe(true);

    const [config, lockfile, mcpConfig] = await Promise.all([
      validateAndReport(dir),
      readLockfile(dir),
      readMcpConfig(dir),
    ]);

    expect(config).not.toBeNull();
    expect(lockfile).not.toBeNull();
    const validation = validateLockfile(config!, lockfile!, mcpConfig);
    expect(validation.valid).toBe(true);
  });
});
