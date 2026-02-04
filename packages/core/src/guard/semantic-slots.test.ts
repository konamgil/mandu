/**
 * Semantic Slots Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  validateSlotConstraints,
  validateSlots,
  extractSlotMetadata,
  countCodeLines,
  calculateCyclomaticComplexity,
  extractImports,
  extractFunctionCalls,
  checkPattern,
  DEFAULT_SLOT_CONSTRAINTS,
  API_SLOT_CONSTRAINTS,
  type SlotConstraints,
} from "./semantic-slots";

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

let TEST_DIR: string;

const VALID_SLOT_CODE = `
import { z } from "zod";
import { userService } from "server/domain/user";

const schema = z.object({
  page: z.number().min(1),
  limit: z.number().max(100),
});

export default Mandu.filling()
  .purpose("사용자 목록 조회 API")
  .constraints({ maxLines: 50 })
  .get(async (ctx) => {
    try {
      const input = schema.parse(ctx.query);
      const users = await userService.list(input);
      return ctx.json({ users });
    } catch (error) {
      return ctx.json({ error: "Failed to fetch users" }, 500);
    }
  });
`;

const INVALID_SLOT_CODE = `
import { db } from "database/client";

// This slot has issues:
// 1. Too many lines
// 2. High complexity
// 3. Missing validation
// 4. Direct DB write
// 5. Hardcoded secret

const API_KEY = "sk-12345678901234567890";

export default Mandu.filling()
  .get(async (ctx) => {
    if (ctx.query.a) {
      if (ctx.query.b) {
        if (ctx.query.c) {
          if (ctx.query.d) {
            if (ctx.query.e) {
              console.log("password:", ctx.body.password);
              await db.insert({ a: 1 });
            }
          }
        }
      }
    }
    return ctx.json({ ok: true });
  });
`;

const COMPLEX_CODE = `
function process(x) {
  if (x > 0) {
    if (x < 10) {
      return "small";
    } else if (x < 100) {
      return "medium";
    }
  }

  for (let i = 0; i < x; i++) {
    if (i % 2 === 0) {
      console.log(i);
    }
  }

  while (x > 0) {
    x--;
  }

  switch (x) {
    case 1: return "one";
    case 2: return "two";
    default: return "other";
  }
}
`;

beforeAll(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), "test-semantic-slots-"));
  await mkdir(join(TEST_DIR, "slots"), { recursive: true });

  // 유효한 슬롯 파일
  await Bun.write(join(TEST_DIR, "slots", "valid.slot.ts"), VALID_SLOT_CODE);

  // 문제 있는 슬롯 파일
  await Bun.write(join(TEST_DIR, "slots", "invalid.slot.ts"), INVALID_SLOT_CODE);

  // 복잡한 코드 파일
  await Bun.write(join(TEST_DIR, "slots", "complex.ts"), COMPLEX_CODE);
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unit Tests - Analysis Functions
// ═══════════════════════════════════════════════════════════════════════════

describe("Semantic Slots - Analysis", () => {
  describe("countCodeLines", () => {
    it("should count only code lines, excluding single-line comments and blanks", () => {
      const code = `
// Comment
const x = 1;

const y = 2;

// Another comment
const z = 3;
      `.trim();

      const count = countCodeLines(code);
      // const x, const y, const z = 3 lines
      expect(count).toBe(3);
    });

    it("should exclude multi-line block comments", () => {
      const code = `
const a = 1;
/*
 * Block comment
 * spanning multiple lines
 */
const b = 2;
      `.trim();

      const count = countCodeLines(code);
      // const a, const b = 2 lines
      expect(count).toBe(2);
    });

    it("should count lines in real code", () => {
      const code = `const x = 1;\nconst y = 2;`;
      const count = countCodeLines(code);
      expect(count).toBe(2);
    });
  });

  describe("calculateCyclomaticComplexity", () => {
    it("should calculate complexity for complex code", () => {
      const complexity = calculateCyclomaticComplexity(COMPLEX_CODE);

      // 1 (base) + if + if + else if + for + if + while + 2 cases = ~10
      expect(complexity).toBeGreaterThan(5);
    });

    it("should return 1 for simple code", () => {
      const simple = "const x = 1;";
      expect(calculateCyclomaticComplexity(simple)).toBe(1);
    });
  });

  describe("extractImports", () => {
    it("should extract ES6 imports", () => {
      const code = `
import { foo } from "module-a";
import bar from "module-b";
import * as baz from "module-c";
      `;
      const imports = extractImports(code);

      expect(imports).toContain("module-a");
      expect(imports).toContain("module-b");
      expect(imports).toContain("module-c");
    });

    it("should extract require statements", () => {
      const code = `
const x = require("module-a");
const { y } = require("module-b");
      `;
      const imports = extractImports(code);

      expect(imports).toContain("module-a");
      expect(imports).toContain("module-b");
    });
  });

  describe("extractFunctionCalls", () => {
    it("should extract function and method calls", () => {
      const code = `
