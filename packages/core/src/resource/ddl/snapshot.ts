/**
 * Phase 4c — Schema snapshot normalization + serialization.
 *
 * Pure functions, no I/O beyond the Bun-native SHA-256 hasher. Given the
 * same `ParsedResource[]`, these functions MUST produce byte-identical
 * `Snapshot` objects and byte-identical serialized JSON — this guarantee
 * is what makes the snapshot file usable as a git-checked-in artifact and
 * what makes checksum-based tamper detection (Agent C) meaningful.
 *
 * Pipeline:
 *
 *   ParsedResource[]  --snapshotFromResources-->  Snapshot
 *                                                    |
 *                                    serializeSnapshot | parseSnapshot
 *                                                    v
 *                                                 JSON string  (committed to .mandu/schema/applied.json)
 *
 * Nothing here touches the filesystem — the CLI (Agent E) and generator
 * (Agent D) are responsible for where the snapshot lives on disk.
 *
 * Normalization rules (documented in detail on each helper below):
 *   1. Only resources with a well-formed `options.persistence` are included.
 *   2. All resources must target the same `SqlProvider`; mixing throws.
 *   3. Table name: `options.persistence.tableName` > auto-pluralized
 *      `definition.name`. `options.autoPlural === false` keeps it singular.
 *   4. Column name: `fieldOverrides[key].columnName` > `camelCase → snake_case`.
 *   5. Primary key: `options.persistence.primaryKey` (string|[string]) >
 *      field with `primary: true` > error. Composite PK is v2+.
 *   6. `DdlDefault` derived from `field.default` with the string-magic
 *      "now" / "current_timestamp" shortcut. See `normalizeDefault`.
 *
 * References:
 *   docs/bun/phase-4c-team-plan.md §3 Agent B
 *   docs/rfcs/0001-db-resource-layer.md Appendix D.1 (dialect divergence)
 *   docs/rfcs/0001-db-resource-layer.md §4 D5 (opt-in `persistence` field)
 */

import type { ParsedResource } from "../parser";
import type { ResourceField, ResourceOptions } from "../schema";
import type {
  DdlDefault,
  DdlFieldDef,
  DdlFieldType,
  DdlIndex,
  DdlResource,
  Snapshot,
  SqlProvider,
} from "./types";
import { asPersistence, type ExtendedResourcePersistence, type FieldOverride } from "./persistence-types";

// ============================================
// Public API
// ============================================

/**
 * Normalize `ParsedResource[]` into a provider-tagged `Snapshot`.
 *
 * Resources whose `options.persistence` is missing/empty are silently
 * dropped — the resource generator emits contract/types/slot/client but
 * no DDL for such resources.
 *
 * Insertion order of fields (the order keys appear in the source
 * `definition.fields` object) is preserved; this is the author's intent
 * and the emit order for `CREATE TABLE`.
 *
 * Top-level `snapshot.resources` is sorted alphabetically by `name` —
 * this is what makes `serializeSnapshot` output stable across runs even
 * if the caller scans files in a different order.
 *
 * @throws TypeError on:
 *   - conflicting providers across persistent resources
 *   - zero primary-key fields on a persistent resource
 *   - more than one primary-key field (composite PK is v2)
 *   - duplicate table name after pluralization
 *   - invalid `field.default` value (functions, symbols, objects)
 *   - structurally broken `options.persistence` (see `asPersistence`)
 */
