/**
 * Phase 4c — Agent B tests for `snapshot.ts`.
 *
 * Coverage targets:
 *   - Normalization correctness (provider gate, table name, column name,
 *     primary key resolution, default normalization)
 *   - Error paths (conflicting providers, zero/multi PK, unsupported defaults)
 *   - JSON serialization determinism (sorted keys, 2-space indent)
 *   - Roundtrip parse/serialize
 *   - Version rejection, malformed JSON
 *   - SHA-256 stability under key-order permutation
 */

import { describe, test, expect } from "bun:test";
import type { ParsedResource } from "../../parser";
import type { ResourceDefinition } from "../../schema";
import type { DdlIndex } from "../types";
import {
  snapshotFromResources,
  serializeSnapshot,
  parseSnapshot,
  hashSnapshot,
  toSnakeCase,
} from "../snapshot";

// --------------------------------------------------------------------
// Builders — keep test data minimal + explicit
// --------------------------------------------------------------------

function makeParsed(def: ResourceDefinition, file = `/virtual/${def.name}.resource.ts`): ParsedResource {
  return {
    definition: def,
    filePath: file,
    fileName: def.name,
    resourceName: def.name,
  };
}

function pkPostgresUser(): ResourceDefinition {
  return {
    name: "user",
    fields: {
      id: { type: "uuid", required: true, primary: true } as ResourceDefinition["fields"][string],
      email: { type: "email", required: true },
      passwordHash: { type: "string", required: true },
      createdAt: { type: "date", required: true, default: "now" },
    },
    options: {
      persistence: {
        provider: "postgres",
      },
    } as unknown as ResourceDefinition["options"],
  };
}

// --------------------------------------------------------------------
// Basic inclusion / exclusion
// --------------------------------------------------------------------

describe("snapshotFromResources — inclusion policy", () => {
  test("1. empty resources array → snapshot with empty resources[]", () => {
    const snap = snapshotFromResources([]);
    expect(snap.version).toBe(1);
    expect(snap.resources).toEqual([]);
  });

  test("2. non-persistent resource is excluded from snapshot", () => {
    const resource = makeParsed({
      name: "widget",
      fields: { id: { type: "uuid", required: true } },
      // no options.persistence → skip entirely
    });
    const snap = snapshotFromResources([resource]);
    expect(snap.resources).toEqual([]);
  });

  test("3. mixing postgres + mysql providers throws TypeError", () => {
    const a = makeParsed({
      name: "user",
      fields: { id: { type: "uuid", required: true, primary: true } as any },
      options: { persistence: { provider: "postgres" } } as any,
    });
    const b = makeParsed({
      name: "post",
      fields: { id: { type: "uuid", required: true, primary: true } as any },
      options: { persistence: { provider: "mysql" } } as any,
    });
    expect(() => snapshotFromResources([a, b])).toThrow(TypeError);
    expect(() => snapshotFromResources([a, b])).toThrow(/Mixed SQL providers/);
  });
});

// --------------------------------------------------------------------
// Field + table name normalization
// --------------------------------------------------------------------

