/**
 * Mandu Testing Utilities
 *
 * The `@mandujs/core/testing` barrel. Everything a test file needs:
 *
 * - Filling-level stubs (`testFilling`, `createTestRequest`, `createTestContext`)
 * - Manifest / island factories (`createTestManifest`, `createTestIsland`)
 * - MCP fixtures (`createMockMcpContext`)
 * - **Phase 12.1** HTTP/session/db/mock fixtures:
 *   - `createTestServer` — ephemeral-port in-process Bun.serve
 *   - `createTestSession` — pre-signed session cookie (no login roundtrip)
 *   - `createTestDb` — in-memory SQLite fixture
 *   - `mockMail`, `mockStorage` — dependency-injectable I/O mocks
 *
 * All fixtures produced by this module support idempotent `close()`/`clear()`
 * and, where applicable, `Symbol.asyncDispose` / `Symbol.dispose` for the
 * ES2023 `using` syntax. Prefer those over hand-rolled afterEach chains —
 * they stay correct even when a test throws mid-setup.
 */

import path from "path";
import os from "os";
import { ManduContext } from "../filling/context";
import type { ManduFilling } from "../filling/filling";
import type { RouteSpec, RoutesManifest } from "../spec/schema";

// ========== Types ==========

export interface TestRequestOptions {
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  /** Action 이름 — 자동으로 _action을 body에 삽입하고 ManduAction 헤더를 추가 */
  action?: string;
}

// ========== testFilling ==========

/**
 * Filling 단위 테스트 — 서버 없이 직접 실행
 *
 * @example
 * ```typescript
 * import { testFilling } from "@mandujs/core/testing";
 * import todoRoute from "./app/api/todos/route";
 *
 * const res = await testFilling(todoRoute, {
 *   method: "GET",
 *   query: { page: "2" },
 * });
 * expect(res.status).toBe(200);
 *
 * const data = await res.json();
 * expect(data.todos).toHaveLength(10);
 * ```
 */
