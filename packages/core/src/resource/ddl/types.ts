/**
 * Phase 4c shared types — DDL / diff / migration runtime.
 *
 * This file is the CONTRACT between Agents A (DDL emit), B (diff engine),
 * C (migration runtime), and downstream D (generator) / E (CLI) / F (QA).
 * Do NOT add logic here — pure types only. Logic belongs next to each
 * agent's module.
 *
 * Source of truth for:
 * - SqlProvider, DdlFieldType, DdlDefault, DdlFieldDef, DdlIndex, DdlResource
 * - Snapshot (serialized state of the schema at a point in time)
 * - Change (discriminated union the diff engine emits)
 * - PendingMigration / AppliedMigration (runtime plan + history records)
 * - LockStrategy (per-dialect apply serialization)
 *
 * References:
 *   docs/bun/phase-4c-team-plan.md — team plan + I/O contracts
 *   docs/rfcs/0001-db-resource-layer.md — design decisions incl. Appendix D
 */

// ========== Provider + field types ==========

/** Supported SQL providers. Drizzle/Atlas/sqldef all share this same set. */
export type SqlProvider = "postgres" | "mysql" | "sqlite";

/**
 * DDL-relevant subset of Mandu's existing `FieldType`. v1 supports:
 * string/number/boolean/date/uuid/email/url/json/array/object.
 *
 * `array` and `object` are persisted as JSON columns (JSONB on Postgres,
 * JSON on MySQL, TEXT on SQLite). Users who need typed JSON fields should
 * define a Zod schema in the contract layer; the DB only stores the blob.
 */
export type DdlFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "uuid"
  | "email"
  | "url"
  | "json"
  | "array"
  | "object";

/** How a DEFAULT clause is represented. */
export type DdlDefault =
  | { kind: "now" } // CURRENT_TIMESTAMP / NOW() — dialect-mapped
  | { kind: "null" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "sql"; expr: string }; // raw expression — caller responsible for portability

/**
 * DDL-level field definition. Normalized form derived from
 * ResourceField + ResourceDefinition.persistence.fieldOverrides at
 * snapshot creation time (see `snapshotFromResources`).
 */
export interface DdlFieldDef {
  /** Column name in the DB. Derived from Mandu's field key (e.g. `passwordHash` → `password_hash` when `snake_case: true`). */
  name: string;
  /** Abstract Mandu field type. Maps to dialect-specific SQL type via the type map. */
  type: DdlFieldType;
  /** Whether NULL is allowed. Default: false (derived from `ResourceField.required === false`). */
  nullable: boolean;
  /** Primary key flag. Exactly one field per resource should have this set (composite keys are v2+). */
  primary: boolean;
  /** Unique constraint — emits `UNIQUE` on the column (standalone, not composite). */
  unique: boolean;
  /** Whether this field participates in a single-column index (non-unique). */
  indexed: boolean;
  /** DEFAULT clause. */
  default?: DdlDefault;
  /**
   * For `string` type — VARCHAR length hint. Ignored by SQLite (TEXT is
   * unbounded). Postgres prefers TEXT when undefined; MySQL emits
   * VARCHAR(255) default when undefined.
   */
  maxLength?: number;
}

/** Multi-column index definition (composite). Single-column indexes live on `DdlFieldDef.indexed`. */
export interface DdlIndex {
  name: string;          // must be unique within the resource
  fields: string[];      // field names (in order)
  unique: boolean;
}

/**
 * DDL-level resource — what actually reaches the emit / diff engines.
 * Produced by `snapshotFromResources` from `ParsedResource[]`. Contains
 * only the information the DB layer cares about.
 */
export interface DdlResource {
  /** Table name in the DB. Usually `pluralize(resourceName)` or explicit override. */
  name: string;
  fields: DdlFieldDef[];  // order-preserving; affects emit order
  indexes: DdlIndex[];    // multi-column indexes only; single-column live on fields
}

// ========== Snapshots ==========

/**
 * The full schema state at a point in time. Serialized to JSON and stored
 * at `.mandu/schema/applied.json` after each successful apply.
 * The diff engine compares an old snapshot (or null for first run) to a
 * next snapshot computed from the current resource files.
 */
export interface Snapshot {
  /** Format version of this snapshot file. Bump on breaking schema changes. */
  version: 1;
  /** Which provider this snapshot was built for. Diffing across providers is an error. */
  provider: SqlProvider;
  /** Resources in deterministic order (sorted by name). */
  resources: DdlResource[];
  /** When this snapshot was computed. For provenance only — not used by diff. */
  generatedAt: string; // ISO 8601
}

// ========== Changes ==========

