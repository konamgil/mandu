/**
 * CQRS Preset Tests
 *
 * CQRS 프리셋의 구조 검증 및 Command/Query 분리 규칙 테스트
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { cqrsPreset, CQRS_HIERARCHY } from "./cqrs";
import { presets, getPreset } from "./index";
import { negotiate, generateScaffold } from "../negotiation";

// ═══════════════════════════════════════════════════════════════════════════
// Preset Structure Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("CQRS Preset - Structure", () => {
  it("should be registered in presets map", () => {
    expect(presets.cqrs).toBeDefined();
    expect(presets.cqrs).toBe(cqrsPreset);
  });

  it("should be retrievable via getPreset", () => {
    expect(getPreset("cqrs")).toBe(cqrsPreset);
  });

  it("should have correct name and description", () => {
    expect(cqrsPreset.name).toBe("cqrs");
    expect(cqrsPreset.description).toContain("CQRS");
  });

  it("should define all 10 layers", () => {
    expect(cqrsPreset.layers).toHaveLength(10);
  });

  it("should have hierarchy matching layer names", () => {
    const layerNames = cqrsPreset.layers.map((l) => l.name);
    for (const h of CQRS_HIERARCHY) {
      expect(layerNames).toContain(h);
    }
  });

  it("should set layerViolation severity to error", () => {
    expect(cqrsPreset.defaultSeverity?.layerViolation).toBe("error");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CQRS Separation Rules - TODO(human)
// ═══════════════════════════════════════════════════════════════════════════

describe("CQRS Preset - Command/Query Separation", () => {
  const findLayer = (name: string) => cqrsPreset.layers.find((l) => l.name === name)!;

  it("commands cannot import queries", () => {
    const commands = findLayer("application/commands");
    expect(commands.canImport).not.toContain("application/queries");
  });

  it("queries cannot import commands or events", () => {
    const queries = findLayer("application/queries");
    expect(queries.canImport).not.toContain("application/commands");
    expect(queries.canImport).not.toContain("application/events");
  });

  it("commands can import domain, dto, events", () => {
    const commands = findLayer("application/commands");
    expect(commands.canImport).toContain("domain");
    expect(commands.canImport).toContain("application/dto");
    expect(commands.canImport).toContain("application/events");
  });

  it("queries can import domain, dto", () => {
    const queries = findLayer("application/queries");
    expect(queries.canImport).toContain("domain");
    expect(queries.canImport).toContain("application/dto");
  });

  it("domain can only import shared", () => {
    const domain = findLayer("domain");
    expect(domain.canImport).toEqual(["shared"]);
  });

  it("shared cannot import anything", () => {
    const shared = findLayer("shared");
    expect(shared.canImport).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CQRS Scaffolding Tests
// ═══════════════════════════════════════════════════════════════════════════

let SCAFFOLD_DIR: string;

beforeAll(async () => {
  SCAFFOLD_DIR = await mkdtemp(join(tmpdir(), "test-cqrs-scaffold-"));
  await mkdir(join(SCAFFOLD_DIR, "spec", "decisions"), { recursive: true });
});

afterAll(async () => {
  await rm(SCAFFOLD_DIR, { recursive: true, force: true });
});

describe("CQRS Preset - Scaffold Templates", () => {
  it("should generate commands/queries separation for auth", async () => {
    const result = await negotiate(
      { intent: "사용자 인증 추가", category: "auth", preset: "cqrs" },
      SCAFFOLD_DIR,
    );

    expect(result.approved).toBe(true);
    expect(result.preset).toBe("cqrs");

    const paths = result.structure.map((s) => s.path);
    expect(paths.some((p) => p.includes("application/commands"))).toBe(true);
    expect(paths.some((p) => p.includes("application/queries"))).toBe(true);
    expect(paths.some((p) => p.includes("application/dto"))).toBe(true);
    expect(paths.some((p) => p.includes("application/events"))).toBe(true);
  });

  it("should generate CRUD with separate commands and queries", async () => {
    const result = await negotiate(
      { intent: "상품 관리 CRUD", category: "crud", preset: "cqrs" },
      SCAFFOLD_DIR,
    );

    const commandsDir = result.structure.find((s) => s.path.includes("application/commands"));
    const queriesDir = result.structure.find((s) => s.path.includes("application/queries"));

    expect(commandsDir).toBeDefined();
    expect(queriesDir).toBeDefined();

    // commands에 create/update/delete가 있어야 함
    const cmdFiles = commandsDir!.files.map((f) => f.name);
    expect(cmdFiles.some((f) => f.includes("create"))).toBe(true);
    expect(cmdFiles.some((f) => f.includes("update"))).toBe(true);
    expect(cmdFiles.some((f) => f.includes("delete"))).toBe(true);

    // queries에 get/list가 있어야 함
    const qryFiles = queriesDir!.files.map((f) => f.name);
    expect(qryFiles.some((f) => f.includes("get"))).toBe(true);
    expect(qryFiles.some((f) => f.includes("list"))).toBe(true);
  });

  it("should create actual scaffold files", async () => {
    const testDir = await mkdtemp(join(SCAFFOLD_DIR, "actual-"));
    await mkdir(join(testDir, "spec", "decisions"), { recursive: true });

    const plan = await negotiate(
      { intent: "order feature", category: "crud", preset: "cqrs" },
      testDir,
    );
    const result = await generateScaffold(plan.structure, testDir);

    expect(result.success).toBe(true);
    expect(result.createdFiles.some((f) => f.includes("command"))).toBe(true);
    expect(result.createdFiles.some((f) => f.includes("query"))).toBe(true);
  });

  it("should use src/ prefixed paths (no adjustStructureForPreset)", async () => {
    const result = await negotiate(
      { intent: "payment api", category: "api", preset: "cqrs" },
      SCAFFOLD_DIR,
    );

    // CQRS 전용 템플릿은 이미 src/ 기준 경로를 사용
    const paths = result.structure.map((s) => s.path);
    for (const p of paths) {
      expect(p.startsWith("src/")).toBe(true);
    }
  });
});