describe("snapshotFromResources — table + column naming", () => {
  test("4. camelCase field key becomes snake_case column name", () => {
    const snap = snapshotFromResources([makeParsed(pkPostgresUser())]);
    const user = snap.resources.find((r) => r.name === "users")!;
    const passwordHash = user.fields.find((f) => f.name === "password_hash");
    expect(passwordHash).toBeDefined();
    expect(user.fields.find((f) => f.name === "created_at")).toBeDefined();
  });

  test("5. autoPlural: false keeps singular table name", () => {
    const def = pkPostgresUser();
    def.options = { autoPlural: false, persistence: { provider: "postgres" } } as any;
    const snap = snapshotFromResources([makeParsed(def)]);
    expect(snap.resources[0].name).toBe("user");
  });

  test("6. persistence.tableName beats auto-plural", () => {
    const def = pkPostgresUser();
    def.options = {
      persistence: { provider: "postgres", tableName: "app_user" },
    } as any;
    const snap = snapshotFromResources([makeParsed(def)]);
    expect(snap.resources[0].name).toBe("app_user");
  });

  test("7. fieldOverrides[key].columnName beats snake_case default", () => {
    const def = pkPostgresUser();
    def.options = {
      persistence: {
        provider: "postgres",
        fieldOverrides: { passwordHash: { columnName: "pwd" } },
      },
    } as any;
    const snap = snapshotFromResources([makeParsed(def)]);
    const f = snap.resources[0].fields.find((f) => f.name === "pwd");
    expect(f).toBeDefined();
    expect(snap.resources[0].fields.find((f) => f.name === "password_hash")).toBeUndefined();
  });

  test("17. duplicate table name after pluralization throws (both names listed)", () => {
    // Two resources both pluralize to "users".
    const defA: ResourceDefinition = {
      name: "user",
      fields: { id: { type: "uuid", required: true, primary: true } as any },
      options: { persistence: { provider: "postgres" } } as any,
    };
    const defB: ResourceDefinition = {
      name: "account",
      fields: { id: { type: "uuid", required: true, primary: true } as any },
      options: { persistence: { provider: "postgres", tableName: "users" } } as any,
    };
    expect(() => snapshotFromResources([makeParsed(defA), makeParsed(defB)])).toThrow(
      /Duplicate table name "users".*user.*account/s
    );
  });

  test("pluralizer handles -y → -ies", () => {
    const def: ResourceDefinition = {
      name: "category",
      fields: { id: { type: "uuid", required: true, primary: true } as any },
      options: { persistence: { provider: "postgres" } } as any,
    };
    const snap = snapshotFromResources([makeParsed(def)]);
    expect(snap.resources[0].name).toBe("categories");
  });

  test("pluralizer handles -s → -ses", () => {
    const def: ResourceDefinition = {
      name: "bus",
      fields: { id: { type: "uuid", required: true, primary: true } as any },
      options: { persistence: { provider: "postgres" } } as any,
    };
    const snap = snapshotFromResources([makeParsed(def)]);
    expect(snap.resources[0].name).toBe("buses");
  });
});

// --------------------------------------------------------------------
// Primary key resolution
// --------------------------------------------------------------------

describe("snapshotFromResources — primary key", () => {
  test("8. zero primary-key fields throws", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true }, // no primary flag
        email: { type: "email", required: true },
      },
      options: { persistence: { provider: "postgres" } } as any,
    };
    expect(() => snapshotFromResources([makeParsed(def)])).toThrow(/exactly one primary key/);
  });

  test("9. multiple primary:true fields throws (composite PK not supported)", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true, primary: true } as any,
        email: { type: "email", required: true, primary: true } as any,
      },
      options: { persistence: { provider: "postgres" } } as any,
    };
    expect(() => snapshotFromResources([makeParsed(def)])).toThrow(/Composite primary keys/);
  });

  test("persistence.primaryKey string resolves PK without field-level flag", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true }, // no field-level primary
        email: { type: "email", required: true },
      },
      options: { persistence: { provider: "postgres", primaryKey: "id" } } as any,
    };
    const snap = snapshotFromResources([makeParsed(def)]);
    const pk = snap.resources[0].fields.find((f) => f.primary);
    expect(pk?.name).toBe("id");
  });

  test("persistence.primaryKey [string] (single-element array) resolves PK", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: { id: { type: "uuid", required: true } },
      options: { persistence: { provider: "postgres", primaryKey: ["id"] } } as any,
    };
    const snap = snapshotFromResources([makeParsed(def)]);
    expect(snap.resources[0].fields[0].primary).toBe(true);
  });
});

// --------------------------------------------------------------------
// Default value normalization
// --------------------------------------------------------------------