/**
 * Discriminated union emitted by the diff engine. Every `Change` is one
 * "atomic" DDL operation. Emit order is deterministic so the generated
 * migration SQL is stable across runs.
 *
 * Rename is NOT auto-detected — the diff engine always emits drop + add.
 * The CLI layer (Agent E) asks the user whether consecutive drop+add are
 * a rename and rewrites the Change list accordingly before SQL emit.
 */
export type Change =
  | { kind: "create-table"; resource: DdlResource }
  | { kind: "drop-table"; resourceName: string }
  | { kind: "add-column"; resourceName: string; field: DdlFieldDef }
  | { kind: "drop-column"; resourceName: string; fieldName: string }
  | {
      kind: "alter-column-type";
      resourceName: string;
      fieldName: string;
      fromType: DdlFieldType;
      toType: DdlFieldType;
      /** v1 emits a stub comment. User edits the migration manually. */
      stub: true;
    }
  | { kind: "alter-column-nullable"; resourceName: string; fieldName: string; nullable: boolean }
  | { kind: "alter-column-default"; resourceName: string; fieldName: string; default?: DdlDefault }
  | { kind: "add-index"; resourceName: string; index: DdlIndex }
  | { kind: "drop-index"; resourceName: string; indexName: string }
  | {
      kind: "rename-table";
      oldName: string;
      newName: string;
      /** Emitted only after CLI user confirmation. Diff engine never emits directly. */
      origin: "user-confirmed";
    }
  | {
      kind: "rename-column";
      resourceName: string;
      oldName: string;
      newName: string;
      origin: "user-confirmed";
    };

// ========== Migration runtime ==========

/** A migration file that exists in the migrations directory but has not yet been applied. */
export interface PendingMigration {
  /** Zero-padded 4-digit sequence, e.g. "0001". Must sort lexicographically. */
  version: string;
  /** Filename relative to the migrations dir, e.g. "0001_create_users.sql". */
  filename: string;
  /** Full SQL text of the migration. */
  sql: string;
  /** SHA-256 of `sql` with `\r\n` normalized to `\n` — used by `__mandu_migrations` for tamper detection. */
  checksum: string;
  /** Filesystem mtime of the migration file. */
  createdAt: Date;
}

/** A migration that has been applied — read from the `__mandu_migrations` history table. */
export interface AppliedMigration {
  version: string;
  filename: string;
  checksum: string;
  appliedAt: Date;
  executionMs: number;
  success: boolean;
}

/** Snapshot of the migration history at call time. */
export interface MigrationStatus {
  applied: AppliedMigration[];
  pending: PendingMigration[];
  /** Migrations that exist in history but whose checksum no longer matches the file. */
  tampered: Array<{ version: string; filename: string; storedChecksum: string; currentChecksum: string }>;
  /** Migration files on disk that have no history row and don't match pending (shouldn't happen but guards against dir corruption). */
  orphaned: Array<{ filename: string }>;
}

// ========== Lock strategy (per-dialect apply serialization) ==========

/**
 * Single-process apply serialization. Multi-instance coordination is out of
 * scope for v1 (RFC §8 non-goals).
 *
 * Defaults per provider (Agent C implements):
 * - postgres → "pg_advisory_lock"  (`pg_advisory_lock(bigint)` + `pg_advisory_unlock`)
 * - mysql    → "mysql_get_lock"    (`GET_LOCK('mandu-migrations', 60)` + `RELEASE_LOCK`)
 * - sqlite   → "sqlite_immediate"  (`BEGIN IMMEDIATE` for the apply transaction)
 */
export type LockStrategy = "pg_advisory_lock" | "mysql_get_lock" | "sqlite_immediate" | "none";

// ========== Scope fences — what v1 does NOT cover ==========

/**
 * v1 scope (enforced by Agent A/B — they should NOT handle these):
 *   - Foreign keys
 *   - CHECK constraints
 *   - ENUM types (custom Postgres ENUMs, MySQL ENUM columns)
 *   - Computed / GENERATED columns
 *   - Partitioning
 *   - Triggers, views, stored procedures
 *   - Alter column type (stub only — user edits manually)
 *   - Rename auto-detection (always drop+add unless CLI prompts user)
 *   - Multi-column primary key (composite)
 *   - Rollback / DOWN migrations
 *   - Repeatable migrations (Flyway `R__` style)
 *
 * Anything outside this list is intentionally out of scope for Phase 4c
 * v1. Expansion lands in 4c.1 / 4c.2 patches after 4c merge.
 */
export type Phase4cScopeMarker = typeof _PHASE_4C_V1_SCOPE;
const _PHASE_4C_V1_SCOPE = Symbol.for("@mandujs/core/resource/ddl/phase-4c-v1");
