/**
 * DNA-007: Error Code Extraction Tests
 */

import { describe, it, expect } from "vitest";
import {
  extractErrorCode,
  extractStatusCode,
  extractErrorMessage,
  extractErrorInfo,
  classifyError,
  formatUncaughtError,
  isErrorCategory,
  isRetryableError,
  serializeError,
} from "../../src/errors/extractor";

describe("DNA-007: Error Code Extraction", () => {
  describe("extractErrorCode", () => {
    it("should extract code from Node.js system error", () => {
      const err = { code: "ENOENT", message: "File not found" };
      expect(extractErrorCode(err)).toBe("ENOENT");
    });

    it("should extract errorCode from custom error", () => {
      const err = { errorCode: "CUSTOM_001", message: "Custom error" };
      expect(extractErrorCode(err)).toBe("CUSTOM_001");
    });

    it("should convert errno to string", () => {
      const err = { errno: -2, message: "System error" };
      expect(extractErrorCode(err)).toBe("ERRNO_-2");
    });

    it("should return undefined for errors without code", () => {
      expect(extractErrorCode(new Error("Simple error"))).toBeUndefined();
      expect(extractErrorCode("string error")).toBeUndefined();
      expect(extractErrorCode(null)).toBeUndefined();
      expect(extractErrorCode(undefined)).toBeUndefined();
    });

    it("should prefer code over errorCode", () => {
      const err = { code: "CODE", errorCode: "ERROR_CODE" };
      expect(extractErrorCode(err)).toBe("CODE");
    });
  });

  describe("extractStatusCode", () => {
    it("should extract status from error object", () => {
      expect(extractStatusCode({ status: 404 })).toBe(404);
      expect(extractStatusCode({ statusCode: 500 })).toBe(500);
    });

    it("should extract status from axios-style response", () => {
      const axiosError = {
        response: { status: 401, data: {} },
        message: "Request failed",
      };
      expect(extractStatusCode(axiosError)).toBe(401);
    });

    it("should return undefined when no status", () => {
      expect(extractStatusCode(new Error("error"))).toBeUndefined();
      expect(extractStatusCode({})).toBeUndefined();
    });
  });

  describe("extractErrorMessage", () => {
    it("should extract message from Error", () => {
      expect(extractErrorMessage(new Error("Test error"))).toBe("Test error");
    });

    it("should return string directly", () => {
      expect(extractErrorMessage("String error")).toBe("String error");
    });

    it("should extract message property", () => {
      expect(extractErrorMessage({ message: "Object error" })).toBe("Object error");
    });

    it("should extract error property", () => {
      expect(extractErrorMessage({ error: "Error property" })).toBe("Error property");
    });

    it("should stringify objects without message", () => {
      expect(extractErrorMessage({ foo: "bar" })).toBe('{"foo":"bar"}');
    });
  });

  describe("classifyError", () => {
    it("should classify file system errors", () => {
      expect(classifyError({ code: "ENOENT" })).toBe("system");
      expect(classifyError({ code: "EACCES" })).toBe("system");
      expect(classifyError({ code: "EPERM" })).toBe("system");
    });

    it("should classify network errors", () => {
      expect(classifyError({ code: "ECONNREFUSED" })).toBe("network");
      expect(classifyError({ code: "ECONNRESET" })).toBe("network");
      expect(classifyError({ code: "ENOTFOUND" })).toBe("network");
    });

    it("should classify timeout errors", () => {
      expect(classifyError({ code: "ETIMEDOUT" })).toBe("timeout");
    });

    it("should classify HTTP errors by status code", () => {
      expect(classifyError({ status: 400 })).toBe("validation");
      expect(classifyError({ status: 401 })).toBe("auth");
      expect(classifyError({ status: 403 })).toBe("auth");
      expect(classifyError({ status: 404 })).toBe("validation");
      expect(classifyError({ status: 408 })).toBe("timeout");
      expect(classifyError({ status: 500 })).toBe("internal");
      expect(classifyError({ status: 502 })).toBe("external");
      expect(classifyError({ status: 503 })).toBe("external");
    });

    it("should classify by error name", () => {
      const validationError = new Error("Invalid");
      validationError.name = "ValidationError";
      expect(classifyError(validationError)).toBe("validation");

      const authError = new Error("Unauthorized");
      authError.name = "AuthenticationError";
      expect(classifyError(authError)).toBe("auth");
    });

    it("should classify by code pattern", () => {
      expect(classifyError({ code: "AUTH_FAILED" })).toBe("auth");
      expect(classifyError({ code: "VALIDATION_ERROR" })).toBe("validation");
      expect(classifyError({ code: "REQUEST_TIMEOUT" })).toBe("timeout");
      expect(classifyError({ code: "CONFIG_INVALID" })).toBe("config");
    });

    it("should return unknown for unclassifiable errors", () => {
      expect(classifyError(new Error("Random error"))).toBe("unknown");
      expect(classifyError("string error")).toBe("unknown");
    });
  });

  describe("extractErrorInfo", () => {
    it("should extract comprehensive info from Error", () => {
      const err = new Error("Test error");
      const info = extractErrorInfo(err);

      expect(info.message).toBe("Test error");
      expect(info.name).toBe("Error");
      expect(info.category).toBe("unknown");
      expect(info.stack).toBeDefined();
      expect(info.original).toBe(err);
    });

    it("should extract info from system error", () => {
      const err = {
        code: "ENOENT",
        message: "File not found",
        path: "/nonexistent",
        syscall: "open",
      };
      const info = extractErrorInfo(err);

      expect(info.code).toBe("ENOENT");
      expect(info.message).toBe("File not found");
      expect(info.category).toBe("system");
      expect(info.context?.path).toBe("/nonexistent");
      expect(info.context?.syscall).toBe("open");
    });

    it("should extract info from HTTP error", () => {
      const err = {
        status: 404,
        message: "Not Found",
        url: "https://api.example.com/resource",
      };
      const info = extractErrorInfo(err);

      expect(info.statusCode).toBe(404);
      expect(info.category).toBe("validation");
      expect(info.context?.url).toBe("https://api.example.com/resource");
    });
  });

  describe("formatUncaughtError", () => {
    it("should format basic error", () => {
      const err = new Error("Something went wrong");
      const formatted = formatUncaughtError(err);

      expect(formatted).toContain("[UNKNOWN]");
      expect(formatted).toContain("Error:");
      expect(formatted).toContain("Something went wrong");
    });

    it("should format error with code", () => {
      const err = { code: "ENOENT", message: "File not found", path: "/test" };
      const formatted = formatUncaughtError(err);

      expect(formatted).toContain("[ENOENT]");
      expect(formatted).toContain("File not found");
      expect(formatted).toContain("path: /test");
    });

    it("should include stack in verbose mode", () => {
      const err = new Error("Test");
      const formatted = formatUncaughtError(err, true);

      expect(formatted).toContain("Stack trace:");
    });
  });

  describe("isErrorCategory", () => {
    it("should check error category correctly", () => {
      expect(isErrorCategory({ code: "ENOENT" }, "system")).toBe(true);
      expect(isErrorCategory({ code: "ENOENT" }, "network")).toBe(false);
      expect(isErrorCategory({ status: 401 }, "auth")).toBe(true);
    });
  });

  describe("isRetryableError", () => {
    it("should identify retryable errors", () => {
      expect(isRetryableError({ code: "ECONNREFUSED" })).toBe(true);
      expect(isRetryableError({ code: "ETIMEDOUT" })).toBe(true);
      expect(isRetryableError({ status: 429 })).toBe(true);
      expect(isRetryableError({ status: 503 })).toBe(true);
    });

    it("should identify non-retryable errors", () => {
      expect(isRetryableError({ code: "ENOENT" })).toBe(false);
      expect(isRetryableError({ status: 400 })).toBe(false);
      expect(isRetryableError({ status: 404 })).toBe(false);
      expect(isRetryableError(new Error("validation"))).toBe(false);
    });
  });

  describe("serializeError", () => {
    it("should serialize error to JSON-safe object", () => {
      const err = new Error("Test error");
      (err as any).code = "TEST_CODE";

      const serialized = serializeError(err);

      expect(serialized.name).toBe("Error");
      expect(serialized.message).toBe("Test error");
      expect(serialized.code).toBe("TEST_CODE");
      expect(typeof serialized.stack).toBe("string");
    });

    it("should handle non-Error objects", () => {
      const err = { message: "Object error", status: 500 };
      const serialized = serializeError(err);

      expect(serialized.message).toBe("Object error");
      expect(serialized.statusCode).toBe(500);
      expect(serialized.category).toBe("internal");
    });
  });
});