describe("snapshotFromResources — default normalization", () => {
  test("10. default values map correctly to DdlDefault", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true, primary: true } as any,
        createdAt: { type: "date", required: true, default: "now" },
        deletedAt: { type: "date", required: false, default: null },
        age: { type: "number", required: false, default: 42 },
        active: { type: "boolean", required: false, default: true },
        nickname: { type: "string", required: false, default: "anon" },
      },
      options: { persistence: { provider: "postgres" } } as any,
    };
    const snap = snapshotFromResources([makeParsed(def)]);
    const byName = new Map(snap.resources[0].fields.map((f) => [f.name, f]));
    expect(byName.get("created_at")!.default).toEqual({ kind: "now" });
    expect(byName.get("deleted_at")!.default).toEqual({ kind: "null" });
    expect(byName.get("age")!.default).toEqual({ kind: "literal", value: 42 });
    expect(byName.get("active")!.default).toEqual({ kind: "literal", value: true });
    expect(byName.get("nickname")!.default).toEqual({ kind: "literal", value: "anon" });
    // id has no default
    expect(byName.get("id")!.default).toBeUndefined();
  });

  test("'current_timestamp' also normalizes to { kind: 'now' }", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true, primary: true } as any,
        created_at: { type: "date", required: true, default: "current_timestamp" },
      },
      options: { persistence: { provider: "postgres" } } as any,
    };
    const snap = snapshotFromResources([makeParsed(def)]);
    const f = snap.resources[0].fields.find((f) => f.name === "created_at")!;
    expect(f.default).toEqual({ kind: "now" });
  });

  test("11. function default throws TypeError", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true, primary: true } as any,
        createdAt: { type: "date", required: true, default: () => new Date() } as any,
      },
      options: { persistence: { provider: "postgres" } } as any,
    };
    expect(() => snapshotFromResources([makeParsed(def)])).toThrow(/unsupported default type/);
  });

  test("object default throws TypeError (not a scalar)", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true, primary: true } as any,
        meta: { type: "json", required: false, default: {} } as any,
      },
      options: { persistence: { provider: "postgres" } } as any,
    };
    expect(() => snapshotFromResources([makeParsed(def)])).toThrow(/unsupported default type/);
  });

  test("non-finite number default throws", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true, primary: true } as any,
        score: { type: "number", required: false, default: Infinity },
      },
      options: { persistence: { provider: "postgres" } } as any,
    };
    expect(() => snapshotFromResources([makeParsed(def)])).toThrow(/non-finite default/);
  });

  test("fieldOverrides[key].default bypasses field.default magic", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true, primary: true } as any,
        createdAt: { type: "date", required: true, default: "now" },
      },
      options: {
        persistence: {
          provider: "postgres",
          fieldOverrides: {
            createdAt: { default: { kind: "sql", expr: "timezone('UTC', now())" } },
          },
        },
      } as any,
    };
    const snap = snapshotFromResources([makeParsed(def)]);
    const f = snap.resources[0].fields.find((f) => f.name === "created_at")!;
    expect(f.default).toEqual({ kind: "sql", expr: "timezone('UTC', now())" });
  });
});

// --------------------------------------------------------------------
// Serialization + roundtrip
// --------------------------------------------------------------------

describe("serializeSnapshot / parseSnapshot", () => {
  test("12. roundtrip preserves bytes", () => {
    const snap = snapshotFromResources([makeParsed(pkPostgresUser())]);
    const serialized = serializeSnapshot(snap);
    const reparsed = parseSnapshot(serialized);
    const reserialized = serializeSnapshot(reparsed);
    expect(reserialized).toBe(serialized);
  });

  test("13. serialization uses 2-space indent and sorted keys", () => {
    const snap = snapshotFromResources([makeParsed(pkPostgresUser())]);
    const json = serializeSnapshot(snap);
    // 2-space indent → keys appear after "  " on their own line.
    expect(json).toContain('  "generatedAt":');
    expect(json).toContain('  "provider":');
    expect(json).toContain('  "resources":');
    expect(json).toContain('  "version":');
    // Sorted keys — "generatedAt" precedes "provider" precedes "resources"
    // precedes "version" alphabetically.
    const generatedIdx = json.indexOf('"generatedAt"');
    const providerIdx = json.indexOf('"provider"');
    const resourcesIdx = json.indexOf('"resources"');
    const versionIdx = json.indexOf('"version"');
    expect(generatedIdx).toBeLessThan(providerIdx);
    expect(providerIdx).toBeLessThan(resourcesIdx);
    expect(resourcesIdx).toBeLessThan(versionIdx);
  });

  test("14. parseSnapshot rejects version: 2 with clear message", () => {
    const v2 = JSON.stringify({
      version: 2,
      provider: "postgres",
      resources: [],
      generatedAt: new Date().toISOString(),
    });
    expect(() => parseSnapshot(v2)).toThrow(/Unsupported snapshot version/);
  });

  test("15. parseSnapshot rejects malformed JSON", () => {
    expect(() => parseSnapshot("{not-json")).toThrow(/Invalid snapshot JSON/);
  });

  test("parseSnapshot rejects missing fields", () => {
    expect(() =>
      parseSnapshot(JSON.stringify({ version: 1, provider: "postgres" }))
    ).toThrow(/Snapshot.resources/);
  });

  test("parseSnapshot rejects invalid provider", () => {
    expect(() =>
      parseSnapshot(JSON.stringify({ version: 1, provider: "oracle", resources: [], generatedAt: "now" }))
    ).toThrow(/invalid provider/);
  });
});

