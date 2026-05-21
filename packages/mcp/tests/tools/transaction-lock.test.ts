import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { checkLock, releaseLock } from "../../src/tx-lock.js";
import { transactionTools } from "../../src/tools/transaction.js";

describe("transactionTools lock enforcement", () => {
  let root: string;

  beforeEach(async () => {
    const existing = checkLock();
    if (existing.locked && existing.lockId) releaseLock(existing.lockId);
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-mcp-tx-"));
    await fs.mkdir(path.join(root, ".mandu"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".mandu", "routes.manifest.json"),
      JSON.stringify({ version: 1, routes: [] }, null, 2),
    );
  });

  afterEach(async () => {
    const lock = checkLock();
    if (lock.locked && lock.lockId) releaseLock(lock.lockId);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects commit calls with a mismatched active lock", async () => {
    const tools = transactionTools(root);
    const begin = await tools["mandu.tx.begin"]({ sessionId: "owner" }) as Record<string, unknown>;
    expect(begin).toMatchObject({ success: true });

    const denied = await tools["mandu.tx.commit"]({ lockId: "wrong-lock" }) as Record<string, unknown>;
    expect(String(denied.error)).toContain("locked by session");

    const status = await tools["mandu.tx.status"]({}) as Record<string, unknown>;
    expect(status.hasActiveTransaction).toBe(true);

    const committed = await tools["mandu.tx.commit"]({ lockId: String(begin.lockId) }) as Record<string, unknown>;
    expect(committed.success).toBe(true);
  });

  it("rejects rollback calls with a mismatched active lock", async () => {
    const tools = transactionTools(root);
    const begin = await tools["mandu.tx.begin"]({ sessionId: "owner" }) as Record<string, unknown>;
    expect(begin).toMatchObject({ success: true });

    await fs.mkdir(path.join(root, "spec", "slots"), { recursive: true });
    await fs.writeFile(path.join(root, "spec", "slots", "demo.slot.ts"), "export default {};\n");

    const denied = await tools["mandu.tx.rollback"]({ lockId: "wrong-lock" }) as Record<string, unknown>;
    expect(String(denied.error)).toContain("locked by session");

    const rolledBack = await tools["mandu.tx.rollback"]({ lockId: String(begin.lockId) }) as Record<string, unknown>;
    expect(rolledBack.success).toBe(true);
  });
});
