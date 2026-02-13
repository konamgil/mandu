import { describe, expect, it } from "bun:test";
import { catchupFromCursor, mergeUniqueById, resolveResumeCursor } from "./sse-catchup";

describe("sse catch-up primitives", () => {
  const snapshot = [
    { id: "m1", text: "first" },
    { id: "m2", text: "second" },
    { id: "m3", text: "third" },
  ];

  it("resolves Last-Event-ID cursor", () => {
    const req = new Request("http://localhost/stream", {
      headers: { "Last-Event-ID": "m2" },
    });

    expect(resolveResumeCursor(req)).toBe("m2");
  });

  it("returns delta list when cursor exists", () => {
    const result = catchupFromCursor({ cursorId: "m1", snapshot });

    expect(result.mode).toBe("delta");
    expect(result.items.map((m) => m.id)).toEqual(["m2", "m3"]);
  });

  it("falls back to snapshot when cursor is missing", () => {
    const result = catchupFromCursor({ snapshot });

    expect(result.mode).toBe("snapshot");
    expect(result.reason).toBe("missing-cursor");
    expect(result.items.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("falls back to snapshot when cursor is unknown", () => {
    const result = catchupFromCursor({ cursorId: "missing", snapshot });

    expect(result.mode).toBe("snapshot");
    expect(result.reason).toBe("unknown-cursor");
    expect(result.items.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("merges incoming messages idempotently", () => {
    const base = [
      { id: "m1", text: "first" },
      { id: "m2", text: "second" },
    ];
    const incoming = [
      { id: "m2", text: "second-dup" },
      { id: "m3", text: "third" },
    ];

    const merged = mergeUniqueById(base, incoming);

    expect(merged.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });
});
