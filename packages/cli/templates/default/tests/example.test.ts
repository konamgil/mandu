// Mandu Example Test
// 이 파일은 테스트 작성 방법을 보여주는 예제입니다.

import { describe, it, expect } from "bun:test";
import { createTestRequest, parseJsonResponse, assertStatus } from "./helpers";

describe("Example Tests", () => {
  describe("Basic Assertions", () => {
    it("should pass basic equality test", () => {
      expect(1 + 1).toBe(2);
    });

    it("should pass object equality test", () => {
      const obj = { status: "ok", data: { message: "hello" } };
      expect(obj).toEqual({
        status: "ok",
        data: { message: "hello" },
      });
    });
  });

  describe("Test Helpers", () => {
    it("should create test request", () => {
      const req = createTestRequest("http://localhost:3000/api/test", {
        method: "POST",
        body: { name: "test" },
      });

      expect(req.method).toBe("POST");
      expect(req.url).toBe("http://localhost:3000/api/test");
    });

    it("should parse JSON response", async () => {
      const mockResponse = new Response(
        JSON.stringify({ status: "ok" }),
        { status: 200 }
      );

      const data = await parseJsonResponse<{ status: string }>(mockResponse);
      expect(data.status).toBe("ok");
    });
  });
});

// API 핸들러 테스트 예제 (실제 핸들러 import 후 사용)
// import handler from "../apps/server/generated/routes/health.route";
//
// describe("API: GET /api/health", () => {
//   it("should return 200 with status ok", async () => {
//     const req = createTestRequest("http://localhost:3000/api/health");
//     const response = handler(req, {});
//
//     assertStatus(response, 200);
//
//     const data = await parseJsonResponse<{ status: string }>(response);
//     expect(data.status).toBe("ok");
//   });
// });
