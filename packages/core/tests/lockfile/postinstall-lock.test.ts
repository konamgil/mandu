import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateConfig } from "../../src/config/validate.js";
import {
  generateLockfile,
  readLockfile,
  validateLockfile,
  writeLockfile,
} from "../../src/lockfile/index.js";
import { refreshGuardLockAfterInstall } from "../../scripts/postinstall-lock.js";

let tmpRoot: string | null = null;

afterEach(async () => {
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  }
});

describe("refreshGuardLockAfterInstall", () => {
  it("refreshes an existing guard lock after a package update", async () => {
    const root = await createProjectRoot();
    await writeConfig(root, { server: { port: 3333 } });

    const oldConfig = await loadValidatedConfig(root);
    const oldLockfile = generateLockfile(oldConfig, {
      includeSnapshot: true,
      includeMcpServerHashes: true,
    });
    await writeLockfile(root, oldLockfile);

    await writeConfig(root, { server: { port: 4444 } });

    const result = await refreshGuardLockAfterInstall({
      projectRoot: root,
      env: {},
      log: () => {},
      warn: () => {},
    });

    expect(result.action).toBe("updated");
    expect(result.hash).not.toBe(oldLockfile.configHash);

    const newConfig = await loadValidatedConfig(root);
    const newLockfile = await readLockfile(root);
    expect(newLockfile).not.toBeNull();
    expect(newLockfile?.snapshot).toBeDefined();
    expect(validateLockfile(newConfig, newLockfile!).valid).toBe(true);
  });

  it("does not create a guard lock for projects that have not opted in", async () => {
    const root = await createProjectRoot();
    await writeConfig(root, { server: { port: 3333 } });

    const result = await refreshGuardLockAfterInstall({
      projectRoot: root,
      env: {},
      log: () => {},
      warn: () => {},
    });

    expect(result.action).toBe("skipped-no-lockfile");
    expect(await readLockfile(root)).toBeNull();
  });
});

async function createProjectRoot(): Promise<string> {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-postinstall-lock-"));
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
