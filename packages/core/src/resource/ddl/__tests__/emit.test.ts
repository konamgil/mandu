/**
 * Phase 4c — DDL emit engine tests.
 *
 * Structure:
 *   1. `quoteIdent` — identifier quoting + rejection rules (security).
 *   2. `resolveColumnType` — dialect-matrix over 10 field types.
 *   3. `resolveDefault` + `nowExpr` — default literal + NOW() parity.
 *   4. `emitCreateTable` — column + constraint + index emission.
 *   5. `emitChange` — one section per `Change.kind`.
 *   6. `emitSchema` / `emitChanges` — multi-resource + empty-input cases.
 *   7. Injection-resistance regression (Agent G will cross-check).
 *
 * Each test that varies by dialect uses `describe.each([...providers])`
 * to guarantee parity without manual duplication.
 */
import { describe, expect, test } from "bun:test";

import {
  emitChange,
  emitChanges,
  emitCreateTable,
  emitDropTable,
  emitSchema,
  quoteIdent,
} from "../emit";
import { nowExpr, resolveColumnType, resolveDefault } from "../type-map";
import type {
  Change,
  DdlFieldDef,
  DdlFieldType,
  DdlIndex,
  DdlResource,
  SqlProvider,
} from "../types";

// ---------------------------------------------------------------------
// Shared fixtures / helpers
// ---------------------------------------------------------------------

const PROVIDERS: readonly SqlProvider[] = ["postgres", "mysql", "sqlite"];

function field(partial: Partial<DdlFieldDef> & { name: string; type: DdlFieldType }): DdlFieldDef {
  return {
    nullable: false,
    primary: false,
    unique: false,
    indexed: false,
    ...partial,
  };
}

function resource(name: string, fields: DdlFieldDef[], indexes: DdlIndex[] = []): DdlResource {
  return { name, fields, indexes };
}

const USER_RESOURCE: DdlResource = resource("users", [
  field({ name: "id", type: "uuid", primary: true }),
  field({ name: "email", type: "email", unique: true }),
  field({ name: "name", type: "string", maxLength: 120 }),
]);

// ---------------------------------------------------------------------
// 1. quoteIdent
// ---------------------------------------------------------------------

describe("quoteIdent", () => {
  test("postgres wraps in double quotes", () => {
    expect(quoteIdent("users", "postgres")).toBe('"users"');
  });
  test("mysql wraps in backticks", () => {
    expect(quoteIdent("users", "mysql")).toBe("`users`");
  });
  test("sqlite wraps in double quotes", () => {
    expect(quoteIdent("users", "sqlite")).toBe('"users"');
  });

  test("rejects names containing a double quote (postgres)", () => {
    expect(() => quoteIdent('bad"name', "postgres")).toThrow(/unquotable character/);
  });
  test("rejects names containing a double quote (sqlite)", () => {
    expect(() => quoteIdent('bad"name', "sqlite")).toThrow(/unquotable character/);
  });
  test("rejects names containing a backtick (mysql)", () => {
    expect(() => quoteIdent("bad`name", "mysql")).toThrow(/unquotable character/);
  });

  test("rejects empty string on every provider", () => {
    for (const p of PROVIDERS) {
      expect(() => quoteIdent("", p)).toThrow(/must not be empty/);
    }
  });

  test("rejects identifiers longer than 63 chars", () => {
    const long = "x".repeat(70);
    for (const p of PROVIDERS) {
      expect(() => quoteIdent(long, p)).toThrow(/too long/);
    }
  });

  test("accepts identifier exactly 63 chars", () => {
    const exact = "a".repeat(63);
    expect(quoteIdent(exact, "postgres")).toBe(`"${exact}"`);
    expect(quoteIdent(exact, "mysql")).toBe(`\`${exact}\``);
  });

  test("rejects NUL byte", () => {
    expect(() => quoteIdent("bad\0name", "postgres")).toThrow(/NUL byte/);
  });

  test("rejects non-string input", () => {
    // @ts-expect-error — deliberate type violation
    expect(() => quoteIdent(42, "postgres")).toThrow(/must be a string/);
  });

  test("allows underscores and digits", () => {
    expect(quoteIdent("user_sessions_v2", "postgres")).toBe('"user_sessions_v2"');
  });
});

// ---------------------------------------------------------------------
// 2. resolveColumnType — dialect matrix
// ---------------------------------------------------------------------

