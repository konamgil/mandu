import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { apiError, bodySchema, querySchema } from "./route-helpers";

describe("route helpers", () => {
  it("querySchema parses/coerces values", () => {
    const parseQuery = querySchema(
      z.object({
        sinceId: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
    );

    const result = parseQuery("?sinceId=10&limit=5");
    expect(result).toEqual({ sinceId: 10, limit: 5 });
  });

  it("querySchema supports defaults", () => {
    const parseQuery = querySchema(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
    );

    const result = parseQuery(new URLSearchParams());
    expect(result.limit).toBe(20);
  });

  it("bodySchema parses JSON body", async () => {
    const parseBody = bodySchema(
      z.object({
        text: z.string().min(1),
      })
    );

    const request = new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "mandu" }),
    });

    await expect(parseBody(request)).resolves.toEqual({ text: "mandu" });
  });

  it("bodySchema rejects non-json content type", async () => {
    const parseBody = bodySchema(z.object({ text: z.string() }));
    const request = new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "text=mandu",
    });

    await expect(parseBody(request)).rejects.toThrow("application/json");
  });

  it("apiError returns standardized payload", async () => {
    const res = apiError("invalid input", "BAD_REQUEST", { status: 422 });

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "invalid input",
      code: "BAD_REQUEST",
    });
  });
});
