import { describe, expect, it } from "bun:test";
import { generateResourceSlot } from "../../src/resource/generators/slot";
import type { ResourceDefinition } from "../../src/resource/schema";

describe("generateResourceSlot", () => {
  it("uses schema pluralization in comments and DB examples", () => {
    const definition: ResourceDefinition = {
      name: "party",
      fields: {
        id: { type: "string", required: true },
      },
      options: {
        endpoints: {
          list: true,
          get: true,
          create: true,
          update: true,
          delete: true,
        },
      },
    };

    const slot = generateResourceSlot(definition);
    expect(slot).toContain("// Pattern: /api/parties");
    expect(slot).toContain("db.select().from(parties)");
    expect(slot).toContain("db.insert(parties)");
    expect(slot).not.toContain("partys");
  });
});
