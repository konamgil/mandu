/**
 * Phase C.3 — RPC extractor tests.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractRpcProcedures, buildRpcContext } from "../src/rpc-extractor";

const RPC_SOURCE = `
import { z } from "zod";
import { defineRpc, registerRpc } from "@mandujs/core/compat/contract/rpc";

export const usersRpc = defineRpc({
  signup: {
    input: z.object({ email: z.string().email(), password: z.string().min(8) }),
    output: z.object({ userId: z.string().uuid() }),
    handler: async ({ input }) => ({ userId: "abc" }),
  },
  profile: {
    output: z.object({ id: z.string(), name: z.string() }),
    handler: async () => ({ id: "1", name: "x" }),
  },
});

registerRpc("users", usersRpc);
`;

const MIDDLEWARE_RPC = `
import { defineRpc } from "@mandujs/core/compat/contract/rpc";
const builder = new HandlerBuilder();
builder.use(csrf()).use(rateLimit({ max: 10 }));
export const postsRpc = defineRpc({
  list: {
    output: z.array(z.object({ id: z.string() })),
    handler: async () => [],
  },
});
`;

describe("extractRpcProcedures", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "mandu-rpc-extract-"));
    const srcDir = join(tmp, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "users.rpc.ts"), RPC_SOURCE, "utf8");
    writeFileSync(join(srcDir, "posts.rpc.ts"), MIDDLEWARE_RPC, "utf8");
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("extracts every procedure from defineRpc({...})", async () => {
    const r = await extractRpcProcedures(tmp);
    expect(r.procedures.length).toBeGreaterThanOrEqual(3);
    const ids = r.procedures.map((p) => p.id).sort();
    expect(ids).toContain("users.signup");
    expect(ids).toContain("users.profile");
    expect(ids).toContain("posts.list");
  });

  test("each procedure carries input + output schema source text", async () => {
    const r = await extractRpcProcedures(tmp);
    const signup = r.procedures.find((p) => p.id === "users.signup");
    expect(signup).toBeTruthy();
    expect(signup!.inputSchemaSource).toContain("z.object");
    expect(signup!.outputSchemaSource).toContain("userId");
  });

  test("procedure without input schema still extracts with undefined input", async () => {
    const r = await extractRpcProcedures(tmp);
    const profile = r.procedures.find((p) => p.id === "users.profile");
    expect(profile).toBeTruthy();
    expect(profile!.inputSchemaSource).toBeUndefined();
  });

  test("computes `/api/rpc/<endpoint>/<procedure>` mount path", async () => {
    const r = await extractRpcProcedures(tmp);
    const signup = r.procedures.find((p) => p.id === "users.signup");
    expect(signup!.mountPath).toBe("/api/rpc/users/signup");
  });

  test("captures middleware chain from sibling `.use()` calls", async () => {
    const r = await extractRpcProcedures(tmp);
    const list = r.procedures.find((p) => p.id === "posts.list");
    expect(list).toBeTruthy();
    expect(list!.middlewareNames).toContain("csrf");
    expect(list!.middlewareNames).toContain("rateLimit");
  });
});

describe("buildRpcContext", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "mandu-rpc-context-"));
    const srcDir = join(tmp, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "users.rpc.ts"), RPC_SOURCE, "utf8");
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  test("returns procedure blob for full dot-notation id", async () => {
    const blob = await buildRpcContext({ repoRoot: tmp, id: "users.signup" });
    expect(blob.found).toBe(true);
    if (!blob.found) throw new Error("expected found");
    expect(blob.procedure.id).toBe("users.signup");
    expect(blob.procedure.mountPath).toBe("/api/rpc/users/signup");
    expect(blob.routeLike.methods).toEqual(["POST"]);
  });

  test("accepts bare procedure name when unique", async () => {
    const blob = await buildRpcContext({ repoRoot: tmp, id: "signup" });
    expect(blob.found).toBe(true);
  });

  test("returns found:false + suggestions for unknown id", async () => {
    const blob = await buildRpcContext({ repoRoot: tmp, id: "does.not.exist" });
    expect(blob.found).toBe(false);
    if (blob.found) throw new Error("expected not found");
    expect(blob.suggestions.length).toBeGreaterThan(0);
  });
});
