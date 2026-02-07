/**
 * Decision Memory Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, mkdtemp, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseADRMarkdown,
  formatADRAsMarkdown,
  getAllDecisions,
  getDecisionById,
  searchDecisions,
  saveDecision,
  checkConsistency,
  generateCompactArchitecture,
  getNextDecisionId,
  type ArchitectureDecision,
} from "./decision-memory";

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

let TEST_DIR: string;

const SAMPLE_ADR_CONTENT = `# Use JWT for API Authentication

**ID:** ADR-001
**Status:** accepted
**Date:** 2024-01-15
**Tags:** auth, api, security, jwt

## Context

API 인증 방식을 결정해야 합니다. 세션 기반과 토큰 기반 중 선택이 필요합니다.

## Decision

JWT (JSON Web Token) + Refresh Token 조합을 사용합니다.
- Access Token: 15분 만료
- Refresh Token: 7일 만료, Redis에 저장

## Consequences

- 토큰 만료 관리가 필요합니다
- Redis 세션 저장소가 필요합니다
- Stateless 아키텍처 유지 가능

## Related Decisions

- ADR-002
`;

const SAMPLE_ADR_CONTENT_2 = `# Use Redis for Session Storage

**ID:** ADR-002
**Status:** accepted
**Date:** 2024-01-16
**Tags:** cache, session, redis, infrastructure

## Context

세션 및 캐시 저장소 선택이 필요합니다.

## Decision

Redis를 통합 캐시/세션 저장소로 사용합니다.
server/infra/cache/를 통해서만 접근합니다.

## Consequences

- 직접 Redis 클라이언트 사용 금지
- 캐시 추상화 레이어 필요

## Related Decisions

- ADR-001
`;

beforeAll(async () => {
  // 임시 디렉토리 생성
  TEST_DIR = await mkdtemp(join(tmpdir(), "test-decision-memory-"));

  // spec/decisions 디렉토리 생성
  await mkdir(join(TEST_DIR, "spec", "decisions"), { recursive: true });

  // 샘플 ADR 파일 생성
  await Bun.write(
    join(TEST_DIR, "spec", "decisions", "ADR-001-jwt-auth.md"),
    SAMPLE_ADR_CONTENT
  );
  await Bun.write(
    join(TEST_DIR, "spec", "decisions", "ADR-002-redis-session.md"),
    SAMPLE_ADR_CONTENT_2
  );

  // package.json 생성 (프로젝트 이름용)
  await Bun.write(
    join(TEST_DIR, "package.json"),
    JSON.stringify({ name: "test-project" }, null, 2)
  );
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unit Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Decision Memory", () => {
  describe("parseADRMarkdown", () => {
    it("should parse ADR markdown correctly", () => {
      const result = parseADRMarkdown(SAMPLE_ADR_CONTENT, "ADR-001-jwt-auth.md");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("ADR-001");
      expect(result!.title).toBe("Use JWT for API Authentication");
      expect(result!.status).toBe("accepted");
      expect(result!.date).toBe("2024-01-15");
      expect(result!.tags).toContain("auth");
      expect(result!.tags).toContain("jwt");
      expect(result!.context).toContain("API 인증 방식");
      expect(result!.decision).toContain("JWT");
      expect(result!.consequences.length).toBeGreaterThan(0);
      expect(result!.relatedDecisions).toContain("ADR-002");
    });

    it("should handle malformed content gracefully", () => {
      const result = parseADRMarkdown("# Simple Title\n\nSome content", "test.md");

      expect(result).not.toBeNull();
      expect(result!.title).toBe("Simple Title");
    });
  });

  describe("formatADRAsMarkdown", () => {
    it("should format decision as markdown", () => {
      const decision: ArchitectureDecision = {
        id: "ADR-003",
        title: "Test Decision",
        status: "proposed",
        date: "2024-02-01",
        tags: ["test", "example"],
        context: "This is the context",
        decision: "This is the decision",
        consequences: ["Consequence 1", "Consequence 2"],
        relatedDecisions: ["ADR-001"],
      };

      const markdown = formatADRAsMarkdown(decision);

      expect(markdown).toContain("# Test Decision");
      expect(markdown).toContain("**ID:** ADR-003");
      expect(markdown).toContain("**Status:** proposed");
      expect(markdown).toContain("test, example");
      expect(markdown).toContain("This is the context");
      expect(markdown).toContain("- Consequence 1");
      expect(markdown).toContain("- ADR-001");
    });
  });

  describe("getAllDecisions", () => {
    it("should load all decisions from spec/decisions", async () => {
      const decisions = await getAllDecisions(TEST_DIR);

      expect(decisions.length).toBe(2);
      expect(decisions[0].id).toBe("ADR-001");
      expect(decisions[1].id).toBe("ADR-002");
    });

    it("should return empty array for non-existent directory", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "empty-"));
      const decisions = await getAllDecisions(emptyDir);

      expect(decisions).toEqual([]);

      await rm(emptyDir, { recursive: true, force: true });
    });
  });

  describe("getDecisionById", () => {
    it("should find decision by ID", async () => {
      const decision = await getDecisionById(TEST_DIR, "ADR-001");

      expect(decision).not.toBeNull();
      expect(decision!.title).toBe("Use JWT for API Authentication");
    });

    it("should return null for non-existent ID", async () => {
      const decision = await getDecisionById(TEST_DIR, "ADR-999");

      expect(decision).toBeNull();
    });
  });

  describe("searchDecisions", () => {
    it("should find decisions by tags", async () => {
      const result = await searchDecisions(TEST_DIR, ["auth"]);

      expect(result.decisions.length).toBe(1);
      expect(result.decisions[0].id).toBe("ADR-001");
    });

    it("should find decisions by multiple tags", async () => {
      const result = await searchDecisions(TEST_DIR, ["auth", "cache"]);

      expect(result.decisions.length).toBe(2);
    });

    it("should return empty for non-matching tags", async () => {
      const result = await searchDecisions(TEST_DIR, ["nonexistent"]);

      expect(result.decisions.length).toBe(0);
    });

    it("should perform partial tag matching", async () => {
      const result = await searchDecisions(TEST_DIR, ["sec"]); // should match "security"

      expect(result.decisions.length).toBeGreaterThan(0);
    });
  });

  describe("saveDecision", () => {
    it("should save new decision as markdown file", async () => {
      const newDecision: Omit<ArchitectureDecision, "date"> = {
        id: "ADR-003",
        title: "Use Feature Flags",
        status: "proposed",
        tags: ["feature", "deployment"],
        context: "Need controlled rollout",
        decision: "Use feature flags for gradual rollout",
        consequences: ["Need flag management system"],
      };

      const result = await saveDecision(TEST_DIR, newDecision);

      expect(result.success).toBe(true);
      expect(result.filePath).toContain("ADR-003");

      // 파일이 실제로 생성되었는지 확인
      const content = await readFile(result.filePath, "utf-8");
      expect(content).toContain("Use Feature Flags");
    });
  });

  describe("checkConsistency", () => {
    it("should find related decisions for consistency check", async () => {
      const result = await checkConsistency(TEST_DIR, "Add caching layer", ["cache"]);

      expect(result.relatedDecisions.length).toBeGreaterThan(0);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it("should return consistent=true when no warnings", async () => {
      const result = await checkConsistency(TEST_DIR, "New feature", ["auth"]);

      // accepted 상태이므로 warning 없음
      expect(result.consistent).toBe(true);
    });
  });

  describe("generateCompactArchitecture", () => {
    it("should generate compact architecture summary", async () => {
      const compact = await generateCompactArchitecture(TEST_DIR);

      expect(compact.project).toBe("test-project");
      expect(compact.keyDecisions.length).toBeGreaterThan(0);
      expect(compact.tagCounts["auth"]).toBeGreaterThan(0);
    });
  });

  describe("getNextDecisionId", () => {
    it("should return next sequential ID", async () => {
      // ADR-003을 추가했으므로 다음은 ADR-004
      const nextId = await getNextDecisionId(TEST_DIR);

      expect(nextId).toBe("ADR-004");
    });

    it("should return ADR-001 for empty project", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "empty-decisions-"));
      const nextId = await getNextDecisionId(emptyDir);

      expect(nextId).toBe("ADR-001");

      await rm(emptyDir, { recursive: true, force: true });
    });
  });
});
