/**
 * Error Formatter Tests
 */

import { describe, test, expect } from "bun:test";
import {
  formatErrorResponse,
  formatErrorForConsole,
  createNotFoundResponse,
  createHandlerNotFoundResponse,
  createPageLoadErrorResponse,
  createSSRErrorResponse,
} from "../../packages/core/src/error/formatter";
import { ErrorCode } from "../../packages/core/src/error/types";
import type { ManduError } from "../../packages/core/src/error/types";

describe("formatErrorResponse", () => {
  const sampleError: ManduError = {
    errorType: "LOGIC_ERROR",
    code: ErrorCode.SLOT_RUNTIME_ERROR,
    message: "Test error message",
    summary: "테스트 에러 요약",
    fix: {
      file: "spec/slots/test.slot.ts",
      line: 10,
      suggestion: "코드를 확인하세요",
    },
    route: {
      id: "test",
      pattern: "/api/test",
    },
    debug: {
      stack: "Error: Test\n    at test (file.ts:10:5)",
      originalError: "Original message",
    },
    timestamp: "2024-01-01T00:00:00.000Z",
  };

  test("should include all basic fields", () => {
    const response = formatErrorResponse(sampleError);

    expect(response).toHaveProperty("errorType", "LOGIC_ERROR");
    expect(response).toHaveProperty("code", ErrorCode.SLOT_RUNTIME_ERROR);
    expect(response).toHaveProperty("message", "Test error message");
    expect(response).toHaveProperty("summary", "테스트 에러 요약");
    expect(response).toHaveProperty("fix");
    expect(response).toHaveProperty("timestamp");
  });

  test("should include route when present", () => {
    const response = formatErrorResponse(sampleError) as Record<string, unknown>;

    expect(response.route).toEqual({
      id: "test",
      pattern: "/api/test",
    });
  });

  test("should include debug info in dev mode", () => {
    const response = formatErrorResponse(sampleError, { isDev: true }) as Record<string, unknown>;

    expect(response.debug).toBeDefined();
    expect((response.debug as Record<string, unknown>).stack).toBeDefined();
  });

  test("should exclude debug info in production mode", () => {
    const response = formatErrorResponse(sampleError, { isDev: false }) as Record<string, unknown>;

    expect(response.debug).toBeUndefined();
  });
});

describe("formatErrorForConsole", () => {
  const sampleError: ManduError = {
    errorType: "SPEC_ERROR",
    code: ErrorCode.SPEC_NOT_FOUND,
    message: "Spec file not found",
    summary: "스펙 파일 없음",
    fix: {
      file: "spec/routes.manifest.json",
      suggestion: "스펙 파일을 생성하세요",
    },
    timestamp: new Date().toISOString(),
  };

  test("should format error for console output", () => {
    const output = formatErrorForConsole(sampleError);

    expect(output).toContain("SPEC_ERROR");
    expect(output).toContain(ErrorCode.SPEC_NOT_FOUND);
    expect(output).toContain("Spec file not found");
  });

  test("should include fix suggestion", () => {
    const output = formatErrorForConsole(sampleError);

    expect(output).toContain("Fix:");
    expect(output).toContain("spec/routes.manifest.json");
    expect(output).toContain("스펙 파일을 생성하세요");
  });

  test("should work without colors", () => {
    const output = formatErrorForConsole(sampleError, { useColors: false });

    // Should not contain ANSI escape codes
    expect(output).not.toContain("\x1b[");
  });
});

describe("createNotFoundResponse", () => {
  test("should create 404 error structure", () => {
    const error = createNotFoundResponse("/api/unknown");

    expect(error.errorType).toBe("SPEC_ERROR");
    expect(error.code).toBe(ErrorCode.SPEC_ROUTE_NOT_FOUND);
    expect(error.message).toContain("/api/unknown");
    expect(error.fix.file).toBe("spec/routes.manifest.json");
  });

  test("should include route context when provided", () => {
    const error = createNotFoundResponse("/api/test", {
      id: "test",
      pattern: "/api/test",
    });

    expect(error.route).toEqual({
      id: "test",
      pattern: "/api/test",
    });
  });
});

describe("createHandlerNotFoundResponse", () => {
  test("should create handler not found error", () => {
    const error = createHandlerNotFoundResponse("users", "/api/users");

    expect(error.errorType).toBe("FRAMEWORK_BUG");
    expect(error.code).toBe(ErrorCode.FRAMEWORK_ROUTER_ERROR);
    expect(error.message).toContain("users");
    expect(error.fix.file).toContain("users.route.ts");
    expect(error.route).toEqual({
      id: "users",
      pattern: "/api/users",
    });
  });
});

describe("createPageLoadErrorResponse", () => {
  test("should create page load error", () => {
    const error = createPageLoadErrorResponse("home", "/");

    expect(error.errorType).toBe("LOGIC_ERROR");
    expect(error.code).toBe(ErrorCode.SLOT_IMPORT_ERROR);
    expect(error.message).toContain("home");
    expect(error.fix.file).toContain("home.route.tsx");
    expect(error.route?.kind).toBe("page");
  });

  test("should include original error details in dev mode", () => {
    const originalError = new Error("Module not found");
    originalError.stack = "Error: Module not found\n    at require (file.ts:10:5)";

    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const error = createPageLoadErrorResponse("home", "/", originalError);

    expect(error.debug).toBeDefined();
    expect(error.debug?.originalError).toBe("Module not found");
    expect(error.debug?.stack).toContain("Module not found");

    process.env.NODE_ENV = oldEnv;
  });
});

describe("createSSRErrorResponse", () => {
  test("should create SSR error", () => {
    const error = createSSRErrorResponse("dashboard", "/dashboard");

    expect(error.errorType).toBe("FRAMEWORK_BUG");
    expect(error.code).toBe(ErrorCode.FRAMEWORK_SSR_ERROR);
    expect(error.message).toContain("dashboard");
    expect(error.fix.suggestion).toContain("브라우저 전용 API");
    expect(error.route?.kind).toBe("page");
  });

  test("should include original error details in dev mode", () => {
    const originalError = new Error("window is not defined");
    originalError.stack = "ReferenceError: window is not defined\n    at Component (App.tsx:5:3)";

    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const error = createSSRErrorResponse("dashboard", "/dashboard", originalError);

    expect(error.debug?.originalError).toBe("window is not defined");

    process.env.NODE_ENV = oldEnv;
  });
});
