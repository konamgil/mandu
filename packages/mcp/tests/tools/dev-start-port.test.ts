/**
 * mandu.dev.start — configured-port polling (#237 Concern 3).
 *
 * Covers:
 *   - `readConfiguredServerPort` returns `server.port` when set in
 *     mandu.config.ts, `null` otherwise (schema default does NOT leak).
 *   - `probeTcpPort` resolves `true` when the port is listening,
 *     `false` on refused / unreachable.
 *   - `pollServerPort` returns the port on first successful connect,
 *     `null` after `waitMs` elapses.
 *   - Integration (implicit): the handler returns the polled port
 *     alongside the timeout message when the server never comes up.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server as NetServer } from "node:net";
import {
  readConfiguredServerPort,
  probeTcpPort,
  pollServerPort,
} from "../../src/tools/project";

/**
 * Bind a throwaway TCP listener and return its port. Used for the
 * "server is reachable" half of the polling tests without involving
 * Playwright / Bun dev.
 */
async function bindListener(): Promise<{ port: number; close: () => void }> {
  const srv: NetServer = createServer();
  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve());
  });
  const address = srv.address();
  if (!address || typeof address === "string") {
    srv.close();
    throw new Error("Failed to bind ephemeral TCP listener");
  }
  return {
    port: address.port,
    close: () => srv.close(),
  };
}

describe("mandu.dev.start — port polling (#237 Concern 3)", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "dev-start-port-"));
  });

  afterEach(() => {
    try {
      rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("readConfiguredServerPort returns the explicit port when set in mandu.config.json", async () => {
    writeFileSync(
      join(repoRoot, "mandu.config.json"),
      JSON.stringify({ server: { port: 4321 } }),
      "utf8",
    );
    const port = await readConfiguredServerPort(repoRoot);
    expect(port).toBe(4321);
  });

  test("readConfiguredServerPort returns null when no config file is present (caller falls back to 3333)", async () => {
    const port = await readConfiguredServerPort(repoRoot);
    expect(port).toBeNull();
  });

  test("readConfiguredServerPort returns null when config omits server.port (caller falls back to 3333)", async () => {
    writeFileSync(
      join(repoRoot, "mandu.config.json"),
      JSON.stringify({ server: {} }),
      "utf8",
    );
    const port = await readConfiguredServerPort(repoRoot);
    expect(port).toBeNull();
  });

  test("probeTcpPort resolves true against a live listener", async () => {
    const { port, close } = await bindListener();
    try {
      const ok = await probeTcpPort(port, "127.0.0.1", 500);
      expect(ok).toBe(true);
    } finally {
      close();
    }
  });

  test("probeTcpPort resolves false against a port that is not listening", async () => {
    // Port 1 is reserved + closed on virtually every system; connect
    // returns ECONNREFUSED or times out.
    const ok = await probeTcpPort(1, "127.0.0.1", 200);
    expect(ok).toBe(false);
  });

  test("pollServerPort returns the port on the first successful connect", async () => {
    const { port, close } = await bindListener();
    try {
      const result = await pollServerPort(port, "127.0.0.1", 2000, 50);
      expect(result).toBe(port);
    } finally {
      close();
    }
  });

  test("pollServerPort returns null when the port never comes up within waitMs", async () => {
    // Pick a port that is almost certainly closed on the test host —
    // we avoid 0 (means "pick for me") and low privileged ports.
    const result = await pollServerPort(1, "127.0.0.1", 300, 50);
    expect(result).toBeNull();
  });
});