export async function testFilling(
  filling: ManduFilling,
  options: TestRequestOptions = {}
): Promise<Response> {
  const {
    method: rawMethod,
    query,
    body: rawBody,
    headers: rawHeaders = {},
    params = {},
    action,
  } = options;

  // action 지정 시 자동으로 POST + _action body + ManduAction 헤더
  const method = rawMethod ?? (action ? "POST" : "GET");
  const headers = { ...rawHeaders };
  let body = rawBody;

  if (action) {
    headers["X-Requested-With"] = "ManduAction";
    headers["Accept"] = "application/json";
    if (body && typeof body === "object" && !(body instanceof FormData)) {
      body = { _action: action, ...(body as Record<string, unknown>) };
    } else if (!body) {
      body = { _action: action };
    }
  }

  const url = new URL("http://localhost/test");
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const requestInit: RequestInit = {
    method,
    headers,
  };

  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    if (body instanceof FormData) {
      requestInit.body = body;
    } else {
      requestInit.body = JSON.stringify(body);
      (requestInit.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
  }

  const request = new Request(url.toString(), requestInit);
  return filling.handle(request, params);
}

/**
 * 간단한 Request 생성 헬퍼
 *
 * @example
 * ```typescript
 * const req = createTestRequest("/api/todos", { method: "POST", body: { title: "test" } });
 * ```
 */
export function createTestRequest(
  path: string,
  options: TestRequestOptions = {}
): Request {
  const { method = "GET", query, body, headers = {} } = options;

  const url = new URL(`http://localhost${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const requestInit: RequestInit = { method, headers: { ...headers } };

  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    if (body instanceof FormData) {
      requestInit.body = body;
    } else {
      requestInit.body = JSON.stringify(body);
      (requestInit.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
  }

  return new Request(url.toString(), requestInit);
}

/**
 * ManduContext 테스트용 생성 헬퍼
 *
 * @example
 * ```typescript
 * const ctx = createTestContext("/api/users/123", { params: { id: "123" } });
 * expect(ctx.params.id).toBe("123");
 * ```
 */
export function createTestContext(
  path: string,
  options: TestRequestOptions = {}
): ManduContext {
  const request = createTestRequest(path, options);
  return new ManduContext(request, options.params);
}

// ========== Test Factories ==========

/**
 * Create a RoutesManifest from partial route definitions.
 * Fills in sensible defaults so tests only specify the fields they care about.
 *
 * @example
 * ```typescript
 * const manifest = createTestManifest([
 *   { id: "home", kind: "page", pattern: "/" },
 *   { id: "api-users", kind: "api", pattern: "/api/users" },
 * ]);
 * ```
 */
export function createTestManifest(routes: Partial<RouteSpec>[]): RoutesManifest {
  return {
    version: 1,
    routes: routes.map((r, i) => ({
      id: r.id ?? `test-route-${i}`,
      kind: r.kind ?? "page",
      pattern: r.pattern ?? `/test-${i}`,
      module: r.module ?? `app/test-${i}/page.tsx`,
      componentModule:
        (r.kind ?? "page") === "page"
          ? (r.componentModule ?? r.module ?? `app/test-${i}/page.tsx`)
          : undefined,
      ...r,
    })) as RouteSpec[],
  };
}

/**
 * Create a minimal island descriptor for testing hydration logic.
 *
 * @example
 * ```typescript
 * const island = createTestIsland("counter", "interaction");
 * expect(island.__hydrate).toBe("interaction");
 * ```
 */
export function createTestIsland(name: string, strategy: string = "visible") {
  return { __island: true, __hydrate: strategy, __name: name };
}

// ========== createMockMcpContext ==========

/**
 * Mock MCP context shape mirroring the real MCP server context
 * (see `packages/mcp/src/utils/project.ts`).
 *
 * Use this in tests for MCP tool plugins and slot/contract validators
 * that accept an MCP-context-like object.
 */
export interface MockMcpContext {
  paths: {
    repoRoot: string;
    manduDir: string;
    manifestPath: string;
    specsDir: string;
    slotsDir: string;
  };
  readConfig: () => Promise<Record<string, unknown>>;
  readManifest: () => Promise<RoutesManifest>;
}

/**
 * Create a mock MCP context suitable for unit-testing MCP tools without
 * spinning up an actual project on disk.
 *
 * @example
 * ```typescript
 * const ctx = createMockMcpContext({
 *   config: { guard: { preset: "fsd" } },
 *   manifest: createTestManifest([{ id: "home", kind: "page", pattern: "/" }]),
 * });
 * await myTool.execute(ctx, { input: "..." });
 * ```
 */
export function createMockMcpContext(options: {
  root?: string;
  config?: Record<string, unknown>;
  manifest?: RoutesManifest;
} = {}): MockMcpContext {
  const root = options.root ?? path.join(os.tmpdir(), "mandu-mock-mcp");
  const config = options.config ?? {};
  const manifest = options.manifest ?? { version: 1, routes: [] };

  return {
    paths: {
      repoRoot: root,
      manduDir: path.join(root, ".mandu"),
      manifestPath: path.join(root, ".mandu", "routes.manifest.json"),
      specsDir: path.join(root, "spec"),
      slotsDir: path.join(root, "spec", "slots"),
    },
    readConfig: async () => config,
    readManifest: async () => manifest,
  };
}

// ========== Phase 12.1 — Integration fixtures ==========

export {
  createTestServer,
  type CreateTestServerOptions,
  type TestServer,
} from "./server";

export {
  createTestSession,
  readSession,
  extractCookieValuePair,
  type CreateTestSessionOptions,
  type TestSession,
} from "./session";

export {
  createTestDb,
  type CreateTestDbOptions,
  type TestDb,
} from "./db";

export {
  mockMail,
  mockStorage,
  type MockMail,
  type MockStorage,
  type MockStoredObject,
} from "./mocks";

// ========== Phase 12.3 — Snapshot assertions ==========

export {
  matchSnapshot,
  toMatchSnapshot,
  stableStringify,
  scrubVolatile,
  deriveSnapshotPath,
  isUpdateMode,
  type SnapshotOptions,
  type SnapshotResult,
} from "./snapshot";

// ========== Phase 18.σ — Unified reporter ==========

export {
  formatReport,
  formatHuman,
  formatJson,
  formatJunit,
  formatLcov,
  mergeReports,
  summarizeReport,
  checkCoverageThresholds,
  formatThresholdFailure,
  parseLcovSummary,
  emptyReport,
  type TestReport,
  type TestCase,
  type TestStatus,
  type TestSuiteKind,
  type Coverage,
  type CoverageMetric,
  type CoverageMetricResult,
  type CoverageThresholds,
  type CoverageThresholdBreakdown,
  type CoverageThresholdResult,
  type ReporterFormat,
  type ReportSummary,
  type FormatOptions,
} from "./reporter";
