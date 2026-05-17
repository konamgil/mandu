import { describe, expect, it } from "bun:test";
import { ManduContext } from "../../src/filling/context";

describe("ManduContext.error", () => {
  it("uses the numeric status passed as the first argument", async () => {
    const ctx = new ManduContext(new Request("http://localhost/api/users/1"));
    const res = ctx.error(404, "user not found", { id: "1" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      status: "error",
      message: "user not found",
      details: { id: "1" },
    });
  });

  it("keeps the legacy message-first form as 400", () => {
    const ctx = new ManduContext(new Request("http://localhost/api/users"));
    const res = ctx.error("invalid input");

    expect(res.status).toBe(400);
  });
});
