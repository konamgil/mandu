/**
 * Phase C.3 — `mandu_ate_context({ scope: "rpc" })` round-trip.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ateContextTools } from "../../src/tools/ate-context";

const RPC_SOURCE = `
import { z } from "zod";
import { defineRpc } from "@mandujs/core/compat/contract/rpc";

export const ordersRpc = defineRpc({
  place: {
    input: z.object({ sku: z.string(), qty: z.number().int().min(1) }),
    output: z.object({ orderId: z.string().uuid() }),
    handler: async () => ({ orderId: "x" }),
  },
});
`;

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "mandu-context-rpc-"));
  const rpcDir = join(tmp, "src");
  mkdirSync(rpcDir, { recursive: true });
  writeFileSync(join(rpcDir, "orders.rpc.ts"), RPC_SOURCE, "utf8");
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("mandu_ate_context scope='rpc'", () => {
  test("returns a found RPC blob for full dot-notation id", async () => {
    const h = ateContextTools(tmp);
    const r = (await h.mandu_ate_context({
      repoRoot: tmp,
      scope: "rpc",
      id: "orders.place",
    })) as { ok: boolean; context: { found: boolean; procedure?: { id: string; mountPath: string } } };
    expect(r.ok).toBe(true);
    expect(r.context.found).toBe(true);
    expect(r.context.procedure?.id).toBe("orders.place");
    expect(r.context.procedure?.mountPath).toBe("/api/rpc/orders/place");
  });

  test("returns found:false for unknown id", async () => {
    const h = ateContextTools(tmp);
    const r = (await h.mandu_ate_context({
      repoRoot: tmp,
      scope: "rpc",
      id: "totally.missing",
    })) as { ok: boolean; context: { found: boolean } };
    expect(r.ok).toBe(true);
    expect(r.context.found).toBe(false);
  });

  test("rejects missing id", async () => {
    const h = ateContextTools(tmp);
    const r = (await h.mandu_ate_context({
      repoRoot: tmp,
      scope: "rpc",
    })) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toContain("id");
  });
});