describe("resolveColumnType", () => {
  test("string with maxLength → VARCHAR(N) on postgres", () => {
    expect(resolveColumnType(field({ name: "n", type: "string", maxLength: 100 }), "postgres"))
      .toBe("VARCHAR(100)");
  });
  test("string without maxLength → TEXT on postgres", () => {
    expect(resolveColumnType(field({ name: "n", type: "string" }), "postgres")).toBe("TEXT");
  });
  test("string without maxLength → VARCHAR(255) on mysql", () => {
    expect(resolveColumnType(field({ name: "n", type: "string" }), "mysql")).toBe("VARCHAR(255)");
  });
  test("string with maxLength → VARCHAR(N) on mysql", () => {
    expect(resolveColumnType(field({ name: "n", type: "string", maxLength: 40 }), "mysql"))
      .toBe("VARCHAR(40)");
  });
  test("string on sqlite is always TEXT (ignores maxLength)", () => {
    expect(resolveColumnType(field({ name: "n", type: "string", maxLength: 10 }), "sqlite"))
      .toBe("TEXT");
  });

  test("uuid → UUID/CHAR(36)/TEXT", () => {
    expect(resolveColumnType(field({ name: "id", type: "uuid" }), "postgres")).toBe("UUID");
    expect(resolveColumnType(field({ name: "id", type: "uuid" }), "mysql")).toBe("CHAR(36)");
    expect(resolveColumnType(field({ name: "id", type: "uuid" }), "sqlite")).toBe("TEXT");
  });

  test("boolean → BOOLEAN / TINYINT(1) / INTEGER", () => {
    expect(resolveColumnType(field({ name: "b", type: "boolean" }), "postgres")).toBe("BOOLEAN");
    expect(resolveColumnType(field({ name: "b", type: "boolean" }), "mysql")).toBe("TINYINT(1)");
    expect(resolveColumnType(field({ name: "b", type: "boolean" }), "sqlite")).toBe("INTEGER");
  });

  test("number → DOUBLE PRECISION / DOUBLE / REAL", () => {
    expect(resolveColumnType(field({ name: "n", type: "number" }), "postgres")).toBe("DOUBLE PRECISION");
    expect(resolveColumnType(field({ name: "n", type: "number" }), "mysql")).toBe("DOUBLE");
    expect(resolveColumnType(field({ name: "n", type: "number" }), "sqlite")).toBe("REAL");
  });

  test("date → TIMESTAMPTZ / DATETIME(6) / TEXT", () => {
    expect(resolveColumnType(field({ name: "d", type: "date" }), "postgres")).toBe("TIMESTAMPTZ");
    expect(resolveColumnType(field({ name: "d", type: "date" }), "mysql")).toBe("DATETIME(6)");
    expect(resolveColumnType(field({ name: "d", type: "date" }), "sqlite")).toBe("TEXT");
  });

  test("json → JSONB / JSON / TEXT", () => {
    expect(resolveColumnType(field({ name: "j", type: "json" }), "postgres")).toBe("JSONB");
    expect(resolveColumnType(field({ name: "j", type: "json" }), "mysql")).toBe("JSON");
    expect(resolveColumnType(field({ name: "j", type: "json" }), "sqlite")).toBe("TEXT");
  });

  test("array + object persist as JSON on postgres/mysql, TEXT on sqlite", () => {
    for (const t of ["array", "object"] as const) {
      expect(resolveColumnType(field({ name: "x", type: t }), "postgres")).toBe("JSONB");
      expect(resolveColumnType(field({ name: "x", type: t }), "mysql")).toBe("JSON");
      expect(resolveColumnType(field({ name: "x", type: t }), "sqlite")).toBe("TEXT");
    }
  });

  test("email → VARCHAR(320) / VARCHAR(320) / TEXT", () => {
    expect(resolveColumnType(field({ name: "e", type: "email" }), "postgres")).toBe("VARCHAR(320)");
    expect(resolveColumnType(field({ name: "e", type: "email" }), "mysql")).toBe("VARCHAR(320)");
    expect(resolveColumnType(field({ name: "e", type: "email" }), "sqlite")).toBe("TEXT");
  });

  test("url → VARCHAR(2048) / VARCHAR(2048) / TEXT", () => {
    expect(resolveColumnType(field({ name: "u", type: "url" }), "postgres")).toBe("VARCHAR(2048)");
    expect(resolveColumnType(field({ name: "u", type: "url" }), "mysql")).toBe("VARCHAR(2048)");
    expect(resolveColumnType(field({ name: "u", type: "url" }), "sqlite")).toBe("TEXT");
  });
});

