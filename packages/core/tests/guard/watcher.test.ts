/**
 * Guard Watcher Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  createGuardWatcher,
  checkFile,
  checkDirectory,
  clearAnalysisCache,
} from "../../src/guard/watcher";
import type { GuardConfig, Violation } from "../../src/guard/types";

describe("checkFile", () => {
  const testDir = join(tmpdir(), "mandu-guard-test-" + Date.now());

  beforeEach(async () => {
    await mkdir(join(testDir, "src/features/auth"), { recursive: true });
    await mkdir(join(testDir, "src/widgets/header"), { recursive: true });
    await mkdir(join(testDir, "src/shared/ui"), { recursive: true });
    await mkdir(join(testDir, "src/entities/user"), { recursive: true });
    clearAnalysisCache();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should detect layer violations", async () => {
    const filePath = join(testDir, "src/features/auth/login.tsx");
    const content = `
import { Header } from '@/widgets/header';

export function LoginForm() {
  return <div><Header /></div>;
}
    `;
    await writeFile(filePath, content);

    const config: GuardConfig = { preset: "fsd" };
    const violations = await checkFile(filePath, config, testDir);

    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("layer-violation");
    expect(violations[0].fromLayer).toBe("features");
    expect(violations[0].toLayer).toBe("widgets");
  });

  it("should pass valid imports", async () => {
    const filePath = join(testDir, "src/features/auth/login.tsx");
    const content = `
import { Button } from '@/shared/ui';
import { User } from '@/entities/user';

export function LoginForm() {
  return <div><Button /><User /></div>;
}
    `;
    await writeFile(filePath, content);

    const config: GuardConfig = { preset: "fsd" };
    const violations = await checkFile(filePath, config, testDir);

    expect(violations).toHaveLength(0);
  });

  it("should ignore external modules", async () => {
    const filePath = join(testDir, "src/features/auth/login.tsx");
    const content = `
import { useState } from 'react';
import lodash from 'lodash';

export function LoginForm() {
  return <div>Hello</div>;
}
    `;
    await writeFile(filePath, content);

    const config: GuardConfig = { preset: "fsd" };
    const violations = await checkFile(filePath, config, testDir);

    expect(violations).toHaveLength(0);
  });
});

describe("checkDirectory", () => {
  const testDir = join(tmpdir(), "mandu-guard-dir-test-" + Date.now());

  beforeEach(async () => {
    await mkdir(join(testDir, "src/features/auth"), { recursive: true });
    await mkdir(join(testDir, "src/widgets/header"), { recursive: true });
    await mkdir(join(testDir, "src/shared/ui"), { recursive: true });
    clearAnalysisCache();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should scan entire directory", async () => {
    // Create file with violation
    await writeFile(
      join(testDir, "src/features/auth/login.tsx"),
      `import { Header } from '@/widgets/header';`
    );

    // Create valid file
    await writeFile(
      join(testDir, "src/features/auth/api.ts"),
      `import { Button } from '@/shared/ui';`
    );

    const config: GuardConfig = { preset: "fsd" };
    const report = await checkDirectory(config, testDir);

    expect(report.filesAnalyzed).toBe(2);
    expect(report.totalViolations).toBe(1);
    expect(report.violations[0].fromLayer).toBe("features");
    expect(report.violations[0].toLayer).toBe("widgets");
  });

  it("should report analysis time", async () => {
    await writeFile(join(testDir, "src/shared/ui/button.tsx"), `export const Button = () => <button>Click</button>;`);

    const config: GuardConfig = { preset: "fsd" };
    const report = await checkDirectory(config, testDir);

    expect(report.analysisTime).toBeGreaterThanOrEqual(0);
  });
});

describe("createGuardWatcher", () => {
  it("should create watcher with callbacks", () => {
    const violations: Violation[] = [];
    const config: GuardConfig = { preset: "fsd" };

    const watcher = createGuardWatcher({
      config,
      rootDir: process.cwd(),
      onViolation: (v) => violations.push(v),
      silent: true,
    });

    expect(watcher).toBeDefined();
    expect(typeof watcher.start).toBe("function");
    expect(typeof watcher.close).toBe("function");
    expect(typeof watcher.scanAll).toBe("function");
  });
});

describe("clearAnalysisCache", () => {
  it("should clear cache without error", () => {
    expect(() => clearAnalysisCache()).not.toThrow();
  });
});
