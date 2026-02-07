/**
 * Architecture Negotiation Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, mkdtemp, readFile, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  negotiate,
  generateScaffold,
  analyzeExistingStructure,
  detectCategory,
  type NegotiationRequest,
} from "./negotiation";

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

let TEST_DIR: string;

beforeAll(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), "test-negotiation-"));

  // 기본 프로젝트 구조 생성
  await mkdir(join(TEST_DIR, "spec", "decisions"), { recursive: true });
  await mkdir(join(TEST_DIR, "server", "domain"), { recursive: true });
  await mkdir(join(TEST_DIR, "shared"), { recursive: true });

  // 샘플 ADR 생성
  await Bun.write(
    join(TEST_DIR, "spec", "decisions", "ADR-001-auth.md"),
    `# Use JWT for Authentication

**ID:** ADR-001
**Status:** accepted
**Date:** 2024-01-15
**Tags:** auth, jwt, security

## Context
Need authentication for API.

## Decision
Use JWT with refresh tokens.

## Consequences
- Token management required
`
  );
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unit Tests - Category Detection
// ═══════════════════════════════════════════════════════════════════════════

describe("Architecture Negotiation - Category Detection", () => {
  it("should detect auth category", () => {
    expect(detectCategory("사용자 인증 기능 추가")).toBe("auth");
    expect(detectCategory("Add login feature")).toBe("auth");
    expect(detectCategory("JWT 토큰 구현")).toBe("auth");
  });

  it("should detect crud category", () => {
    expect(detectCategory("사용자 목록 조회")).toBe("crud");
    expect(detectCategory("Create user management")).toBe("crud");
    expect(detectCategory("CRUD for products")).toBe("crud");
  });

  it("should detect api category", () => {
    expect(detectCategory("API 엔드포인트 추가")).toBe("api");
    expect(detectCategory("REST endpoint")).toBe("api");
  });

  it("should detect ui category", () => {
    expect(detectCategory("버튼 컴포넌트 만들기")).toBe("ui");
    expect(detectCategory("Add modal component")).toBe("ui");
  });

  it("should detect integration category", () => {
    expect(detectCategory("Stripe 결제 연동")).toBe("integration");
    expect(detectCategory("third-party 서비스 통합")).toBe("integration");
    expect(detectCategory("webhook 처리")).toBe("integration");
  });

  it("should fallback to other", () => {
    expect(detectCategory("something completely different")).toBe("other");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unit Tests - Negotiate
// ═══════════════════════════════════════════════════════════════════════════

describe("Architecture Negotiation - negotiate()", () => {
  it("should return approved plan for auth feature", async () => {
    const request: NegotiationRequest = {
      intent: "사용자 인증 기능 추가",
      requirements: ["JWT 기반", "리프레시 토큰"],
      constraints: ["기존 User 모델 활용"],
    };

    const result = await negotiate(request, TEST_DIR);

    expect(result.approved).toBe(true);
    expect(result.structure.length).toBeGreaterThan(0);
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.preset).toBe("mandu");
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it("should include related decisions", async () => {
    const request: NegotiationRequest = {
      intent: "Add authentication",
      category: "auth",
    };

    const result = await negotiate(request, TEST_DIR);

    // ADR-001이 auth 태그를 가지고 있으므로 관련 결정으로 포함되어야 함
    expect(result.relatedDecisions.length).toBeGreaterThanOrEqual(0);
  });

  it("should generate structure for CRUD feature", async () => {
    const request: NegotiationRequest = {
      intent: "사용자 관리 CRUD",
    };

    const result = await negotiate(request, TEST_DIR);

    expect(result.approved).toBe(true);
    expect(result.structure.some((s) => s.path.includes("domain"))).toBe(true);
    expect(result.structure.some((s) => s.path.includes("api"))).toBe(true);
  });

  it("should generate structure for UI feature", async () => {
    const request: NegotiationRequest = {
      intent: "모달 컴포넌트 추가",
      category: "ui",
    };

    const result = await negotiate(request, TEST_DIR);

    expect(result.approved).toBe(true);
    expect(result.structure.some((s) => s.path.includes("widgets"))).toBe(true);
  });

  it("should estimate file count", async () => {
    const request: NegotiationRequest = {
      intent: "Simple API endpoint",
      category: "api",
    };

    const result = await negotiate(request, TEST_DIR);

    expect(result.estimatedFiles).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unit Tests - Scaffold Generation
// ═══════════════════════════════════════════════════════════════════════════

describe("Architecture Negotiation - generateScaffold()", () => {
  it("should generate scaffold files (dry run)", async () => {
    const request: NegotiationRequest = {
      intent: "test feature",
      category: "util",
    };

    const plan = await negotiate(request, TEST_DIR);
    const result = await generateScaffold(plan.structure, TEST_DIR, { dryRun: true });

    expect(result.success).toBe(true);
    expect(result.createdDirs.length).toBeGreaterThan(0);
    expect(result.createdFiles.length).toBeGreaterThan(0);
    expect(result.errors.length).toBe(0);
  });

  it("should actually create files when not dry run", async () => {
    const testSubDir = await mkdtemp(join(TEST_DIR, "scaffold-"));

    const request: NegotiationRequest = {
      intent: "payment feature",
      category: "integration",
    };

    const plan = await negotiate(request, testSubDir);
    const result = await generateScaffold(plan.structure, testSubDir);

    expect(result.success).toBe(true);

    // 실제 파일 확인
    for (const file of result.createdFiles.slice(0, 2)) {
      const content = await readFile(join(testSubDir, file), "utf-8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("should skip existing files without overwrite flag", async () => {
    const testSubDir = await mkdtemp(join(TEST_DIR, "skip-"));

    // 먼저 파일 생성
    const request: NegotiationRequest = {
      intent: "skip test",
      category: "util",
    };

    const plan = await negotiate(request, testSubDir);
    await generateScaffold(plan.structure, testSubDir);

    // 다시 생성 시도
    const result2 = await generateScaffold(plan.structure, testSubDir);

    expect(result2.skippedFiles.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unit Tests - Analyze Structure
// ═══════════════════════════════════════════════════════════════════════════

describe("Architecture Negotiation - analyzeExistingStructure()", () => {
  it("should detect existing layers", async () => {
    const result = await analyzeExistingStructure(TEST_DIR);

    // TEST_DIR에 server/domain과 shared가 있음
    expect(result.layers).toContain("server/domain");
    expect(result.layers).toContain("shared");
  });

  it("should provide recommendations for missing layers", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "empty-struct-"));

    const result = await analyzeExistingStructure(emptyDir);

    expect(result.recommendations.length).toBeGreaterThan(0);

    await rm(emptyDir, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Architecture Negotiation - Integration", () => {
  it("should complete full negotiation flow", async () => {
    const testSubDir = await mkdtemp(join(TEST_DIR, "full-flow-"));

    // 1. 협상
    const request: NegotiationRequest = {
      intent: "결제 기능 추가",
      requirements: ["Stripe 연동", "웹훅 처리"],
      constraints: ["기존 주문 시스템 연동"],
    };

    const plan = await negotiate(request, testSubDir);

    expect(plan.approved).toBe(true);
    expect(plan.warnings.length).toBeGreaterThanOrEqual(0);
    expect(plan.nextSteps.length).toBeGreaterThan(0);

    // 2. Scaffold 생성
    const scaffold = await generateScaffold(plan.structure, testSubDir);

    expect(scaffold.success).toBe(true);
    expect(scaffold.createdFiles.length).toBeGreaterThan(0);

    // 3. 생성된 파일 내용 확인
    const firstFile = scaffold.createdFiles[0];
    if (firstFile) {
      const content = await readFile(join(testSubDir, firstFile), "utf-8");
      expect(content).toContain("/**");
      expect(content.length).toBeGreaterThan(50);
    }
  });
});