export function snapshotFromResources(resources: readonly ParsedResource[]): Snapshot {
  const ddlResources: DdlResource[] = [];
  let provider: SqlProvider | undefined;
  const seenTableNames = new Map<string, string>(); // tableName -> first resource that claimed it

  for (const parsed of resources) {
    // `options.persistence` is not declared on the public ResourceOptions —
    // it's an opt-in additive field (see persistence-types.ts for rationale).
    // Read it via an unknown cast and narrow with `asPersistence`.
    const rawPersistence = (parsed.definition.options as Record<string, unknown> | undefined)?.persistence;
    const persistence = asPersistence(rawPersistence);
    if (!persistence) continue; // non-persistent resource — skip

    if (provider === undefined) {
      provider = persistence.provider;
    } else if (provider !== persistence.provider) {
      throw new TypeError(
        `Mixed SQL providers in resource set: resource "${parsed.resourceName}" declares provider "${persistence.provider}" but the snapshot is already building for "${provider}". All persistent resources in a project must share one provider.`
      );
    }

    const ddlResource = normalizeResource(parsed, persistence);

    const prior = seenTableNames.get(ddlResource.name);
    if (prior !== undefined) {
      throw new TypeError(
        `Duplicate table name "${ddlResource.name}" — resources "${prior}" and "${parsed.resourceName}" both map to it. Use options.persistence.tableName to disambiguate.`
      );
    }
    seenTableNames.set(ddlResource.name, parsed.resourceName);

    ddlResources.push(ddlResource);
  }

  ddlResources.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    version: 1,
    provider: provider ?? "postgres", // empty set → default to postgres; it's meaningless for an empty resource list
    resources: ddlResources,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Deterministic JSON serialization — 2-space indent, sorted object keys,
 * stable array order. Byte-for-byte stable for the same `Snapshot`,
 * modulo `generatedAt` which the caller controls.
 *
 * We intentionally sort object keys rather than trusting the property
 * insertion order of the callers' objects — this guards against subtle
 * non-determinism when `Snapshot` is built by code that constructs
 * objects in different orders across refactors.
 *
 * Arrays are NOT sorted — their order is semantically load-bearing
 * (field emit order, sorted resource order).
 */
export function serializeSnapshot(s: Snapshot): string {
  return stringifyWithSortedKeys(s, 2);
}

/**
 * Parse a snapshot JSON string.
 *
 * @throws TypeError on invalid JSON, missing required fields, or
 *   `version` that this build does not understand.
 */
export function parseSnapshot(raw: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TypeError(
      `Invalid snapshot JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`Snapshot must be a JSON object, got ${typeof parsed}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new TypeError(
      `Unsupported snapshot version ${JSON.stringify(obj.version)}. This build understands version 1 only.`
    );
  }
  if (obj.provider !== "postgres" && obj.provider !== "mysql" && obj.provider !== "sqlite") {
    throw new TypeError(`Snapshot has invalid provider ${JSON.stringify(obj.provider)}`);
  }
  if (!Array.isArray(obj.resources)) {
    throw new TypeError(`Snapshot.resources must be an array`);
  }
  if (typeof obj.generatedAt !== "string") {
    throw new TypeError(`Snapshot.generatedAt must be an ISO string`);
  }
  // Deeper structural validation of resources is deferred to the diff
  // engine; tampering with fields of a stored snapshot would be caught
  // by the migration runtime's checksum before diff ever runs.
  return parsed as Snapshot;
}

/**
 * SHA-256 of the canonical serialization of a snapshot. Useful for quick
 * change detection ("has the committed schema drifted from the applied
 * snapshot?").
 *
 * Note: `generatedAt` is part of the canonical serialization, so two
 * snapshots with the same resources but different generation times will
 * hash differently. Callers that want a time-stable hash should zero out
 * `generatedAt` before calling.
 */
export function hashSnapshot(s: Snapshot): string {
  const canonical = serializeSnapshot(s);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(canonical);
  return hasher.digest("hex");
}

// ============================================
// Internals — resource normalization
// ============================================

function normalizeResource(
  parsed: ParsedResource,
  persistence: ExtendedResourcePersistence
): DdlResource {
  const { definition } = parsed;
  const tableName = resolveTableName(definition.name, definition.options, persistence);
  const overrides = persistence.fieldOverrides ?? {};

  // Respect insertion order — Object.entries preserves the author's key order.
  const fieldEntries = Object.entries(definition.fields);
  if (fieldEntries.length === 0) {
    // parser.ts already validates this, but guard defensively.
    throw new TypeError(`Resource "${parsed.resourceName}" has no fields`);
  }

  const declaredPk = resolveDeclaredPrimaryKey(persistence.primaryKey);
  const fields: DdlFieldDef[] = [];
  const pkFieldKeys: string[] = [];
  // Author field key (e.g. "passwordHash") → resolved column name (e.g. "password_hash").
  // Used by index normalization below to resolve declared index fields.
  const keyToColumn = new Map<string, string>();

  for (const [fieldKey, field] of fieldEntries) {
    const override = overrides[fieldKey];
    const ddlField = normalizeField(fieldKey, field, override, declaredPk, parsed.resourceName);
    if (ddlField.primary) pkFieldKeys.push(fieldKey);
    fields.push(ddlField);
    keyToColumn.set(fieldKey, ddlField.name);
  }

  if (pkFieldKeys.length === 0) {
    throw new TypeError(
      `Resource "${parsed.resourceName}" must have exactly one primary key field. Mark a field with \`primary: true\` (via fieldOverrides) or declare \`options.persistence.primaryKey\`.`
    );
  }
  if (pkFieldKeys.length > 1) {
    throw new TypeError(
      `Resource "${parsed.resourceName}" has ${pkFieldKeys.length} primary key fields (${pkFieldKeys.join(", ")}). Composite primary keys are not supported in v1.`
    );
  }

  const indexes = normalizeIndexes(persistence.indexes, keyToColumn, parsed.resourceName);

  return { name: tableName, fields, indexes };
}

function resolveTableName(
  resourceName: string,
  options: ResourceOptions | undefined,
  persistence: ExtendedResourcePersistence
): string {
  if (persistence.tableName) return persistence.tableName;
  // `options.pluralName` from the existing schema takes precedence over auto-plural,
  // but `tableName` trumps both — this preserves backward compat for users who
  // had a `pluralName` before Phase 4c.
  if (options?.pluralName) return options.pluralName;
  if (options?.autoPlural === false) return resourceName;
  return pluralize(resourceName);
}

/**
 * Conservative v1 pluralizer.
 *
 * Rules (in order):
 *   1. ends with `y` preceded by a consonant → `ies` ("city" → "cities")
 *   2. ends with `s` / `x` / `z` / `ch` / `sh` → `+es` ("box" → "boxes")
 *   3. default                                 → `+s` ("user" → "users")
 *
 * English has irregular plurals the framework cannot infer — that's the
 * escape hatch `options.persistence.tableName` exists for.
 */
function pluralize(singular: string): string {
  if (/[^aeiou]y$/i.test(singular)) {
    return singular.slice(0, -1) + "ies";
  }
  if (/(?:s|x|z|ch|sh)$/i.test(singular)) {
    return singular + "es";
  }
  return singular + "s";
}

function resolveDeclaredPrimaryKey(declared: ExtendedResourcePersistence["primaryKey"]): string | undefined {
  if (declared === undefined) return undefined;
  if (typeof declared === "string") return declared;
  return declared[0];
}

// ============================================
// Internals — field normalization
// ============================================

function normalizeField(
  fieldKey: string,
  field: ResourceField,
  override: FieldOverride | undefined,
  declaredPk: string | undefined,
  resourceName: string
): DdlFieldDef {
  const name = override?.columnName ?? toSnakeCase(fieldKey);
  const nullable = override?.nullable ?? !(field.required ?? false);

  // A field is a primary key if:
  //   - the explicit `persistence.primaryKey` names it, OR
  //   - the field's declaration carries `primary: true` (an opt-in, not the
  //     default on Mandu's ResourceField type; accessed via a best-effort
  //     cast because `ResourceField` predates this feature).
  const declaredPkMatch = declaredPk !== undefined && declaredPk === fieldKey;
  const fieldLevelPk = Boolean((field as ResourceField & { primary?: boolean }).primary);
  const primary = declaredPkMatch || fieldLevelPk;

  const unique = override?.unique ?? Boolean((field as ResourceField & { unique?: boolean }).unique);
  const indexed = override?.indexed ?? Boolean((field as ResourceField & { indexed?: boolean }).indexed);

  const def = override?.default ?? normalizeDefault(field.default, fieldKey, resourceName);

  const result: DdlFieldDef = {
    name,
    type: field.type as DdlFieldType,
    nullable,
    primary,
    unique,
    indexed,
  };
  if (def !== undefined) result.default = def;
  const maxLength = override?.maxLength ?? (field as ResourceField & { maxLength?: number }).maxLength;
  if (typeof maxLength === "number") result.maxLength = maxLength;
  return result;
}

/**
 * `camelCase` / `PascalCase` → `snake_case`. Leaves already-snake names
 * untouched. Runs of consecutive capitals are treated as a single word
 * (`HTTPRequest` → `http_request`) which matches PostgreSQL/Drizzle
 * conventions.
 */
export function toSnakeCase(input: string): string {
  if (input.length === 0) return input;
  // Insert underscores at run-of-caps/start-of-word boundaries, then lowercase.
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2") // camelCase → camel_Case
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2") // HTTPServer → HTTP_Server
    .toLowerCase();
}

/**
 * Normalize `ResourceField.default` to a `DdlDefault` discriminated union.
 *
 * Rules:
 *   undefined                            → no DEFAULT (returns undefined)
 *   null                                 → { kind: "null" }
 *   "now" | "current_timestamp"          → { kind: "now" }
 *   string (other)                       → { kind: "literal", value }
 *   number | boolean                     → { kind: "literal", value }
 *   function | symbol | object | array   → throws TypeError
 *
 * Arrays/objects are explicitly rejected: their JSON representation depends
 * on the receiving dialect's JSON column semantics, and the v1 contract
 * is that DEFAULT values are scalar. Users with JSON defaults should use
 * `{ kind: "sql", expr: "'[]'" }` via `fieldOverrides[key].default`.
 */
function normalizeDefault(
  raw: unknown,
  fieldKey: string,
  resourceName: string
): DdlDefault | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return { kind: "null" };
  if (typeof raw === "string") {
    if (raw === "now" || raw === "current_timestamp") return { kind: "now" };
    return { kind: "literal", value: raw };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw new TypeError(
        `Field "${resourceName}.${fieldKey}" has non-finite default (${String(raw)}). DEFAULT must be a finite number.`
      );
    }
    return { kind: "literal", value: raw };
  }
  if (typeof raw === "boolean") return { kind: "literal", value: raw };
  // Functions, symbols, objects, arrays, BigInt — none are representable
  // as a portable SQL DEFAULT literal. Force the user to be explicit via
  // `fieldOverrides[key].default = { kind: "sql", expr: ... }`.
  throw new TypeError(
    `Field "${resourceName}.${fieldKey}" has unsupported default type (${typeof raw}). Use a string, number, boolean, or null — or override via options.persistence.fieldOverrides.${fieldKey}.default with an explicit DdlDefault.`
  );
}