// ---------------------------------------------------------------------
// 3. resolveDefault + nowExpr
// ---------------------------------------------------------------------

describe("resolveDefault", () => {
  test("kind:now returns NOW() on postgres", () => {
    expect(resolveDefault({ kind: "now" }, "postgres")).toBe("NOW()");
  });
  test("kind:now returns NOW() on mysql", () => {
    expect(resolveDefault({ kind: "now" }, "mysql")).toBe("NOW()");
  });
  test("kind:now returns CURRENT_TIMESTAMP on sqlite", () => {
    expect(resolveDefault({ kind: "now" }, "sqlite")).toBe("CURRENT_TIMESTAMP");
  });

  test("kind:null returns NULL everywhere", () => {
    for (const p of PROVIDERS) {
      expect(resolveDefault({ kind: "null" }, p)).toBe("NULL");
    }
  });

  test("string literal is ANSI-escaped (single quote doubling)", () => {
    expect(resolveDefault({ kind: "literal", value: "O'Brien" }, "postgres"))
      .toBe("'O''Brien'");
    expect(resolveDefault({ kind: "literal", value: "O'Brien" }, "mysql"))
      .toBe("'O''Brien'");
  });

  test("number literal is emitted verbatim", () => {
    expect(resolveDefault({ kind: "literal", value: 42 }, "mysql")).toBe("42");
    expect(resolveDefault({ kind: "literal", value: -1.5 }, "postgres")).toBe("-1.5");
  });

  test("non-finite number throws", () => {
    expect(() => resolveDefault({ kind: "literal", value: Number.NaN }, "postgres"))
      .toThrow(/finite number/);
    expect(() => resolveDefault({ kind: "literal", value: Number.POSITIVE_INFINITY }, "postgres"))
      .toThrow(/finite number/);
  });

  test("boolean literal → TRUE/FALSE on postgres, mysql; 1/0 on sqlite", () => {
    expect(resolveDefault({ kind: "literal", value: true }, "postgres")).toBe("TRUE");
    expect(resolveDefault({ kind: "literal", value: false }, "postgres")).toBe("FALSE");
    expect(resolveDefault({ kind: "literal", value: true }, "mysql")).toBe("TRUE");
    expect(resolveDefault({ kind: "literal", value: true }, "sqlite")).toBe("1");
    expect(resolveDefault({ kind: "literal", value: false }, "sqlite")).toBe("0");
  });

  test("sql expression is passed through verbatim", () => {
    expect(resolveDefault({ kind: "sql", expr: "gen_random_uuid()" }, "postgres"))
      .toBe("gen_random_uuid()");
  });
});

describe("nowExpr", () => {
  test.each([["postgres", "NOW()"], ["mysql", "NOW()"], ["sqlite", "CURRENT_TIMESTAMP"]] as const)(
    "%s → %s",
    (p, expected) => {
      expect(nowExpr(p)).toBe(expected);
    },
  );
});

// ---------------------------------------------------------------------
// 4. emitCreateTable
// ---------------------------------------------------------------------

