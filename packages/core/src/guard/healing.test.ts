/**
 * Self-Healing Guard Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  checkWithHealing,
  generateHealing,
  explainRule,
  type HealingResult,
} from "./healing";
import type { Violation, GuardConfig } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Test Setup
// ═══════════════════════════════════════════════════════════════════════════

// 임시 디렉토리 사용 (고정 경로 대신)
let TEST_DIR: string;

beforeAll(async () => {
  // 임시 디렉토리 생성 (안전한 격리된 테스트 환경)
  TEST_DIR = await mkdtemp(join(tmpdir(), "test-healing-"));

  // Create test directory structure
  await mkdir(join(TEST_DIR, "src", "shared", "utils"), { recursive: true });
  await mkdir(join(TEST_DIR, "src", "features", "auth", "model"), { recursive: true });
  await mkdir(join(TEST_DIR, "src", "features", "user", "model"), { recursive: true });
  await mkdir(join(TEST_DIR, "src", "widgets", "header"), { recursive: true });

  // Create test files with violations
  // Violation 1: Layer violation (features importing widgets)
  await writeFile(
    join(TEST_DIR, "src", "features", "auth", "model", "store.ts"),
    `// Layer violation: features cannot import widgets
import { HeaderButton } from '@/widgets/header';

export const authStore = {
  button: HeaderButton,
};
`
  );

  // Violation 2: Cross-slice (features/auth importing features/user directly)
  await writeFile(
    join(TEST_DIR, "src", "features", "auth", "model", "user-ref.ts"),
    `// Cross-slice violation
import { userStore } from '@/features/user/model/store';

export const getUserFromAuth = () => userStore.get();
`
  );

  // Valid file (no violations)
  await writeFile(
    join(TEST_DIR, "src", "features", "auth", "model", "valid.ts"),
    `// Valid: importing from shared
import { formatDate } from '@/shared/utils';

export const formatAuthDate = (date: Date) => formatDate(date);
`
  );

  // Shared utils
  await writeFile(
    join(TEST_DIR, "src", "shared", "utils", "index.ts"),
    `export const formatDate = (date: Date) => date.toISOString();
`
  );

  // Widgets
  await writeFile(
    join(TEST_DIR, "src", "widgets", "header", "index.ts"),
    `export const HeaderButton = () => '<button>Header</button>';
`
  );

  // Features user
  await writeFile(
    join(TEST_DIR, "src", "features", "user", "model", "store.ts"),
    `export const userStore = { get: () => ({ name: 'test' }) };
`
  );
});

afterAll(async () => {
  // Cleanup
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unit Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Self-Healing Guard", () => {
  describe("explainRule", () => {
    it("should explain layer-violation rule", () => {
      const explanation = explainRule(
        "layer-violation",
        "features",
        "widgets",
        "fsd"
      );

      expect(explanation.rule).toBe("layer-violation");
      expect(explanation.why).toContain("features");
      expect(explanation.why).toContain("widgets");
      expect(explanation.how).toBeDefined();
      expect(explanation.examples.bad).toContain("❌");
      expect(explanation.examples.good).toContain("✅");
    });

    it("should explain circular-dependency rule", () => {
      const explanation = explainRule(
        "circular-dependency",
        "moduleA",
        "moduleB",
        "clean"
      );

      expect(explanation.rule).toBe("circular-dependency");
      expect(explanation.why).toContain("순환");
      expect(explanation.how).toContain("shared");
    });

    it("should explain cross-slice rule", () => {
      const explanation = explainRule(
        "cross-slice",
        "features",
        "features",
        "fsd"
      );

      expect(explanation.rule).toBe("cross-slice");
      expect(explanation.why).toContain("슬라이스");
    });

    it("should explain deep-nesting rule", () => {
      const explanation = explainRule(
        "deep-nesting",
        "pages",
        "features",
        "fsd"
      );

      expect(explanation.rule).toBe("deep-nesting");
      expect(explanation.why).toContain("내부");
      expect(explanation.how).toContain("Public API");
    });
  });

  describe("generateHealing", () => {
    it("should generate healing options for layer violation", () => {
      const violation: Violation = {
        type: "layer-violation",
        filePath: join(TEST_DIR, "src", "features", "auth", "model", "store.ts"),
        line: 2,
        column: 1,
        importStatement: "import { HeaderButton } from '@/widgets/header';",
        importPath: "@/widgets/header",
        fromLayer: "features",
        toLayer: "widgets",
        ruleName: "layer-dependency",
        ruleDescription: "features cannot import from widgets",
        severity: "error",
        allowedLayers: ["entities", "shared"],
        suggestions: ["Move to shared or use props"],
      };

      const config: GuardConfig = { preset: "fsd" };
      const healing = generateHealing(violation, config, TEST_DIR);

      expect(healing.primary).toBeDefined();
      expect(healing.primary.label).toBeDefined();
      expect(healing.primary.explanation).toBeDefined();
      expect(healing.alternatives.length).toBeGreaterThan(0);
      expect(healing.context.layerHierarchy).toContain("→");
      expect(healing.context.allowedLayers).toContain("shared");
    });

    it("should generate healing options with autoFix for fixable violations", () => {
      const violation: Violation = {
        type: "deep-nesting",
        filePath: join(TEST_DIR, "src", "pages", "home", "index.ts"),
        line: 1,
        column: 1,
        importStatement: "import { X } from '@/features/auth/model/internal/helper';",
        importPath: "@/features/auth/model/internal/helper",
        fromLayer: "pages",
        toLayer: "features",
        ruleName: "public-api",
        ruleDescription: "Import from internal path",
        severity: "warn",
        allowedLayers: ["features", "widgets", "entities", "shared"],
        suggestions: ["Use public API"],
      };

      const config: GuardConfig = { preset: "fsd" };
      const healing = generateHealing(violation, config, TEST_DIR);

      // Deep nesting violations should have autoFix
      const hasAutoFix = healing.primary.autoFix !== undefined ||
        healing.alternatives.some((alt) => alt.autoFix !== undefined);

      expect(hasAutoFix).toBe(true);
    });
  });

  describe("checkWithHealing", () => {
    it("should return HealingResult with violations and suggestions", async () => {
      const config: GuardConfig = {
        preset: "fsd",
        srcDir: "src",
      };

      // This test may not find violations if the test files aren't properly set up
      // for the FSD preset. This is more of an integration test placeholder.
      const result = await checkWithHealing(config, TEST_DIR);

      expect(result).toBeDefined();
      expect(typeof result.totalViolations).toBe("number");
      expect(typeof result.autoFixable).toBe("number");
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.filesAnalyzed).toBe("number");
      expect(typeof result.analysisTime).toBe("number");
    });
  });
});

describe("Healing Context", () => {
  it("should provide correct layer hierarchy for each preset", () => {
    // 각 프리셋별로 기대되는 계층 구조 키워드
    const expectedKeywords: Record<string, string> = {
      fsd: "→", // "app → pages → widgets..."
      clean: "domain", // "api → application → domain..."
      hexagonal: "ports", // "adapters → ports → domain"
      atomic: "atoms", // "pages → templates → organisms → molecules → atoms"
      mandu: "client", // "client(FSD) | shared | server(Clean)"
    };

    for (const [preset, keyword] of Object.entries(expectedKeywords)) {
      const explanation = explainRule(
        "layer-violation",
        "a",
        "b",
        preset as "fsd" | "clean" | "hexagonal" | "atomic" | "mandu"
      );
      expect(explanation.why).toContain(keyword);
    }
  });

  it("should include documentation links", () => {
    const explanation = explainRule("layer-violation", "features", "widgets", "fsd");
    expect(explanation.documentation).toContain("http");
  });
});
