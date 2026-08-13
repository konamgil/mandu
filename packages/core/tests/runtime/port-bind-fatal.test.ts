import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { clearDefaultRegistry, startServer } from "../../src/runtime/server";

const blockers: Server<undefined>[] = [];

afterEach(() => {
  for (const blocker of blockers.splice(0)) {
    blocker.stop(true);
  }
  clearDefaultRegistry();
});

async function reserveConsecutivePorts(count: number): Promise<number> {
  for (let retry = 0; retry < 20; retry++) {
    const seed = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("occupied"),
    });
    const base = seed.port;
    blockers.push(seed);
    if (base === undefined) {
      for (const blocker of blockers.splice(0)) blocker.stop(true);
      continue;
    }

    try {
      for (let offset = 1; offset < count; offset++) {
        blockers.push(
          Bun.serve({
            hostname: "127.0.0.1",
            port: base + offset,
            fetch: () => new Response("occupied"),
          }),
        );
      }
      return base;
    } catch {
      for (const blocker of blockers.splice(0)) blocker.stop(true);
      await Bun.sleep(5);
    }
  }
  throw new Error(`Could not reserve ${count} consecutive test ports.`);
}

describe("server port-bind fatal summary", () => {
  test("reports the exhausted range and an actionable --port fix", async () => {
    const base = await reserveConsecutivePorts(10);

    expect(() =>
      startServer(
        { version: 1, routes: [] },
        {
          hostname: "127.0.0.1",
          port: base,
          silent: true,
          prerender: false,
        },
      ),
    ).toThrow(
      `[Mandu Port Bind Failed] Could not bind 127.0.0.1 on port(s) ${base}-${base + 9}. ` +
        "All candidates are already in use. Stop the conflicting process or choose another port with --port <number>.",
    );
  });
});
