/**
 * ErrorClassifier Tests
 */

import { describe, test, expect } from "bun:test";
import {
  ErrorClassifier,
  createSpecError,
  createLogicError,
  createFrameworkBug,
} from "../../packages/core/src/error/classifier";
import { ErrorCode } from "../../packages/core/src/error/types";

describe("ErrorClassifier", () => {
  describe("classify", () => {
    test("should classify ValidationError as LOGIC_ERROR", () => {
      const classifier = new ErrorClassifier(null, { id: "users", pattern: "/api/users" });

      // Create a mock ValidationError-like object
      const error = {
        errors: [{ path: "name", message: "Required" }],
        message: "Validation failed",
        name: "ValidationError",
      };

      const result = classifier.classify(error);

      expect(result.errorType).toBe("LOGIC_ERROR");
      expect(result.code).toBe(ErrorCode.SLOT_VALIDATION_ERROR);
    });

    test("should classify non-Error values as LOGIC_ERROR", () => {
      const classifier = new ErrorClassifier(null);
      const result = classifier.classify("string error");

      expect(result.errorType).toBe("LOGIC_ERROR");
      expect(result.message).toContain("string error");
    });

    test("should classify slot errors by stack trace", () => {
      const classifier = new ErrorClassifier(null, { id: "users", pattern: "/api/users" });

      const error = new Error("Slot error");
      error.stack = `Error: Slot error
    at handler (spec/slots/users.slot.ts:15:10)
    at processRequest (packages/core/src/filling/filling.ts:50:5)`;

      const result = classifier.classify(error);

      expect(result.errorType).toBe("LOGIC_ERROR");
      expect(result.fix.file).toContain("users.slot.ts");
    });

    test("should classify spec errors by stack trace", () => {
      const classifier = new ErrorClassifier(null);

      const error = new Error("Spec parse error");
      error.stack = `Error: Spec parse error
    at parseSpec (spec/load.ts:25:10)
    at init (packages/core/src/index.ts:10:5)`;

      const result = classifier.classify(error);

      expect(result.errorType).toBe("SPEC_ERROR");
    });

    test("should classify framework errors by stack trace", () => {
      const classifier = new ErrorClassifier(null);

      const error = new Error("Internal framework error");
      error.stack = `Error: Internal framework error
    at internalFunction (packages/core/src/runtime/server.ts:45:10)
    at handleRequest (packages/core/src/runtime/server.ts:100:5)`;

      const result = classifier.classify(error);

      expect(result.errorType).toBe("FRAMEWORK_BUG");
    });

    test("should default to LOGIC_ERROR for unknown errors", () => {
      const classifier = new ErrorClassifier(null);

      const error = new Error("Unknown error");
      error.stack = `Error: Unknown error
    at unknownFunction (unknown/path/file.ts:10:5)`;

      const result = classifier.classify(error);

      expect(result.errorType).toBe("LOGIC_ERROR");
    });

    test("should include route context when provided", () => {
      const classifier = new ErrorClassifier(null, { id: "health", pattern: "/api/health" });

      const error = new Error("Test error");
      const result = classifier.classify(error);

      expect(result.route).toEqual({
        id: "health",
        pattern: "/api/health",
      });
    });

    test("should include timestamp", () => {
      const classifier = new ErrorClassifier(null);
      const result = classifier.classify(new Error("Test"));

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });
  });
});

describe("Helper Functions", () => {
  describe("createSpecError", () => {
    test("should create SPEC_ERROR with correct structure", () => {
      const error = createSpecError(
        ErrorCode.SPEC_NOT_FOUND,
        "Spec file not found",
        "spec/routes.manifest.json",
        "spec 파일을 생성하세요"
      );

      expect(error.errorType).toBe("SPEC_ERROR");
      expect(error.code).toBe(ErrorCode.SPEC_NOT_FOUND);
      expect(error.fix.file).toBe("spec/routes.manifest.json");
    });
  });

  describe("createLogicError", () => {
    test("should create LOGIC_ERROR with correct structure", () => {
      const error = createLogicError(
        ErrorCode.SLOT_RUNTIME_ERROR,
        "Runtime error in slot",
        "spec/slots/users.slot.ts",
        undefined,
        "슬롯 코드를 확인하세요"
      );

      expect(error.errorType).toBe("LOGIC_ERROR");
      expect(error.code).toBe(ErrorCode.SLOT_RUNTIME_ERROR);
    });

    test("should include route context when provided", () => {
      const error = createLogicError(
        ErrorCode.SLOT_RUNTIME_ERROR,
        "Runtime error",
        "spec/slots/users.slot.ts",
        { id: "users", pattern: "/api/users" }
      );

      expect(error.route).toEqual({
        id: "users",
        pattern: "/api/users",
      });
    });
  });

  describe("createFrameworkBug", () => {
    test("should create FRAMEWORK_BUG with correct structure", () => {
      const error = createFrameworkBug(
        ErrorCode.FRAMEWORK_INTERNAL,
        "Internal framework error",
        "packages/core/src/runtime/server.ts"
      );

      expect(error.errorType).toBe("FRAMEWORK_BUG");
      expect(error.code).toBe(ErrorCode.FRAMEWORK_INTERNAL);
    });
  });
});
