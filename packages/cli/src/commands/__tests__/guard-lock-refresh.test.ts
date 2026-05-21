import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  validateConfig,
} from "@mandujs/core";
import {
  generateLockfile,
  readLockfile,
  validateLockfile,
  writeLockfile,
} from "@mandujs/core/lockfile";
import { guardArch } from "../guard-arch";

let tmpRoot: string | null = null;
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  }
});

describe("mandu guard lock refresh", () => {
  it("refreshes a stale existing guard lock before a local one-shot guard run", async () => {
    const root = await createProjectRoot();
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const ok = true;\n");
    await writeConfig(root, { server: { port: 3333 } });

    const oldConfig = await loadValidatedConfig(root);
    const oldLockfile = generateLockfile(oldConfig, { includeSnapshot: true });
    await writeLockfile(root, oldLockfile);

    await writeConfig(root, { server: { port: 4444 } });
    process.chdir(root);

    const ok = await guardArch({ ci: false, format: "console", quiet: true });

    expect(ok).toBe(true);
    const newConfig = await loadValidatedConfig(root);
    const newLockfile = await readLockfile(root);
    expect(newLockfile?.configHash).not.toBe(oldLockfile.configHash);
    expect(validateLockfile(newConfig, newLockfile!).valid).toBe(true);
  });
});

async function createProjectRoot(): Promise<string> {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-guard-lock-refresh-"));
  return tmpRoot;
}

async function writeConfig(
  root: string,
  config: Record<string, unknown>,
): Promise<void> {
  await fs.writeFile(
    path.join(root, "mandu.config.json"),
    JSON.stringify(config, null, 2),
  );
}

async function loadValidatedConfig(root: string): Promise<Record<string, unknown>> {
  const result = await validateConfig(root);
  if (!result.valid || !result.config) {
    throw new Error("test fixture config did not validate");
  }
  return result.config;
}
