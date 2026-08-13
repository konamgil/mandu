/**
 * Phase C — acceptance test (§C.6).
 *
 * Single integration test exercising all four blocks end-to-end:
 *
 *  1. `expectContract` strict/loose on a SignupResponse.
 *  2. `runMutations` on a small handler — ≥ 5 mutations + mutationScore.
 *  3. `buildContext({ scope: "rpc", id: "users.signup" })` returns
 *     procedure blob with Zod schema source text.
 *  4. `expectSemantic` queues → verdict → replay cycle.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import {
  expectContract,
  ContractAssertionError,
  expectSemantic,
  type OracleQueueEntry,
} from "@mandujs/core/testing";
import {
  runMutations,
  computeMutationReport,
  buildRpcContext,
  setOracleVerdict,
  findOracleEntriesForSpec,
} from "../src";

const SignupResponse = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
});

const HANDLER_SOURCE = `import { z } from "zod";
export const Contract = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["user", "editor"]),
});
export async function handle(req: Request) {
  const body = await req.json();
  const parsed = Contract.parse(body);
  return Response.json({ ok: parsed.email });
}
`;

const RPC_SOURCE = `import { z } from "zod";
import { defineRpc } from "@mandujs/core/compat/contract/rpc";
export const usersRpc = defineRpc({
  signup: {
    input: z.object({ email: z.string().email(), password: z.string().min(8) }),
    output: z.object({ userId: z.string().uuid() }),
    handler: async () => ({ userId: "x" }),
  },
});
`;

describe("Phase C acceptance (§C.6)", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "mandu-phase-c-accept-"));
    // Layout: contract for mutations, RPC file for context, etc.
    const srcDir = join(tmp, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "handler.ts"), HANDLER_SOURCE, "utf8");
    writeFileSync(join(srcDir, "users.rpc.ts"), RPC_SOURCE, "utf8");
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  test("1. expectContract strict fails on drift, loose tolerates extras", () => {
    const valid = {
      userId: "550e8400-e29b-41d4-a716-446655440000",
      email: "user@example.com",
    };
    expect(expectContract(valid, SignupResponse).status).toBe("pass");

    // Strict should flag the extra key.
    expect(() =>
      expectContract({ ...valid, extraField: "oops" }, SignupResponse, { mode: "strict" }),
    ).toThrow(ContractAssertionError);

    // Loose tolerates it when the schema is passthrough, or when the
    // extra isn't declared as unrecognized.
    const Loose = SignupResponse.passthrough();
    const r = expectContract(
      { ...valid, extraField: "oops" },
      Loose,
      { mode: "loose" },
    );
    expect(r.status).toBe("pass");
  });

  test("2. runMutations produces 5+ mutations and a mutationScore", async () => {
    const r = await runMutations({
      repoRoot: tmp,
      targetFile: "src/handler.ts",
      testCommand: ["echo", "x"],
      spawn: async () => ({ exitCode: 1, output: "", timedOut: false }),
      maxMutations: 15,
    });
    expect(r.totalGenerated).toBeGreaterThanOrEqual(5);
    expect(r.totalExecuted).toBeGreaterThanOrEqual(5);
    const report = computeMutationReport(r.results);
    expect(typeof report.mutationScore).toBe("number");
    expect(report.mutationScore).toBeGreaterThan(0);
  });

  test("3. buildRpcContext returns a procedure blob with Zod schemas", async () => {
    const blob = await buildRpcContext({ repoRoot: tmp, id: "users.signup" });
    expect(blob.found).toBe(true);
    if (!blob.found) return;
    expect(blob.procedure.id).toBe("users.signup");
    expect(blob.procedure.mountPath).toBe("/api/rpc/users/signup");
    expect(blob.inputSchemaSource).toContain("z.object");
    expect(blob.outputSchemaSource).toContain("userId");
  });

  test("4. expectSemantic queue → verdict → replay cycle", async () => {
    const page = {
      async content() {
        return "<html>hi</html>";
      },
      async screenshot() {
        return new Uint8Array([1]);
      },
    };
    const specPath = "tests/phase-c-acceptance.demo.spec.ts";
    const r = expectSemantic(page, "user sees success state", {
      repoRoot: tmp,
      specPath,
      runId: "accept-1",
    });
    expect(r.status).toBe("pass");
    expect(r.deferred).toBe(true);

    // Give the file writes a moment.
    await new Promise((r) => setTimeout(r, 20));

    // Transition pending → passed via verdict.
    const verdict = setOracleVerdict(tmp, {
      assertionId: r.assertionId,
      verdict: "pass",
      reason: "visual confirms success icon",
    });
    expect(verdict.updated).toBe(1);

    // Replay surfaces the verdict.
    const replay = findOracleEntriesForSpec(tmp, specPath);
    const match = replay.find((e) => e.assertionId === r.assertionId);
    expect(match).toBeTruthy();
    expect(match!.status).toBe("passed");
    expect(match!.verdict?.reason).toContain("success icon");
  });
});