// ============================================
// Internals — index normalization
// ============================================

/**
 * Normalize user-declared indexes to DDL shape. The author's `idx.fields`
 * entries are field KEYS (as written in `definition.fields`); we resolve
 * each to the post-snake_case column name via `keyToColumn`. Entries
 * that don't match a known field key are passed through verbatim —
 * that supports the escape hatch of referencing a column directly.
 */
function normalizeIndexes(
  declared: DdlIndex[] | undefined,
  keyToColumn: ReadonlyMap<string, string>,
  resourceName: string
): DdlIndex[] {
  if (!declared || declared.length === 0) return [];
  const list = declared.map((idx) => {
    if (!idx.name) throw new TypeError(`Index on "${resourceName}" is missing a name`);
    if (!Array.isArray(idx.fields) || idx.fields.length === 0) {
      throw new TypeError(`Index "${resourceName}.${idx.name}" must declare at least one field`);
    }
    const columns = idx.fields.map((key) => keyToColumn.get(key) ?? key);
    return { name: idx.name, fields: columns, unique: Boolean(idx.unique) };
  });
  // Stable sort by name — makes snapshot output deterministic.
  list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // Detect duplicate index names after normalization.
  for (let i = 1; i < list.length; i++) {
    if (list[i].name === list[i - 1].name) {
      throw new TypeError(`Duplicate index name "${list[i].name}" on resource "${resourceName}"`);
    }
  }
  return list;
}

// ============================================
// Internals — deterministic JSON
// ============================================

/**
 * `JSON.stringify` that sorts object keys at every depth. Arrays are
 * preserved in order. `undefined` values (and their keys) are dropped.
 */
function stringifyWithSortedKeys(value: unknown, indent: number): string {
  return JSON.stringify(sortKeys(value), null, indent);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined
    );
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeys(v);
    return out;
  }
  return value;
}
