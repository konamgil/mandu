/**
 * Regression tests for issue #318:
 * ctx.body() must raise a 400 (Bad Request) for empty/malformed JSON bodies,
 * never a 500 FRAMEWORK_BUG / MANDU_F999 (a bad body is the client's fault).
 */

import { describe, it, expect } from "bun:test";
import { ManduFillingFactory } from "./filling";
import { BadRequestError } from "./context";

const Mandu = ManduFillingFactory;

function jsonPost(body: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("ctx.body() bad request handling (#318)", () => {
  const filling = Mandu.filling().post(async (ctx) => {
    const data = await ctx.body();
    return ctx.ok(data);
  });

  it("returns 400 (not 500) for an empty JSON body", async () => {
    const res = await filling.handle(jsonPost(""));
    expect(res.status).toBe(400);

    const payload = (await res.json()) as Record<string, unknown>;
    expect(payload.errorType).not.toBe("FRAMEWORK_BUG");
    expect(payload.code).not.toBe("MANDU_F999");
    expect(payload.code).toBe("MANDU_C400");
  });

  it("returns 400 (not 500) for a malformed JSON body", async () => {
    const res = await filling.handle(jsonPost("{bad,,"));
    expect(res.status).toBe(400);

    const payload = (await res.json()) as Record<string, unknown>;
    expect(payload.errorType).not.toBe("FRAMEWORK_BUG");
    expect(payload.errorType).not.toBe("LOGIC_ERROR");
    expect(payload.code).toBe("MANDU_C400");
    // Must not misdiagnose client input as a slot file problem.
    expect(JSON.stringify(payload)).not.toContain("slot");
  });

  it("still parses a valid JSON body normally", async () => {
    const res = await filling.handle(jsonPost(JSON.stringify({ email: "a@b.c" })));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as Record<string, unknown>;
    expect(payload.email).toBe("a@b.c");
  });

  it("ctx.body() throws BadRequestError directly on malformed JSON", async () => {
    const ctx = Mandu.context(jsonPost("not json"));
    await expect(ctx.body()).rejects.toBeInstanceOf(BadRequestError);
  });
});