describe("emitCreateTable", () => {
  test("emits 3-field table on postgres", () => {
    const sql = emitCreateTable(USER_RESOURCE, "postgres");
    expect(sql).toBe(
      [
        'CREATE TABLE "users" (',
        '  "id" UUID PRIMARY KEY,',
        '  "email" VARCHAR(320) NOT NULL UNIQUE,',
        '  "name" VARCHAR(120) NOT NULL',
        ");",
      ].join("\n"),
    );
  });

  test("emits 3-field table on mysql", () => {
    const sql = emitCreateTable(USER_RESOURCE, "mysql");
    expect(sql).toBe(
      [
        "CREATE TABLE `users` (",
        "  `id` CHAR(36) PRIMARY KEY,",
        "  `email` VARCHAR(320) NOT NULL UNIQUE,",
        "  `name` VARCHAR(120) NOT NULL",
        ");",
      ].join("\n"),
    );
  });

  test("emits 3-field table on sqlite", () => {
    const sql = emitCreateTable(USER_RESOURCE, "sqlite");
    expect(sql).toBe(
      [
        'CREATE TABLE "users" (',
        '  "id" TEXT PRIMARY KEY,',
        '  "email" TEXT NOT NULL UNIQUE,',
        '  "name" TEXT NOT NULL',
        ");",
      ].join("\n"),
    );
  });

  test("PRIMARY KEY column does not emit NOT NULL (implied)", () => {
    const sql = emitCreateTable(USER_RESOURCE, "postgres");
    // The id column should be `"id" UUID PRIMARY KEY` — no NOT NULL.
    expect(sql).toContain('"id" UUID PRIMARY KEY,');
    expect(sql).not.toContain('"id" UUID PRIMARY KEY NOT NULL');
  });

  test("inline UNIQUE emitted for non-primary field", () => {
    const sql = emitCreateTable(USER_RESOURCE, "postgres");
    expect(sql).toContain('"email" VARCHAR(320) NOT NULL UNIQUE');
  });

  test("emits DEFAULT clause per dialect for a date field", () => {
    const r = resource("events", [
      field({ name: "id", type: "uuid", primary: true }),
      field({ name: "created_at", type: "date", default: { kind: "now" } }),
    ]);
    expect(emitCreateTable(r, "postgres")).toContain(
      '"created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    );
    expect(emitCreateTable(r, "mysql")).toContain(
      "`created_at` DATETIME(6) NOT NULL DEFAULT NOW()",
    );
    expect(emitCreateTable(r, "sqlite")).toContain(
      '"created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
  });

  test("emits CREATE INDEX for each indexed:true field (auto-named)", () => {
    const r = resource("posts", [
      field({ name: "id", type: "uuid", primary: true }),
      field({ name: "author_id", type: "uuid", indexed: true }),
      field({ name: "published_at", type: "date", indexed: true }),
    ]);
    const sql = emitCreateTable(r, "postgres");
    expect(sql).toContain('CREATE INDEX "idx_posts_author_id" ON "posts" ("author_id");');
    expect(sql).toContain('CREATE INDEX "idx_posts_published_at" ON "posts" ("published_at");');
  });

  test("does NOT auto-index unique / primary columns (implicit)", () => {
    const r = resource("foo", [
      field({ name: "id", type: "uuid", primary: true, indexed: true }),
      field({ name: "slug", type: "string", unique: true, indexed: true }),
    ]);
    const sql = emitCreateTable(r, "postgres");
    expect(sql).not.toContain("idx_foo_id");
    expect(sql).not.toContain("idx_foo_slug");
  });

  test("emits CREATE UNIQUE INDEX for multi-column unique DdlIndex", () => {
    const r = resource("memberships", [
      field({ name: "id", type: "uuid", primary: true }),
      field({ name: "user_id", type: "uuid" }),
      field({ name: "org_id", type: "uuid" }),
    ], [{ name: "uniq_membership_user_org", fields: ["user_id", "org_id"], unique: true }]);

    const sql = emitCreateTable(r, "postgres");
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "uniq_membership_user_org" ON "memberships" ("user_id", "org_id");',
    );
  });

  test("non-unique multi-column index emits plain CREATE INDEX", () => {
    const r = resource("logs", [
      field({ name: "id", type: "uuid", primary: true }),
      field({ name: "ts", type: "date" }),
      field({ name: "level", type: "string" }),
    ], [{ name: "idx_logs_ts_level", fields: ["ts", "level"], unique: false }]);

    expect(emitCreateTable(r, "postgres")).toContain(
      'CREATE INDEX "idx_logs_ts_level" ON "logs" ("ts", "level");',
    );
  });

  test("validates that DdlIndex references existing fields", () => {
    const r = resource("x", [
      field({ name: "id", type: "uuid", primary: true }),
    ], [{ name: "bad_idx", fields: ["missing"], unique: false }]);
    expect(() => emitCreateTable(r, "postgres")).toThrow(/references unknown field/);
  });

  test("throws for empty field list", () => {
    const r = resource("empty", []);
    expect(() => emitCreateTable(r, "postgres")).toThrow(/no fields/);
  });
});

describe("emitDropTable", () => {
  test.each([...PROVIDERS] as SqlProvider[])("%s emits DROP TABLE IF EXISTS", (p) => {
    const sql = emitDropTable("widgets", p);
    expect(sql).toContain("DROP TABLE IF EXISTS");
    expect(sql.endsWith(";")).toBe(true);
    if (p === "mysql") expect(sql).toContain("`widgets`");
    else expect(sql).toContain('"widgets"');
  });
});

// ---------------------------------------------------------------------
// 5. emitChange — one section per Change.kind
// ---------------------------------------------------------------------

describe("emitChange — add-column", () => {
  const change: Change = {
    kind: "add-column",
    resourceName: "users",
    field: field({ name: "age", type: "number", nullable: true }),
  };

  test("postgres", () => {
    expect(emitChange(change, "postgres"))
      .toBe('ALTER TABLE "users" ADD COLUMN "age" DOUBLE PRECISION;');
  });
  test("mysql", () => {
    expect(emitChange(change, "mysql"))
      .toBe("ALTER TABLE `users` ADD COLUMN `age` DOUBLE;");
  });
  test("sqlite", () => {
    expect(emitChange(change, "sqlite"))
      .toBe('ALTER TABLE "users" ADD COLUMN "age" REAL;');
  });
});

describe("emitChange — drop-column", () => {
  const change: Change = {
    kind: "drop-column",
    resourceName: "users",
    fieldName: "age",
  };

  test("postgres", () => {
    expect(emitChange(change, "postgres"))
      .toBe('ALTER TABLE "users" DROP COLUMN "age";');
  });
  test("mysql", () => {
    expect(emitChange(change, "mysql"))
      .toBe("ALTER TABLE `users` DROP COLUMN `age`;");
  });
  test("sqlite (assumes SQLite >= 3.35)", () => {
    // Documented assumption inline in emit.ts — Bun ships a modern SQLite.
    expect(emitChange(change, "sqlite"))
      .toBe('ALTER TABLE "users" DROP COLUMN "age";');
  });
});

describe("emitChange — alter-column-type stub", () => {
  const change: Change = {
    kind: "alter-column-type",
    resourceName: "users",
    fieldName: "age",
    fromType: "number",
    toType: "string",
    stub: true,
  };

  test("emits comment block with required TODO text", () => {
    for (const p of PROVIDERS) {
      const sql = emitChange(change, p);
      expect(sql).toContain("-- TODO: Mandu does not auto-generate ALTER COLUMN TYPE in v1.");
      expect(sql).toContain("mandu db apply");
      expect(sql).toContain("Column type change detected: users.age");
      expect(sql).toContain("from: number");
      expect(sql).toContain("to:   string");
    }
  });

  test("includes SELECT 1 no-op statement", () => {
    const sql = emitChange(change, "postgres");
    expect(sql).toContain("SELECT 1;");
  });
});

describe("emitChange — alter-column-nullable", () => {
  test("postgres SET NOT NULL / DROP NOT NULL", () => {
    expect(
      emitChange(
        { kind: "alter-column-nullable", resourceName: "users", fieldName: "email", nullable: false },
        "postgres",
      ),
    ).toBe('ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;');
    expect(
      emitChange(
        { kind: "alter-column-nullable", resourceName: "users", fieldName: "email", nullable: true },
        "postgres",
      ),
    ).toBe('ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;');
  });

  test("sqlite emits a stub (cannot toggle NOT NULL in place)", () => {
    const sql = emitChange(
      { kind: "alter-column-nullable", resourceName: "users", fieldName: "email", nullable: true },
      "sqlite",
    );
    expect(sql).toContain("TODO: SQLite cannot toggle NOT NULL in place");
    expect(sql).toContain("SELECT 1;");
  });

  test("mysql emits a stub (MODIFY COLUMN needs full type)", () => {
    const sql = emitChange(
      { kind: "alter-column-nullable", resourceName: "users", fieldName: "email", nullable: false },
      "mysql",
    );
    expect(sql).toContain("MySQL MODIFY COLUMN requires");
    expect(sql).toContain("SELECT 1;");
  });
});

describe("emitChange — alter-column-default", () => {
  test("postgres SET DEFAULT", () => {
    const sql = emitChange(
      {
        kind: "alter-column-default",
        resourceName: "users",
        fieldName: "status",
        default: { kind: "literal", value: "active" },
      },
      "postgres",
    );
    expect(sql).toBe('ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT \'active\';');
  });

  test("postgres DROP DEFAULT when default is undefined", () => {
    const sql = emitChange(
      { kind: "alter-column-default", resourceName: "users", fieldName: "status" },
      "postgres",
    );
    expect(sql).toBe('ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;');
  });

  test("mysql supports SET/DROP DEFAULT directly", () => {
    expect(
      emitChange(
        {
          kind: "alter-column-default",
          resourceName: "u",
          fieldName: "f",
          default: { kind: "literal", value: 1 },
        },
        "mysql",
      ),
    ).toBe("ALTER TABLE `u` ALTER COLUMN `f` SET DEFAULT 1;");
  });
});

describe("emitChange — indexes", () => {
  test("add-index single column, non-unique", () => {
    for (const p of PROVIDERS) {
      const sql = emitChange(
        {
          kind: "add-index",
          resourceName: "users",
          index: { name: "idx_users_email", fields: ["email"], unique: false },
        },
        p,
      );
      expect(sql).toContain("CREATE INDEX");
      expect(sql).not.toContain("UNIQUE");
    }
  });

  test("add-index multi-column, unique", () => {
    const sql = emitChange(
      {
        kind: "add-index",
        resourceName: "memberships",
        index: { name: "uniq_user_org", fields: ["user_id", "org_id"], unique: true },
      },
      "postgres",
    );
    expect(sql).toBe('CREATE UNIQUE INDEX "uniq_user_org" ON "memberships" ("user_id", "org_id");');
  });

  test("drop-index — postgres + sqlite standalone, mysql with ON table", () => {
    expect(
      emitChange({ kind: "drop-index", resourceName: "users", indexName: "idx_users_email" }, "postgres"),
    ).toBe('DROP INDEX "idx_users_email";');
    expect(
      emitChange({ kind: "drop-index", resourceName: "users", indexName: "idx_users_email" }, "sqlite"),
    ).toBe('DROP INDEX "idx_users_email";');
    expect(
      emitChange({ kind: "drop-index", resourceName: "users", indexName: "idx_users_email" }, "mysql"),
    ).toBe("DROP INDEX `idx_users_email` ON `users`;");
  });

  test("add-index with no fields throws", () => {
    expect(() =>
      emitChange(
        {
          kind: "add-index",
          resourceName: "users",
          index: { name: "x", fields: [], unique: false },
        },
        "postgres",
      ),
    ).toThrow(/no fields/);
  });
});

describe("emitChange — rename", () => {
  test("rename-table (user-confirmed) per dialect", () => {
    for (const p of PROVIDERS) {
      const sql = emitChange(
        { kind: "rename-table", oldName: "old_users", newName: "users", origin: "user-confirmed" },
        p,
      );
      expect(sql).toContain("RENAME TO");
      if (p === "mysql") {
        expect(sql).toBe("ALTER TABLE `old_users` RENAME TO `users`;");
      } else {
        expect(sql).toBe(`ALTER TABLE "old_users" RENAME TO "users";`);
      }
    }
  });

  test("rename-column (user-confirmed) per dialect", () => {
    expect(
      emitChange(
        {
          kind: "rename-column",
          resourceName: "users",
          oldName: "e_mail",
          newName: "email",
          origin: "user-confirmed",
        },
        "postgres",
      ),
    ).toBe('ALTER TABLE "users" RENAME COLUMN "e_mail" TO "email";');

    expect(
      emitChange(
        {
          kind: "rename-column",
          resourceName: "users",
          oldName: "e_mail",
          newName: "email",
          origin: "user-confirmed",
        },
        "mysql",
      ),
    ).toBe("ALTER TABLE `users` RENAME COLUMN `e_mail` TO `email`;");

    expect(
      emitChange(
        {
          kind: "rename-column",
          resourceName: "users",
          oldName: "e_mail",
          newName: "email",
          origin: "user-confirmed",
        },
        "sqlite",
      ),
    ).toBe('ALTER TABLE "users" RENAME COLUMN "e_mail" TO "email";');
  });
});

describe("emitChange — create-table / drop-table dispatch", () => {
  test("create-table dispatch emits full CREATE TABLE", () => {
    const sql = emitChange({ kind: "create-table", resource: USER_RESOURCE }, "postgres");
    expect(sql).toContain('CREATE TABLE "users"');
  });

  test("drop-table dispatch emits DROP TABLE IF EXISTS", () => {
    const sql = emitChange({ kind: "drop-table", resourceName: "users" }, "mysql");
    expect(sql).toBe("DROP TABLE IF EXISTS `users`;");
  });

  test("unknown kind throws", () => {
    // @ts-expect-error — deliberate invalid input
    expect(() => emitChange({ kind: "unsupported" }, "postgres")).toThrow(/unknown Change\.kind/);
  });
});

// ---------------------------------------------------------------------
// 6. emitSchema / emitChanges — multi-statement composition
// ---------------------------------------------------------------------

describe("emitSchema", () => {
  test("emits CREATE TABLE for each resource in order", () => {
    const rs = [
      resource("a", [field({ name: "id", type: "uuid", primary: true })]),
      resource("b", [field({ name: "id", type: "uuid", primary: true })]),
      resource("c", [field({ name: "id", type: "uuid", primary: true })]),
    ];
    const sql = emitSchema(rs, "postgres");
    const idxA = sql.indexOf('CREATE TABLE "a"');
    const idxB = sql.indexOf('CREATE TABLE "b"');
    const idxC = sql.indexOf('CREATE TABLE "c"');
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);
    expect(idxC).toBeGreaterThan(idxB);
  });

  test("empty array → empty string", () => {
    expect(emitSchema([], "postgres")).toBe("");
  });

  test("separates resources with a blank line", () => {
    const rs = [
      resource("a", [field({ name: "id", type: "uuid", primary: true })]),
      resource("b", [field({ name: "id", type: "uuid", primary: true })]),
    ];
    const sql = emitSchema(rs, "sqlite");
    expect(sql).toMatch(/\);\n\nCREATE TABLE "b"/);
  });
});

