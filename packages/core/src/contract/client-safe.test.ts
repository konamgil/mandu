import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Mandu, createClientContract } from "../index";

describe("Client-safe contract", () => {
  const contract = Mandu.contract({
    request: {
      GET: {
        query: z.object({ id: z.string() }),
      },
      POST: {
        body: z.object({ name: z.string() }),
      },
    },
    response: {
      200: z.object({ ok: z.boolean() }),
      201: z.object({ id: z.string() }),
      400: z.object({ error: z.string() }),
    },
  });

  it("should pick only selected schemas", () => {
    const clientContract = createClientContract(contract, {
      request: {
        POST: { body: true },
      },
      response: [201],
      includeErrors: true,
    });

    expect(clientContract.request.GET).toBeUndefined();
    expect(clientContract.request.POST?.body).toBeDefined();
    expect(clientContract.response[200]).toBeUndefined();
    expect(clientContract.response[201]).toBeDefined();
    expect(clientContract.response[400]).toBeDefined();
  });

  it("should return original contract when no options are provided", () => {
    const clientContract = createClientContract(contract);
    expect(clientContract).toBe(contract);
  });
});