foo();
obj.bar();
nested.deep.method();
      `;
      const calls = extractFunctionCalls(code);

      expect(calls).toContain("foo");
      expect(calls).toContain("obj.bar");
      expect(calls).toContain("deep.method");
    });
  });

  describe("checkPattern", () => {
    it("should detect input-validation pattern", () => {
      const code = 'const result = schema.parse(input);';
      expect(checkPattern(code, "input-validation")).toBe(true);
    });

    it("should detect error-handling pattern", () => {
      const code = "try { foo(); } catch (e) { console.error(e); }";
      expect(checkPattern(code, "error-handling")).toBe(true);
    });

    it("should detect direct-db-write pattern", () => {
      const code = "await db.insert({ name: 'test' });";
      expect(checkPattern(code, "direct-db-write")).toBe(true);
    });

    it("should detect hardcoded-secret pattern", () => {
      const code = 'const apiKey = "sk-12345678901234567890";';
      expect(checkPattern(code, "hardcoded-secret")).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unit Tests - Validation
// ═══════════════════════════════════════════════════════════════════════════

describe("Semantic Slots - Validation", () => {
  describe("validateSlotConstraints", () => {
    it("should pass validation for valid slot", async () => {
      const constraints: SlotConstraints = {
        maxLines: 50,
        requiredPatterns: ["error-handling"],
        forbiddenPatterns: ["hardcoded-secret"],
      };

      const result = await validateSlotConstraints(
        join(TEST_DIR, "slots", "valid.slot.ts"),
        constraints
      );

      expect(result.valid).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    it("should detect max lines violation", async () => {
      const constraints: SlotConstraints = {
        maxLines: 5, // 매우 낮은 제한
      };

      const result = await validateSlotConstraints(
        join(TEST_DIR, "slots", "valid.slot.ts"),
        constraints
      );

      expect(result.violations.some((v) => v.type === "max-lines-exceeded")).toBe(true);
    });

    it("should detect forbidden patterns", async () => {
      const constraints: SlotConstraints = {
        forbiddenPatterns: ["hardcoded-secret", "direct-db-write"],
      };

      const result = await validateSlotConstraints(
        join(TEST_DIR, "slots", "invalid.slot.ts"),
        constraints
      );

      expect(result.violations.some((v) => v.type === "forbidden-pattern-found")).toBe(true);
    });

    it("should detect missing required patterns", async () => {
      const constraints: SlotConstraints = {
        requiredPatterns: ["input-validation", "authentication"],
      };

      const result = await validateSlotConstraints(
        join(TEST_DIR, "slots", "invalid.slot.ts"),
        constraints
      );

      expect(result.violations.some((v) => v.type === "missing-required-pattern")).toBe(true);
    });

    it("should validate with default constraints", async () => {
      const result = await validateSlotConstraints(
        join(TEST_DIR, "slots", "invalid.slot.ts"),
        DEFAULT_SLOT_CONSTRAINTS
      );

      // DEFAULT_SLOT_CONSTRAINTS에 hardcoded-secret 금지 포함
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  describe("extractSlotMetadata", () => {
    it("should extract purpose from slot file", async () => {
      const metadata = await extractSlotMetadata(join(TEST_DIR, "slots", "valid.slot.ts"));

      expect(metadata).not.toBeNull();
      expect(metadata?.purpose).toBe("사용자 목록 조회 API");
    });

    it("should return null for files without metadata", async () => {
      const metadata = await extractSlotMetadata(join(TEST_DIR, "slots", "complex.ts"));

      expect(metadata).toBeNull();
    });
  });

  describe("validateSlots", () => {
    it("should validate multiple slots", async () => {
      const slotFiles = [
        join(TEST_DIR, "slots", "valid.slot.ts"),
        join(TEST_DIR, "slots", "invalid.slot.ts"),
      ];

      const result = await validateSlots(slotFiles, API_SLOT_CONSTRAINTS);

      expect(result.totalSlots).toBe(2);
      expect(result.validSlots).toBeGreaterThanOrEqual(0);
      expect(result.results.length).toBe(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration with Filling API
// ═══════════════════════════════════════════════════════════════════════════

describe("Semantic Slots - Filling API Integration", () => {
  it("should be importable in filling context", async () => {
    // 단순히 import가 가능한지 확인
    const { ManduFilling } = await import("../filling/filling");
    const filling = new ManduFilling();

    // 메서드 체이닝 테스트
    const result = filling
      .purpose("Test API")
      .description("This is a test")
      .constraints({ maxLines: 50 })
      .tags("test", "example")
      .owner("test-team");

    const metadata = result.getSemanticMetadata();

    expect(metadata.purpose).toBe("Test API");
    expect(metadata.description).toBe("This is a test");
    expect(metadata.constraints?.maxLines).toBe(50);
    expect(metadata.tags).toContain("test");
    expect(metadata.owner).toBe("test-team");
  });
});
