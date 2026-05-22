/**
 * Phase A.3 — prompt goldens.
 *
 * For each prompt kind we keep a canonical (context, exemplars) fixture and
 * a frozen `<kind>.golden.md` file capturing the expected composer output.
 * The test compares the live composer against the golden — failures indicate
 * either a catalog drift (expected, re-run with `UPDATE_GOLDEN=1`) or a
 * regression in the composer.
 *
 * Re-generate goldens:
 *   UPDATE_GOLDEN=1 bun test packages/ate/tests/prompts/goldens.test.ts
 */
import { describe, test, expect } from "bun:test";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { composePrompt } from "../../src/prompt-composer";
import type { Exemplar } from "../../src/exemplar-scanner";

const GOLDEN_DIR = join(__dirname);
const PROMPT_DIR = join(__dirname, "..", "..", "prompts");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

interface GoldenCase {
  kind: string;
  context: unknown;
  exemplars: Exemplar[];
}

const fillingUnitExemplar: Exemplar = {
  path: "packages/core/tests/filling/action.test.ts",
  startLine: 17,
  endLine: 29,
  kind: "filling_unit",
  depth: "basic",
  tags: ["post", "action", "json"],
  code: `it("dispatches POST with _action in JSON body to action handler", async () => {
  const filling = new ManduFilling()
    .action("create", async (ctx) => ctx.ok({ handler: "create" }))
    .post(async (ctx) => ctx.ok({ handler: "post" }));

  const req = jsonPost("http://localhost/items", { _action: "create", title: "test" });
  const res = await filling.handle(req);
  const data = await res.json();

  expect(res.status).toBe(200);
  expect(data.handler).toBe("create");
})`,
};

const integrationExemplar: Exemplar = {
  path: "packages/core/tests/server/rate-limit.test.ts",
  startLine: 34,
  endLine: 58,
  kind: "filling_integration",
  depth: "basic",
  tags: ["rate-limit", "server", "429"],
  code: `it("설정된 횟수를 초과하면 429를 반환한다", async () => {
  registry.registerApiHandler("api/limited", async () => Response.json({ ok: true }));
  server = startServer(testManifest, { port: 0, registry, rateLimit: { windowMs: 5000, max: 2 } });
  // ... (abbreviated for golden stability)
})`,
};

const e2eExemplar: Exemplar = {
  path: "demo/auth-starter/tests/e2e/auth-flow.spec.ts",
  startLine: 25,
  endLine: 38,
  kind: "e2e_playwright",
  depth: "basic",
  tags: ["signup", "happy-path", "navigation"],
  code: `test("signup with fresh email lands on /dashboard with the email visible", async ({ page }) => {
  const email = freshEmail("signup-fresh");
  await page.goto("/signup");
  await expect(page.getByTestId("signup-form")).toBeVisible();
  // ... (abbreviated for golden stability)
})`,
};

// Phase B.5 — new prompt kinds.
const propertyBasedExemplar: Exemplar = {
  path: "packages/ate/tests/exemplar-sources/property-based.examples.ts",
  startLine: 10,
  endLine: 40,
  kind: "property_based",
  depth: "basic",
  tags: ["signup", "email", "boundary"],
  code: `it("every probe round-trips to contract-declared status", () => {
  fc.assert(
    fc.property(fc.constantFrom(...probes), async (probe) => {
      const res = await testFilling(handler, { method: "POST", body: { email: probe.value } });
      return res.status === probe.expectedStatus;
    }),
  );
})`,
};

const contractShapeExemplar: Exemplar = {
  path: "packages/core/tests/server/api-methods.test.ts",
  startLine: 53,
  endLine: 71,
  kind: "contract_shape",
  depth: "basic",
  tags: ["response", "shape", "200"],
  code: `it("GET /api/users - 목록 조회", async () => {
  // (abbreviated for golden)
})`,
};

const guardSecurityExemplar: Exemplar = {
  path: "packages/core/tests/middleware/csrf.test.ts",
  startLine: 150,
  endLine: 165,
  kind: "guard_security",
  depth: "basic",
  tags: ["csrf", "reject", "403"],
  code: `it("POST without any token returns 403", async () => {
  const mw = csrf({ secret: SECRET });
  const ctx = makeCtx(makeReq("http://localhost/items", { method: "POST" }));
  const res = await runMw(mw, ctx);
  expect(res.status).toBe(403);
})`,
};

// Phase C.5 — new prompt kinds.
const islandHydrationExemplar: Exemplar = {
  path: "packages/ate/tests/exemplar-sources/island-hydration.examples.ts",
  startLine: 7,
  endLine: 11,
  kind: "island_hydration",
  depth: "basic",
  tags: ["visible", "hydrates"],
  code: `test("Cart island becomes hydrated within budget", async ({ page }) => {
  await page.goto("/cart");
  await waitForIsland(page, "Cart", { timeoutMs: 3000 });
  await expect(page.locator('[data-island="Cart"][data-hydrated="true"]')).toBeVisible();
})`,
};