describe("emitChanges", () => {
  test("empty array returns empty string (not whitespace)", () => {
    expect(emitChanges([], "postgres")).toBe("");
  });

  test("joins change outputs with newlines", () => {
    const changes: Change[] = [
      { kind: "drop-table", resourceName: "x" },
      { kind: "drop-table", resourceName: "y" },
    ];
    expect(emitChanges(changes, "postgres")).toBe(
      [
        'DROP TABLE IF EXISTS "x";',
        'DROP TABLE IF EXISTS "y";',
      ].join("\n"),
    );
  });

  test("preserves order across heterogeneous change kinds", () => {
    const changes: Change[] = [
      {
        kind: "create-table",
        resource: resource("new_table", [field({ name: "id", type: "uuid", primary: true })]),
      },
      {
        kind: "add-column",
        resourceName: "users",
        field: field({ name: "age", type: "number", nullable: true }),
      },
    ];
    const sql = emitChanges(changes, "postgres");
    expect(sql.indexOf("CREATE TABLE")).toBeLessThan(sql.indexOf("ADD COLUMN"));
  });
});

// ---------------------------------------------------------------------
// 7. Injection-resistance / security regression
// ---------------------------------------------------------------------

describe("security — SQL injection resistance", () => {
  test("malicious resource name with closing quote + DROP is rejected", () => {
    const malicious: DdlResource = {
      name: 'x"; DROP TABLE users; --',
      fields: [field({ name: "id", type: "uuid", primary: true })],
      indexes: [],
    };
    expect(() => emitCreateTable(malicious, "postgres")).toThrow(/unquotable character/);
  });

  test("malicious field name with backtick is rejected on mysql", () => {
    const bad: DdlResource = {
      name: "users",
      fields: [field({ name: "id`; DROP;", type: "uuid", primary: true })],
      indexes: [],
    };
    expect(() => emitCreateTable(bad, "mysql")).toThrow(/unquotable character/);
  });

  test("malicious index name is rejected", () => {
    expect(() =>
      emitChange(
        {
          kind: "add-index",
          resourceName: "users",
          index: { name: 'bad"idx', fields: ["id"], unique: false },
        },
        "postgres",
      ),
    ).toThrow(/unquotable character/);
  });

  test("string literal DEFAULT with quote is escaped, not rejected", () => {
    // Literals are data, not identifiers — they escape, not throw.
    const r = resource("t", [
      field({ name: "id", type: "uuid", primary: true }),
      field({
        name: "note",
        type: "string",
        default: { kind: "literal", value: "'; DROP TABLE; --" },
      }),
    ]);
    const sql = emitCreateTable(r, "postgres");
    // Single quotes in the value are escaped to ''. The DROP is inside
    // a balanced pair of single quotes, i.e. data not SQL.
    expect(sql).toContain("DEFAULT '''; DROP TABLE; --'");
    // The leading quote in the user input was escaped (''') — the token
    // that follows is inside the string literal, not executable SQL.
    const defaultMatch = sql.match(/DEFAULT ('(?:''|[^'])*')/);
    expect(defaultMatch).not.toBeNull();
    expect(defaultMatch?.[1]).toBe("'''; DROP TABLE; --'");
  });
});
