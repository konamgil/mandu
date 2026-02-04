/**
 * Lockfile 시스템 테스트
 *
 * @see docs/plans/08_ont-run_adoption_plan.md - 섹션 7.2
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  generateLockfile,
  computeCurrentHashes,
} from "./generate.js";
import {
  readLockfile,
  writeLockfile,
  deleteLockfile,
  lockfileExists,
  getLockfilePath,
  LOCKFILE_PATH,
} from "./index.js";
import {
  validateLockfile,
  validateWithPolicy,
  quickValidate,
  isLockfileStale,
  formatValidationResult,
} from "./validate.js";
import { LOCKFILE_SCHEMA_VERSION } from "./types.js";

// 테스트용 임시 디렉토리
const TEST_DIR = path.join(process.cwd(), ".test-lockfile-temp");

describe("generateLockfile", () => {
  it("should generate lockfile with correct schema version", () => {
    const config = { port: 3000, name: "test" };
    const lockfile = generateLockfile(config);

    expect(lockfile.schemaVersion).toBe(LOCKFILE_SCHEMA_VERSION);
    expect(lockfile.configHash).toHaveLength(16);
    expect(lockfile.generatedAt).toBeDefined();
  });

  it("should generate deterministic hash for same config", () => {
    const config = { port: 3000, mcpServers: { a: { url: "..." } } };

    const lockfile1 = generateLockfile(config);
    const lockfile2 = generateLockfile(config);

    expect(lockfile1.configHash).toBe(lockfile2.configHash);
  });

  it("should include MCP server hashes when enabled", () => {
    const config = {
      mcpServers: {
        sequential: { command: "npx", args: ["-y", "@mcp/seq"] },
        context7: { command: "npx", args: ["-y", "@mcp/c7"] },
      },
    };

    const lockfile = generateLockfile(config, { includeMcpServerHashes: true });

    expect(lockfile.mcpServers).toBeDefined();
    expect(lockfile.mcpServers?.sequential).toBeDefined();
    expect(lockfile.mcpServers?.context7).toBeDefined();
  });

  it("should include snapshot when requested", () => {
    const config = { port: 3000 };

    const lockfile = generateLockfile(config, { includeSnapshot: true });

    expect(lockfile.snapshot).toBeDefined();
    expect(lockfile.snapshot?.config).toEqual(config);
  });

  it("should set mandu version", () => {
    const config = { port: 3000 };

    const lockfile = generateLockfile(config, { manduVersion: "1.2.3" });

    expect(lockfile.manduVersion).toBe("1.2.3");
  });
});

describe("computeCurrentHashes", () => {
  it("should compute config hash", () => {
    const config = { port: 3000 };
    const { configHash } = computeCurrentHashes(config);

    expect(configHash).toHaveLength(16);
  });

  it("should compute MCP config hash when present", () => {
    const config = {
      port: 3000,
      mcpServers: { api: { url: "http://..." } },
    };

    const { configHash, mcpConfigHash } = computeCurrentHashes(config);

    expect(configHash).toHaveLength(16);
    expect(mcpConfigHash).toHaveLength(16);
  });

  it("should not include MCP hash when no servers", () => {
    const config = { port: 3000 };
    const { mcpConfigHash } = computeCurrentHashes(config);

    expect(mcpConfigHash).toBeUndefined();
  });
});

describe("readLockfile / writeLockfile", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should write and read lockfile", async () => {
    const config = { port: 3000 };
    const lockfile = generateLockfile(config);

    await writeLockfile(TEST_DIR, lockfile);
    const read = await readLockfile(TEST_DIR);

    expect(read).not.toBeNull();
    expect(read?.configHash).toBe(lockfile.configHash);
    expect(read?.schemaVersion).toBe(LOCKFILE_SCHEMA_VERSION);
  });

  it("should return null when lockfile not found", async () => {
    const read = await readLockfile(TEST_DIR);
    expect(read).toBeNull();
  });

  it("should create .mandu directory if not exists", async () => {
    const config = { port: 3000 };
    const lockfile = generateLockfile(config);

    await writeLockfile(TEST_DIR, lockfile);

    const exists = await lockfileExists(TEST_DIR);
    expect(exists).toBe(true);
  });
});

describe("deleteLockfile", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should delete existing lockfile", async () => {
    const lockfile = generateLockfile({ port: 3000 });
    await writeLockfile(TEST_DIR, lockfile);

    const deleted = await deleteLockfile(TEST_DIR);
    const exists = await lockfileExists(TEST_DIR);

    expect(deleted).toBe(true);
    expect(exists).toBe(false);
  });

  it("should return false when lockfile not found", async () => {
    const deleted = await deleteLockfile(TEST_DIR);
    expect(deleted).toBe(false);
  });
});

describe("validateLockfile", () => {
  it("should pass validation when config matches", () => {
    const config = { port: 3000, name: "test" };
    const lockfile = generateLockfile(config);

    const result = validateLockfile(config, lockfile);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should fail validation when config changed", () => {
    const originalConfig = { port: 3000 };
    const lockfile = generateLockfile(originalConfig);

    const modifiedConfig = { port: 3001 };
    const result = validateLockfile(modifiedConfig, lockfile);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].code).toBe("CONFIG_HASH_MISMATCH");
  });

  it("should detect MCP server additions", () => {
    const originalConfig = {
      mcpServers: { a: { url: "..." } },
    };
    const lockfile = generateLockfile(originalConfig, {
      includeMcpServerHashes: true,
    });

    const modifiedConfig = {
      mcpServers: { a: { url: "..." }, b: { url: "..." } },
    };
    const result = validateLockfile(modifiedConfig, lockfile);

    expect(result.warnings.some((w) => w.code === "MCP_SERVER_ADDED")).toBe(true);
  });

  it("should detect MCP server removals", () => {
    const originalConfig = {
      mcpServers: { a: { url: "..." }, b: { url: "..." } },
    };
    const lockfile = generateLockfile(originalConfig, {
      includeMcpServerHashes: true,
    });

    const modifiedConfig = {
      mcpServers: { a: { url: "..." } },
    };
    const result = validateLockfile(modifiedConfig, lockfile);

    expect(result.warnings.some((w) => w.code === "MCP_SERVER_REMOVED")).toBe(true);
  });

  it("should include diff when snapshot available", () => {
    const originalConfig = { port: 3000 };
    const lockfile = generateLockfile(originalConfig, { includeSnapshot: true });

    const modifiedConfig = { port: 3001 };
    const result = validateLockfile(modifiedConfig, lockfile);

    expect(result.diff).toBeDefined();
    expect(result.diff?.hasChanges).toBe(true);
  });
});

describe("quickValidate", () => {
  it("should return true for matching config", () => {
    const config = { port: 3000 };
    const lockfile = generateLockfile(config);

    expect(quickValidate(config, lockfile)).toBe(true);
  });

  it("should return false for modified config", () => {
    const lockfile = generateLockfile({ port: 3000 });

    expect(quickValidate({ port: 3001 }, lockfile)).toBe(false);
  });
});

describe("isLockfileStale", () => {
  it("should return false for matching config", () => {
    const config = { port: 3000 };
    const lockfile = generateLockfile(config);

    expect(isLockfileStale(config, lockfile)).toBe(false);
  });

  it("should return true for modified config", () => {
    const lockfile = generateLockfile({ port: 3000 });

    expect(isLockfileStale({ port: 3001 }, lockfile)).toBe(true);
  });
});

describe("validateWithPolicy", () => {
  it("should return pass action when valid", () => {
    const config = { port: 3000 };
    const lockfile = generateLockfile(config);

    const { action } = validateWithPolicy(config, lockfile, "development");

    expect(action).toBe("pass");
  });

  it("should return warn action in development mode", () => {
    const lockfile = generateLockfile({ port: 3000 });

    const { action } = validateWithPolicy({ port: 3001 }, lockfile, "development");

    expect(action).toBe("warn");
  });

  it("should return error action in build mode", () => {
    const lockfile = generateLockfile({ port: 3000 });

    const { action } = validateWithPolicy({ port: 3001 }, lockfile, "build");

    expect(action).toBe("error");
  });

  it("should return block action in production mode", () => {
    const lockfile = generateLockfile({ port: 3000 });

    const { action } = validateWithPolicy({ port: 3001 }, lockfile, "production");

    expect(action).toBe("block");
  });

  it("should handle missing lockfile", () => {
    const { result, action } = validateWithPolicy({ port: 3000 }, null, "development");

    expect(result).toBeNull();
    expect(action).toBe("warn");
  });
});

describe("formatValidationResult", () => {
  it("should format passing result", () => {
    const config = { port: 3000 };
    const lockfile = generateLockfile(config);
    const result = validateLockfile(config, lockfile);

    const formatted = formatValidationResult(result);

    expect(formatted).toContain("✅");
    expect(formatted).toContain("통과");
  });

  it("should format failing result", () => {
    const lockfile = generateLockfile({ port: 3000 });
    const result = validateLockfile({ port: 3001 }, lockfile);

    const formatted = formatValidationResult(result);

    expect(formatted).toContain("❌");
    expect(formatted).toContain("실패");
  });
});

describe("getLockfilePath", () => {
  it("should return correct path", () => {
    const projectRoot = "/my/project";
    const lockfilePath = getLockfilePath(projectRoot);

    expect(lockfilePath).toBe(path.join(projectRoot, LOCKFILE_PATH));
  });
});

describe("real-world scenarios", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("should handle full lockfile workflow", async () => {
    // 1. 초기 설정으로 lockfile 생성
    const initialConfig = {
      name: "my-project",
      port: 3000,
      mcpServers: {
        sequential: { command: "npx", args: ["-y", "@mcp/seq"] },
      },
      features: { islands: true },
    };

    const lockfile = generateLockfile(initialConfig, {
      manduVersion: "0.9.46",
      includeSnapshot: true,
      includeMcpServerHashes: true,
    });

    await writeLockfile(TEST_DIR, lockfile);

    // 2. 동일 설정으로 검증 - 통과해야 함
    const readLock = await readLockfile(TEST_DIR);
    expect(readLock).not.toBeNull();

    const validResult = validateLockfile(initialConfig, readLock!);
    expect(validResult.valid).toBe(true);

    // 3. 설정 변경 후 검증 - 실패해야 함
    const modifiedConfig = {
      ...initialConfig,
      port: 3001,
      mcpServers: {
        sequential: { command: "npx", args: ["-y", "@mcp/seq"] },
        context7: { command: "npx", args: ["-y", "@mcp/c7"] },
      },
    };

    const invalidResult = validateLockfile(modifiedConfig, readLock!);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.diff).toBeDefined();

    // 4. 새 lockfile 생성으로 갱신
    const newLockfile = generateLockfile(modifiedConfig, {
      manduVersion: "0.9.46",
      includeSnapshot: true,
    });

    await writeLockfile(TEST_DIR, newLockfile);

    // 5. 갱신 후 검증 - 통과해야 함
    const updatedLock = await readLockfile(TEST_DIR);
    const finalResult = validateLockfile(modifiedConfig, updatedLock!);
    expect(finalResult.valid).toBe(true);
  });
});
