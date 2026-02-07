/**
 * Security - Import Validation Tests
 *
 * 동적 import 경로 검증 테스트
 */

import { describe, it, expect } from "bun:test";
import { validateImportPath, isValidImportPath } from "../../src/runtime/security";

const ROOT_DIR = "/project";

describe("Import Path Validation", () => {
  describe("허용된 경로", () => {
    it("app/ 디렉토리 허용", () => {
      const result = validateImportPath(ROOT_DIR, "app/layout.tsx");
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Windows/Unix 경로 모두 허용
        expect(result.value.replace(/\\/g, "/")).toContain("app/layout.tsx");
      }
    });

    it("src/client/ 디렉토리 허용", () => {
      const result = validateImportPath(ROOT_DIR, "src/client/components/Button.tsx");
      expect(result.ok).toBe(true);
    });

    it("src/server/ 디렉토리 허용", () => {
      const result = validateImportPath(ROOT_DIR, "src/server/services/auth.ts");
      expect(result.ok).toBe(true);
    });

    it("src/shared/ 디렉토리 허용", () => {
      const result = validateImportPath(ROOT_DIR, "src/shared/types/index.ts");
      expect(result.ok).toBe(true);
    });

    it("spec/ 디렉토리 허용 (레거시)", () => {
      const result = validateImportPath(ROOT_DIR, "spec/slots/api.slot.ts");
      expect(result.ok).toBe(true);
    });
  });

  describe("Path Traversal 차단", () => {
    it("../ 경로 차단", () => {
      const result = validateImportPath(ROOT_DIR, "../etc/passwd");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("경로 탐색");
      }
    });

    it("app/../.. 경로 차단", () => {
      const result = validateImportPath(ROOT_DIR, "app/../../secret.ts");
      expect(result.ok).toBe(false);
    });

    it("정규화 후 ../ 감지", () => {
      const result = validateImportPath(ROOT_DIR, "app/pages/../../../etc/passwd");
      expect(result.ok).toBe(false);
    });
  });

  describe("차단된 패턴", () => {
    it("node_modules 차단", () => {
      const result = validateImportPath(ROOT_DIR, "node_modules/react/index.js");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("차단된 경로");
      }
    });

    it(".env 파일 차단", () => {
      const result = validateImportPath(ROOT_DIR, ".env");
      expect(result.ok).toBe(false);
    });

    it(".env.local 파일 차단", () => {
      const result = validateImportPath(ROOT_DIR, ".env.local");
      expect(result.ok).toBe(false);
    });

    it(".git 디렉토리 차단", () => {
      const result = validateImportPath(ROOT_DIR, ".git/config");
      expect(result.ok).toBe(false);
    });
  });

  describe("허용되지 않은 경로", () => {
    it("루트 레벨 파일 차단", () => {
      const result = validateImportPath(ROOT_DIR, "secret.ts");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("허용되지 않은 import");
      }
    });

    it("lib/ 디렉토리 차단", () => {
      const result = validateImportPath(ROOT_DIR, "lib/utils.ts");
      expect(result.ok).toBe(false);
    });

    it("config/ 디렉토리 차단", () => {
      const result = validateImportPath(ROOT_DIR, "config/database.ts");
      expect(result.ok).toBe(false);
    });
  });

  describe("확장자 검증", () => {
    it(".ts 허용", () => {
      expect(isValidImportPath(ROOT_DIR, "app/page.ts")).toBe(true);
    });

    it(".tsx 허용", () => {
      expect(isValidImportPath(ROOT_DIR, "app/page.tsx")).toBe(true);
    });

    it(".js 허용", () => {
      expect(isValidImportPath(ROOT_DIR, "app/page.js")).toBe(true);
    });

    it(".jsx 허용", () => {
      expect(isValidImportPath(ROOT_DIR, "app/page.jsx")).toBe(true);
    });

    it(".json 차단", () => {
      expect(isValidImportPath(ROOT_DIR, "app/data.json")).toBe(false);
    });

    it(".sh 차단", () => {
      expect(isValidImportPath(ROOT_DIR, "app/script.sh")).toBe(false);
    });
  });

  describe("경로 정규화", () => {
    it("백슬래시를 슬래시로 변환", () => {
      const result = validateImportPath(ROOT_DIR, "app\\pages\\home.tsx");
      expect(result.ok).toBe(true);
    });

    it("중복 슬래시 정규화", () => {
      const result = validateImportPath(ROOT_DIR, "app//pages///home.tsx");
      expect(result.ok).toBe(true);
    });
  });
});
