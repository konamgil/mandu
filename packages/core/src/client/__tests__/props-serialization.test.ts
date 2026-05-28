import { describe, expect, it } from "bun:test";
import { deserializeProps, serializeProps } from "../props-serialization";

describe("props serialization", () => {
  it("roundtrips complex browser hydration props through the shared deserializer", () => {
    const input = {
      date: new Date("2026-05-23T00:00:00.000Z"),
      map: new Map<unknown, unknown>([
        ["count", 3],
        ["nested", { ok: true }],
      ]),
      set: new Set<unknown>(["a", "b"]),
      url: new URL("https://mandu.dev/docs?phase=4"),
      missing: undefined,
      nested: {
        list: [1, undefined, { value: "x" }],
      },
    };

    const output = deserializeProps(serializeProps(input));

    expect(output.date).toBeInstanceOf(Date);
    expect((output.date as Date).toISOString()).toBe("2026-05-23T00:00:00.000Z");
    expect(output.map).toBeInstanceOf(Map);
    expect((output.map as Map<unknown, unknown>).get("count")).toBe(3);
    expect((output.map as Map<unknown, unknown>).get("nested")).toEqual({ ok: true });
    expect(output.set).toBeInstanceOf(Set);
    expect(Array.from(output.set as Set<unknown>)).toEqual(["a", "b"]);
    expect(output.url).toBeInstanceOf(URL);
    expect((output.url as URL).href).toBe("https://mandu.dev/docs?phase=4");
    expect(Object.prototype.hasOwnProperty.call(output, "missing")).toBe(true);
    expect(output.missing).toBeUndefined();
    expect(output.nested).toEqual({
      list: [1, undefined, { value: "x" }],
    });
  });
});
