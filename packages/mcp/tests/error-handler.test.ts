/**
 * MCP Error Handler Tests
 */

import { describe, it, expect } from "vitest";
import {
  formatMcpError,
  createToolResponse,
  isErrorResponse,
  extractErrorFromResponse,
} from "../src/executor/error-handler.js";

describe("Error Handler", () => {
  describe("formatMcpError", () => {
    it("should format basic error", () => {
      const error = new Error("Something went wrong");
      const result = formatMcpError(error, "test_tool");

      expect(result.error).toBe("Something went wrong");
      expect(result.category).toBe("unknown");
      expect(result.retryable).toBe(false);
      expect(result.context?.toolName).toBe("test_tool");
    });

    it("should classify network error", () => {
      const error = { code: "ECONNREFUSED", message: "Connection refused" };
      const result = formatMcpError(error);

      expect(result.category).toBe("network");
      expect(result.retryable).toBe(true);
      expect(result.code).toBe("ECONNREFUSED");
    });

    it("should classify system error", () => {
      const error = { code: "ENOENT", message: "File not found", path: "/some/path" };
      const result = formatMcpError(error);

      expect(result.category).toBe("system");
      expect(result.suggestion).toContain("/some/path");
    });

    it("should classify validation error", () => {
      const error = { status: 400, message: "Bad request" };
      const result = formatMcpError(error);

      expect(result.category).toBe("validation");
    });

    it("should classify auth error", () => {
      const error = { status: 401, message: "Unauthorized" };
      const result = formatMcpError(error);

      expect(result.category).toBe("auth");
    });

    it("should classify timeout error", () => {
      const error = { code: "ETIMEDOUT", message: "Timeout" };
      const result = formatMcpError(error);

      expect(result.category).toBe("timeout");
      expect(result.retryable).toBe(true);
    });

    it("should generate tool-specific suggestion for route error", () => {
      const error = { code: "ENOENT", message: "File not found" };
      const result = formatMcpError(error, "mandu_list_routes");

      expect(result.suggestion).toContain("mandu init");
    });
  });

  describe("createToolResponse", () => {
    it("should create success response", () => {
      const result = { routes: [{ id: "1" }] };
      const response = createToolResponse("test_tool", result);

      expect(response.isError).toBeUndefined();
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe("text");

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.routes).toHaveLength(1);
    });

    it("should create error response", () => {
      const error = new Error("Test error");
      const response = createToolResponse("test_tool", null, error);

      expect(response.isError).toBe(true);
      expect(response.content).toHaveLength(1);

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.error).toBe("Test error");
      expect(parsed.category).toBeDefined();
    });
  });

  describe("isErrorResponse", () => {
    it("should return true for error response", () => {
      const response = createToolResponse("test", null, new Error("Error"));
      expect(isErrorResponse(response)).toBe(true);
    });

    it("should return false for success response", () => {
      const response = createToolResponse("test", { success: true });
      expect(isErrorResponse(response)).toBe(false);
    });
  });

  describe("extractErrorFromResponse", () => {
    it("should extract error from error response", () => {
      const response = createToolResponse("test", null, new Error("Test error"));
      const extracted = extractErrorFromResponse(response);

      expect(extracted).not.toBeNull();
      expect(extracted?.error).toBe("Test error");
    });

    it("should return null for success response", () => {
      const response = createToolResponse("test", { success: true });
      const extracted = extractErrorFromResponse(response);

      expect(extracted).toBeNull();
    });
  });
});