// --------------------------------------------------------------------
// Hash stability
// --------------------------------------------------------------------

describe("hashSnapshot", () => {
  test("16. hash is stable across object-key permutations (serialization is the canonicalizer)", () => {
    const now = new Date("2026-01-01T00:00:00Z").toISOString();
    // Same snapshot expressed two different ways — different key order.
    const a = {
      version: 1 as const,
      provider: "postgres" as const,
      generatedAt: now,
      resources: [
        {
          name: "users",
          fields: [
            { name: "id", type: "uuid" as const, nullable: false, primary: true, unique: false, indexed: false },
          ],
          indexes: [],
        },
      ],
    };
    const b = {
      // Different key insertion order — must produce same hash.
      provider: "postgres" as const,
      resources: [
        {
          fields: [
            { unique: false, primary: true, nullable: false, name: "id", type: "uuid" as const, indexed: false },
          ],
          name: "users",
          indexes: [],
        },
      ],
      generatedAt: now,
      version: 1 as const,
    };
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
  });

  test("hash is hex string of SHA-256 (64 chars)", () => {
    const snap = snapshotFromResources([makeParsed(pkPostgresUser())]);
    const h = hashSnapshot(snap);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

// --------------------------------------------------------------------
// toSnakeCase — exported for reuse by Agent D generator
// --------------------------------------------------------------------

describe("toSnakeCase", () => {
  test("camelCase", () => {
    expect(toSnakeCase("passwordHash")).toBe("password_hash");
  });
  test("PascalCase", () => {
    expect(toSnakeCase("PasswordHash")).toBe("password_hash");
  });
  test("runs of caps stay together", () => {
    expect(toSnakeCase("HTTPRequestId")).toBe("http_request_id");
  });
  test("already snake is untouched", () => {
    expect(toSnakeCase("password_hash")).toBe("password_hash");
  });
  test("single letter", () => {
    expect(toSnakeCase("x")).toBe("x");
  });
});

// --------------------------------------------------------------------
// Indexes normalization sanity
// --------------------------------------------------------------------

describe("snapshotFromResources — indexes", () => {
  test("index field keys resolve to snake_case column names", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true, primary: true } as any,
        createdAt: { type: "date", required: true },
      },
      options: {
        persistence: {
          provider: "postgres",
          indexes: [{ name: "idx_user_created", fields: ["createdAt"], unique: false } as DdlIndex],
        },
      } as any,
    };
    const snap = snapshotFromResources([makeParsed(def)]);
    expect(snap.resources[0].indexes[0].fields).toEqual(["created_at"]);
  });

  test("duplicate index names throw", () => {
    const def: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true, primary: true } as any,
        email: { type: "email", required: true },
      },
      options: {
        persistence: {
          provider: "postgres",
          indexes: [
            { name: "dup", fields: ["email"], unique: false } as DdlIndex,
            { name: "dup", fields: ["id"], unique: true } as DdlIndex,
          ],
        },
      } as any,
    };
    expect(() => snapshotFromResources([makeParsed(def)])).toThrow(/Duplicate index name/);
  });
});
