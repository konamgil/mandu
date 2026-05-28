/**
 * Content negotiation for the built-in default 404 response (GitHub issue #320).
 *
 * The framework's fallback 404 (when no `app/not-found.tsx` is registered)
 * must honor the request `Accept` header: browser navigation that accepts
 * `text/html` gets a minimal HTML 404 page, while API/fetch clients keep the
 * JSON error envelope. Both keep status 404.
 *
 * This exercises `errorToResponse(createNotFoundResponse(...))` — the single
 * convergence point every built-in default 404 path routes through in
 * runtime/server.ts.
 */

import { describe, it, expect } from "bun:test";
import { errorToResponse, createNotFoundResponse } from "../../error";

function build404(accept?: string): Response {
  const headers: Record<string, string> = {};
  if (accept !== undefined) headers["Accept"] = accept;
  const req = new Request("http://test/this-page-does-not-exist", { headers });
  return errorToResponse(
    createNotFoundResponse("/this-page-does-not-exist"),
    false,
    req,
  );
}

describe("default 404 content negotiation (#320)", () => {
  it("returns HTML 404 when Accept includes text/html (browser navigation)", async () => {
    const res = build404("text/html,application/xhtml+xml");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("404 - Not Found");
    // Body must NOT be a JSON error envelope.
    expect(body).not.toContain("MANDU_E105");
  });

  it("returns JSON 404 when Accept is application/json (API client)", async () => {
    const res = build404("application/json");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("MANDU_E105");
    expect(body.message).toBe("Route not found: /this-page-does-not-exist");
  });

  it("returns JSON 404 when no Accept header is present (fetch default)", async () => {
    const res = build404(undefined);
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("MANDU_E105");
  });

  it("falls back to JSON when no request is supplied (back-compat)", async () => {
    const res = errorToResponse(createNotFoundResponse("/x"), false);
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("escapes the message in the HTML body (no markup injection)", async () => {
    const req = new Request("http://test/x", {
      headers: { Accept: "text/html" },
    });
    const res = errorToResponse(
      createNotFoundResponse("/<script>alert(1)</script>"),
      false,
      req,
    );
    const body = await res.text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });
});