const streamingSsrExemplar: Exemplar = {
  path: "packages/ate/tests/exemplar-sources/streaming-ssr.examples.ts",
  startLine: 6,
  endLine: 11,
  kind: "streaming_ssr",
  depth: "basic",
  tags: ["shell", "doctype"],
  code: `test("dashboard stream emits a well-formed shell", async () => {
  const res = await fetch(\`\${BASE_URL}/dashboard\`);
  await assertStreamBoundary(res, {
    shellChunkContains: ["<!DOCTYPE", "<html"],
  });
})`,
};

const rpcProcedureExemplar: Exemplar = {
  path: "packages/ate/tests/exemplar-sources/rpc-procedure.examples.ts",
  startLine: 6,
  endLine: 12,
  kind: "rpc_procedure",
  depth: "basic",
  tags: ["happy-path", "typed-client"],
  code: `test("signup RPC returns typed result", async () => {
  using server = await createTestServer({ rpc: { users: usersRpc } });
  const client = createRpcClient<typeof usersRpc>({ baseUrl: server.url, endpoint: "users" });
  const res = await client.signup({ email: "a@b.com", password: "valid123" });
  expect(typeof res.userId).toBe("string");
})`,
};

const CASES: GoldenCase[] = [
  {
    kind: "filling_unit",
    context: {
      route: { id: "api-signup", pattern: "/api/signup", methods: ["POST"] },
      middleware: [{ name: "session" }, { name: "csrf" }],
      fixtures: { recommended: ["createTestSession", "createTestDb", "testFilling"] },
    },
    exemplars: [fillingUnitExemplar],
  },
  {
    kind: "filling_integration",
    context: {
      route: { id: "api-signup", pattern: "/api/signup", methods: ["POST"] },
      middleware: [{ name: "session" }, { name: "csrf" }, { name: "rate-limit" }],
      fixtures: { recommended: ["createTestServer", "createTestSession", "createTestDb"] },
    },
    exemplars: [integrationExemplar],
  },
  {
    kind: "e2e_playwright",
    context: {
      route: { id: "signup", pattern: "/signup", kind: "page", isRedirect: false },
      guard: { suggestedSelectors: ["[data-route-id=signup]"] },
    },
    exemplars: [e2eExemplar],
  },
  {
    kind: "property_based",
    context: {
      route: { id: "api-signup", pattern: "/api/signup", methods: ["POST"] },
      boundary: {
        probes: [
          { field: "email", category: "valid", value: "a@b.com", expectedStatus: 201 },
          { field: "email", category: "invalid_format", value: "not-an-email", expectedStatus: 400 },
        ],
      },
    },
    exemplars: [propertyBasedExemplar],
  },
  {
    kind: "contract_shape",
    context: {
      route: { id: "api-signup", pattern: "/api/signup", methods: ["POST"] },
      contract: { responses: [{ status: 201 }, { status: 400 }] },
    },
    exemplars: [contractShapeExemplar],
  },
  {
    kind: "guard_security",
    context: {
      route: { id: "api-signup", pattern: "/api/signup", methods: ["POST"] },
      middleware: [{ name: "csrf" }, { name: "session" }],
    },
    exemplars: [guardSecurityExemplar],
  },
  // Phase C.5
  {
    kind: "island_hydration",
    context: {
      route: { id: "cart", pattern: "/cart", kind: "page" },
      islands: [{ name: "Cart", strategy: "visible" }],
    },
    exemplars: [islandHydrationExemplar],
  },
  {
    kind: "streaming_ssr",
    context: {
      route: { id: "dashboard", pattern: "/dashboard", kind: "page" },
      suspenseBoundaryCount: 2,
    },
    exemplars: [streamingSsrExemplar],
  },
  {
    kind: "rpc_procedure",
    context: {
      procedure: { id: "users.signup", endpoint: "users", procedure: "signup", mountPath: "/api/rpc/users/signup" },
      inputSchemaSource: "z.object({ email: z.string().email(), password: z.string().min(8) })",
      outputSchemaSource: "z.object({ userId: z.string().uuid() })",
    },
    exemplars: [rpcProcedureExemplar],
  },
];

describe("prompt goldens", () => {
  test("prompt catalog does not teach localhost transport fetches", () => {
    const bannedFetch = /\bfetch\(\s*[`'"]http:\/\/localhost:/;
    for (const file of readdirSync(PROMPT_DIR)) {
      if (!file.endsWith(".md")) continue;
      const content = readFileSync(join(PROMPT_DIR, file), "utf8");
      if (bannedFetch.test(content)) {
        throw new Error(`${file} contains a localhost fetch example; use 127.0.0.1`);
      }
    }
  });

  for (const c of CASES) {
    test(`${c.kind} composed prompt matches golden`, async () => {
      const composed = await composePrompt({
        kind: c.kind,
        context: c.context,
        exemplars: c.exemplars,
      });

      if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
      const goldenPath = join(GOLDEN_DIR, `${c.kind}.golden.md`);

      if (UPDATE || !existsSync(goldenPath)) {
        writeFileSync(goldenPath, composed.prompt, "utf8");
        // When updating, the assertion below is trivially true.
      }

      const expected = readFileSync(goldenPath, "utf8");
      // Normalize line endings so CRLF on Windows doesn't flake.
      const norm = (s: string) => s.replace(/\r\n/g, "\n").trimEnd() + "\n";
      expect(norm(composed.prompt)).toBe(norm(expected));
    });
  }
});
