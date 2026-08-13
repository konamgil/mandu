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
} from "@mandujs/core/compat/lockfile/index";
import { refreshStaleRuntimeLockfile } from "../lockfile";

let tmpRoot: string | null = null;

afterEach(async () => {
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  }
});

describe("refreshStaleRuntimeLockfile", () => {
  it("updates an existing stale guard lock in development mode", async () => {
    const root = await createProjectRoot();
    await writeConfig(root, { server: { port: 3333 } });

    const oldConfig = await loadValidatedConfig(root);
    const oldLockfile = generateLockfile(oldConfig, { includeSnapshot: true });
    await writeLockfile(root, oldLockfile);

    await writeConfig(root, { server: { port: 4444 } });

    const newConfig = await loadValidatedConfig(root);
    const result = await refreshStaleRuntimeLockfile(newConfig, root, {
      mode: "development",
    });

    expect(result.refreshed).toBe(true);
    expect(result.reason).toBe("refreshed");
    expect(result.previousHash).toBe(oldLockfile.configHash);

    const newLockfile = await readLockfile(root);
    expect(newLockfile).not.toBeNull();
    expect(validateLockfile(newConfig, newLockfile!).valid).toBe(true);
  });

  it("does not update a stale guard lock under CI policy", async () => {
    const root = await createProjectRoot();
    await writeConfig(root, { server: { port: 3333 } });

    const oldConfig = await loadValidatedConfig(root);
    const oldLockfile = generateLockfile(oldConfig, { includeSnapshot: true });
    await writeLockfile(root, oldLockfile);

    await writeConfig(root, { server: { port: 4444 } });

    const newConfig = await loadValidatedConfig(root);
    const result = await refreshStaleRuntimeLockfile(newConfig, root, {
      mode: "ci",
    });

    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe("policy-blocked");

    const unchangedLockfile = await readLockfile(root);
    expect(unchangedLockfile?.configHash).toBe(oldLockfile.configHash);
    expect(validateLockfile(newConfig, unchangedLockfile!).valid).toBe(false);
  });
});

async function createProjectRoot(): Promise<string> {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-lock-refresh-"));
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
