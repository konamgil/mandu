import { afterEach, describe, expect, it } from "bun:test";
import { fetchReferenceApp } from "../../../scripts/reference-app-gate";

describe("reference app release gate", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;

  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  it("aborts an individual HTTP probe before a stalled socket can block retries", async () => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Promise<Response>(() => {}),
    });

    const startedAt = performance.now();
    await expect(
      fetchReferenceApp(`http://127.0.0.1:${server.port}/`, undefined, 50),
    ).rejects.toThrow(/abort|timed out/i);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});
