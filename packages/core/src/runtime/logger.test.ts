/**
 * Mandu Runtime Logger Tests
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { ManduContext } from "../filling/context";
import { logger, devLogger, prodLogger, type LogEntry } from "./logger";

// Mock Request 생성 헬퍼
function createMockRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {}
): Request {
  return new Request(url, {
    method,
    headers: new Headers(headers),
  });
}

// Mock ManduContext 생성 헬퍼
function createMockContext(
  method: string = "GET",
  path: string = "/api/test",
  headers: Record<string, string> = {}
): ManduContext {
  const request = createMockRequest(method, `http://localhost${path}`, headers);
  return new ManduContext(request);
}

describe("logger", () => {
  describe("기본 동작", () => {
    test("logger()는 훅 객체를 반환", () => {
      const log = logger();

      expect(log).toHaveProperty("onRequest");
      expect(log).toHaveProperty("onError");
      expect(log).toHaveProperty("afterHandle");
      expect(log).toHaveProperty("afterResponse");
      expect(typeof log.onRequest).toBe("function");
      expect(typeof log.onError).toBe("function");
      expect(typeof log.afterHandle).toBe("function");
      expect(typeof log.afterResponse).toBe("function");
    });

    test("onRequest는 시작 시간과 requestId를 저장", () => {
      const log = logger();
      const ctx = createMockContext();

      log.onRequest(ctx);

      expect(ctx.has("__mandu_logger_start")).toBe(true);
      expect(ctx.has("__mandu_logger_request_id")).toBe(true);
      expect(typeof ctx.get("__mandu_logger_start")).toBe("number");
      expect(typeof ctx.get("__mandu_logger_request_id")).toBe("string");
    });

    test("onError는 에러를 저장", () => {
      const log = logger();
      const ctx = createMockContext();
      const error = new Error("Test error");

      log.onError(ctx, error);

      expect(ctx.get<Error>("__mandu_logger_error")).toBe(error);
    });

    test("afterHandle은 응답을 저장하고 반환", () => {
      const log = logger();
      const ctx = createMockContext();
      const response = new Response("OK");

      const result = log.afterHandle(ctx, response);

      expect(ctx.get<Response>("__mandu_logger_response")).toBe(response);
      expect(result).toBe(response);
    });
  });

  describe("skip 옵션", () => {
    test("skip 패턴에 매칭되는 경로는 로깅하지 않음", () => {
      const log = logger({ skip: ["/health", "/metrics"] });
      const ctx = createMockContext("GET", "/health");

      log.onRequest(ctx);

      // skip된 요청은 시작 시간이 저장되지 않음
      expect(ctx.has("__mandu_logger_start")).toBe(false);
    });

    test("정규식 패턴도 지원", () => {
      const log = logger({ skip: [/^\/static\//] });
      const ctx = createMockContext("GET", "/static/image.png");

      log.onRequest(ctx);

      expect(ctx.has("__mandu_logger_start")).toBe(false);
    });

    test("skip 패턴에 매칭되지 않으면 로깅", () => {
      const log = logger({ skip: ["/health"] });
      const ctx = createMockContext("GET", "/api/users");

      log.onRequest(ctx);

      expect(ctx.has("__mandu_logger_start")).toBe(true);
    });
  });

  describe("sampleRate 옵션", () => {
    test("sampleRate: 0이면 모든 요청 skip", () => {
      const log = logger({ sampleRate: 0 });
      const ctx = createMockContext();

      log.onRequest(ctx);

      expect(ctx.has("__mandu_logger_start")).toBe(false);
    });

    test("sampleRate: 1이면 모든 요청 로깅", () => {
      const log = logger({ sampleRate: 1 });
      const ctx = createMockContext();

      log.onRequest(ctx);

      expect(ctx.has("__mandu_logger_start")).toBe(true);
    });
  });

  describe("requestId 옵션", () => {
    test("auto 모드는 자동 생성", () => {
      const log = logger({ requestId: "auto" });
      const ctx = createMockContext();

      log.onRequest(ctx);

      const requestId = ctx.get<string>("__mandu_logger_request_id");
      expect(requestId).toBeDefined();
      expect(requestId!.length).toBeGreaterThan(0);
    });

    test("커스텀 함수로 requestId 생성", () => {
      const log = logger({
        requestId: (ctx) => `custom-${ctx.method}-123`,
      });
      const ctx = createMockContext("POST", "/api/test");

      log.onRequest(ctx);

      expect(ctx.get<string>("__mandu_logger_request_id")).toBe("custom-POST-123");
    });
  });

  describe("sink 옵션", () => {
    test("sink 함수로 로그 엔트리 캡처", async () => {
      const entries: LogEntry[] = [];
      const log = logger({
        sink: (entry) => entries.push(entry),
      });

      const ctx = createMockContext("GET", "/api/users");
      const response = new Response("OK", { status: 200 });

      log.onRequest(ctx);
      log.afterHandle(ctx, response);
      await log.afterResponse(ctx);

      expect(entries.length).toBe(1);
      expect(entries[0].method).toBe("GET");
      expect(entries[0].path).toBe("/api/users");
      expect(entries[0].status).toBe(200);
      expect(entries[0].duration).toBeGreaterThanOrEqual(0);
    });

    test("에러 시 level이 error", async () => {
      const entries: LogEntry[] = [];
      const log = logger({
        sink: (entry) => entries.push(entry),
      });

      const ctx = createMockContext();
      const error = new Error("Something went wrong");

      log.onRequest(ctx);
      log.onError(ctx, error);
      await log.afterResponse(ctx);

      expect(entries[0].level).toBe("error");
      expect(entries[0].error?.message).toBe("Something went wrong");
    });
  });

  describe("레드액션", () => {
    test("기본 민감 헤더는 자동 마스킹", async () => {
      const entries: LogEntry[] = [];
      const log = logger({
        sink: (entry) => entries.push(entry),
        includeHeaders: true,
        level: "debug",
      });

      const ctx = createMockContext("GET", "/api/test", {
        Authorization: "Bearer secret-token",
        "X-Api-Key": "my-api-key",
        "Content-Type": "application/json",
      });
      const response = new Response("OK");

      log.onRequest(ctx);
      log.afterHandle(ctx, response);
      await log.afterResponse(ctx);

      const headers = entries[1].headers!;
      expect(headers["authorization"]).toBe("[REDACTED]");
      expect(headers["x-api-key"]).toBe("[REDACTED]");
      expect(headers["content-type"]).toBe("application/json");
    });

    test("커스텀 레드액션 패턴 추가", async () => {
      const entries: LogEntry[] = [];
      const log = logger({
        sink: (entry) => entries.push(entry),
        includeHeaders: true,
        level: "debug",
        redact: ["x-custom-secret"],
      });

      const ctx = createMockContext("GET", "/api/test", {
        "X-Custom-Secret": "my-secret",
        "X-Public": "public-value",
      });
      const response = new Response("OK");

      log.onRequest(ctx);
      log.afterHandle(ctx, response);
      await log.afterResponse(ctx);

      const headers = entries[1].headers!;
      expect(headers["x-custom-secret"]).toBe("[REDACTED]");
      expect(headers["x-public"]).toBe("public-value");
    });
  });

  describe("느린 요청 감지", () => {
    test("slowThresholdMs 초과 시 slow 플래그 설정", async () => {
      const entries: LogEntry[] = [];
      const log = logger({
        sink: (entry) => entries.push(entry),
        slowThresholdMs: 0, // 모든 요청이 "느림"
      });

      const ctx = createMockContext();
      const response = new Response("OK");

      log.onRequest(ctx);
      log.afterHandle(ctx, response);
      await log.afterResponse(ctx);

      expect(entries[0].slow).toBe(true);
      expect(entries[0].level).toBe("warn");
    });
  });
});

describe("devLogger", () => {
  test("개발용 기본 설정", () => {
    const log = devLogger();
    const ctx = createMockContext();

    // devLogger는 debug 레벨이므로 요청 시작도 로깅해야 함
    // (console.log가 호출되는지는 sink로 테스트)
    log.onRequest(ctx);

    expect(ctx.has("__mandu_logger_start")).toBe(true);
  });

  test("커스텀 옵션 병합", async () => {
    const entries: LogEntry[] = [];
    const log = devLogger({
      sink: (entry) => entries.push(entry),
      skip: ["/health"],
    });

    const ctx1 = createMockContext("GET", "/api/test");
    const ctx2 = createMockContext("GET", "/health");
    const response = new Response("OK");

    log.onRequest(ctx1);
    log.afterHandle(ctx1, response);
    await log.afterResponse(ctx1);

    log.onRequest(ctx2);

    // /health는 skip되어야 함
    expect(ctx2.has("__mandu_logger_start")).toBe(false);
    // /api/test는 debug 모드라 요청+응답 2개
    expect(entries.length).toBe(2);
  });
});

describe("prodLogger", () => {
  test("프로덕션용 기본 설정", async () => {
    const entries: LogEntry[] = [];
    const log = prodLogger({
      sink: (entry) => entries.push(entry),
    });

    const ctx = createMockContext();
    const response = new Response("OK");

    log.onRequest(ctx);
    log.afterHandle(ctx, response);
    await log.afterResponse(ctx);

    // prodLogger는 info 레벨이므로 응답만 로깅
    expect(entries.length).toBe(1);
    expect(entries[0].headers).toBeUndefined(); // includeHeaders: false
    expect(entries[0].body).toBeUndefined(); // includeBody: false
  });
});

describe("로그 포맷", () => {
  test("JSON 포맷은 파싱 가능한 JSON 출력", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output = msg;
    };

    const log = logger({ format: "json" });
    const ctx = createMockContext();
    const response = new Response("OK");

    log.onRequest(ctx);
    log.afterHandle(ctx, response);
    await log.afterResponse(ctx);

    console.log = originalLog;

    const parsed = JSON.parse(output);
    expect(parsed.method).toBe("GET");
    expect(parsed.path).toBe("/api/test");
    expect(parsed.status).toBe(200);
  });
});
