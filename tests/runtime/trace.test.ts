import { describe, test, expect } from "bun:test";
import { ManduContext } from "../../packages/core/src/filling/context";
import { createLifecycleStore, executeLifecycle } from "../../packages/core/src/runtime/lifecycle";
import { enableTrace, getTrace } from "../../packages/core/src/runtime/trace";

describe("runtime/trace", () => {
  test("records lifecycle events when trace is enabled", async () => {
    const lifecycle = createLifecycleStore();
    lifecycle.afterResponse.push({ fn: () => {}, scope: "local" });

    const ctx = new ManduContext(
      new Request("http://localhost/test", { method: "POST" })
    );

    enableTrace(ctx);

    await executeLifecycle(
      lifecycle,
      ctx,
      async () => new Response("ok"),
      { trace: true }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const trace = getTrace(ctx);
    expect(trace).toBeDefined();
    expect(trace!.records.length).toBeGreaterThan(0);

    const sequence = trace!.records.map((r) => `${r.event}:${r.phase}`);

    expect(sequence[0]).toBe("request:begin");
    expect(sequence).toContain("handle:begin");
    expect(sequence).toContain("handle:end");
    expect(sequence).toContain("afterResponse:begin");
    expect(sequence).toContain("afterResponse:end");
  });
});
