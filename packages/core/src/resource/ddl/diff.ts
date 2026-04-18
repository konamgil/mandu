/**
 * Phase 4c — Schema diff engine.
 *
 * Given an old `Snapshot` (or `null` for "no schema yet") and a next
 * `Snapshot`, produce a deterministic ordered list of `Change` entries.
 * The output feeds Agent A's `emitChange(change, provider)` to produce
 * the migration SQL body.
 *
 * # Rename policy
 *
 * This engine NEVER emits `rename-table` or `rename-column` — Appendix D.1
 * of the RFC and the team plan §7 are explicit: rename auto-detection is
 * dangerous (cost of a false positive = silent data loss across an
 * ADD+DROP pair). The CLI (Agent E) prompts the user to reinterpret
 * consecutive drop+add pairs as renames; only AFTER user confirmation
 * are `rename-*` Change entries inserted (with `origin: "user-confirmed"`).
 *
 * # Determinism
 *
 * Two identical inputs MUST produce byte-identical `Change[]` across
 * runs. We achieve this with:
 *   1. Alphabetical sort at every partition step.
 *   2. Exhaustive ordering rules below — no "depends on iteration order".
 *
 * # Emit order (cross-table)
 *
 *   1. All `drop-index`      sort by (resourceName, indexName)
 *   2. All `drop-table`      sort by resourceName
 *   3. All `create-table`    sort by resourceName (indexes included inline)
 *   4. Per-kept-table, in resourceName order:
 *        a. drop-column
 *        b. alter-column-type
 *        c. alter-column-nullable
 *        d. alter-column-default
 *        e. add-column
 *   5. All `add-index`       sort by (resourceName, indexName)
 *
 * # Rationale for this order
 *
 * Drop-index before drop-table: PG and MySQL allow `DROP TABLE` to
 * implicitly drop dependent indexes, but being explicit makes the
 * migration reversible when a reviewer edits the plan. Drop-column
 * before alter: dropping a column before altering its siblings avoids
 * "column not found" errors when the same table's shape is fluid.
 * Add-index last: the column(s) the index targets must already exist,
 * and a freshly-created table may also introduce new indexes — those
 * are emitted as part of `create-table` so this phase covers only
 * indexes added to tables that existed on both sides.
 *
 * # v1 non-goals
 *
 *   - Rename auto-detection (always drop+add — see above)
 *   - FK / CHECK / ENUM / composite PK diffing (not in scope)
 *   - Cross-provider diff (thrown — a caller bug)
 *
 * References:
 *   docs/bun/phase-4c-team-plan.md §3 Agent B
 *   docs/rfcs/0001-db-resource-layer.md §7 (risk: rename false-positive)
 */

import type { ParsedResource } from "../parser";
import type {
  Change,
  DdlDefault,
  DdlFieldDef,
  DdlIndex,
  DdlResource,
  Snapshot,
} from "./types";
import { snapshotFromResources } from "./snapshot";

// ============================================
// Public API
// ============================================

/**
 * Compute the ordered list of `Change` entries from `old` → `next`.
 *
 * `old === null` means "no schema has been applied yet" — every resource
 * in `next` becomes a `create-table`.
 *
 * `next === null` is NOT a valid input — it would mean "delete everything",
 * which is dangerous enough that we force the caller to build an empty
 * Snapshot (`{ version: 1, provider, resources: [], generatedAt }`) to
 * express it explicitly. This surfaces in tests (`diff.test.ts` TC-3).
 *
 * @throws TypeError if the two snapshots declare different providers —
 *   a cross-provider diff is meaningless and always a caller bug.
 */
export function diffSnapshots(old: Snapshot | null, next: Snapshot): Change[] {
  if (next === null || next === undefined) {
    throw new TypeError(
      "diffSnapshots: `next` must be a Snapshot (use an empty-resources snapshot to express 'drop all')"
    );
  }
  if (old !== null && old.provider !== next.provider) {
    throw new TypeError(
      `Cross-provider diff: old is "${old.provider}", next is "${next.provider}". Snapshots from different SQL providers cannot be diffed — migrating across providers requires a manual dump+load, not a diff.`
    );
  }

  // Bucket every change by kind so we can sort within each kind and then
  // assemble in the canonical cross-table order at the end.
  const dropIndexes: Change[] = [];
  const dropTables: Change[] = [];
  const createTables: Change[] = [];
  // Per-kept-table changes — keyed by resourceName then ordered sub-lists
  // to maintain the within-table order invariant.
  const keptTables = new Map<
    string,
    {
      dropColumns: Change[];
      alterColumnTypes: Change[];
      alterColumnNullables: Change[];
      alterColumnDefaults: Change[];
      addColumns: Change[];
    }
  >();
  const addIndexes: Change[] = [];

  const oldByName = new Map((old?.resources ?? []).map((r) => [r.name, r]));
  const newByName = new Map(next.resources.map((r) => [r.name, r]));

  // Resources that disappear entirely → drop indexes, drop table.
  for (const [name, resource] of oldByName) {
    if (newByName.has(name)) continue;
    for (const idx of resource.indexes) {
      dropIndexes.push({ kind: "drop-index", resourceName: name, indexName: idx.name });
    }
    dropTables.push({ kind: "drop-table", resourceName: name });
  }

  // Resources that are new → create-table (indexes inline — Agent A's
  // `emitCreateTable` is responsible for emitting CREATE INDEX alongside).
  for (const [name, resource] of newByName) {
    if (oldByName.has(name)) continue;
    createTables.push({ kind: "create-table", resource });
  }

  // Resources on both sides → drill into fields + indexes.
  for (const [name, newResource] of newByName) {
    const oldResource = oldByName.get(name);
    if (!oldResource) continue;

    const bucket = ensureKeptBucket(keptTables, name);
    diffFields(oldResource, newResource, bucket);

    const { dropped, added } = diffIndexes(oldResource, newResource);
    for (const idx of dropped) {
      dropIndexes.push({ kind: "drop-index", resourceName: name, indexName: idx.name });
    }
    for (const idx of added) {
      addIndexes.push({ kind: "add-index", resourceName: name, index: idx });
    }
  }

  // Sort each kind lexicographically. Sort is `stable` in Bun/Node (V8) so
  // ties fall to original insertion order; we never rely on that — every
  // bucket enters pre-sorted by the iteration structure above, and the
  // sort comparators below make the final result fully total.
  sortChanges(dropIndexes, (c) => indexKey(c));
  sortChanges(dropTables, (c) => resourceKey(c));
  sortChanges(createTables, (c) => resourceKey(c));
  sortChanges(addIndexes, (c) => indexKey(c));

  // Assemble in canonical order.
  const out: Change[] = [];
  out.push(...dropIndexes);
  out.push(...dropTables);
  out.push(...createTables);

  // Per-kept-table inner changes — iterate in alphabetical table order.
  const keptTableNames = [...keptTables.keys()].sort();
  for (const name of keptTableNames) {
    const bucket = keptTables.get(name)!;
    sortChanges(bucket.dropColumns, fieldNameKey);
    sortChanges(bucket.alterColumnTypes, fieldNameKey);
    sortChanges(bucket.alterColumnNullables, fieldNameKey);
    sortChanges(bucket.alterColumnDefaults, fieldNameKey);
    sortChanges(bucket.addColumns, addColumnFieldNameKey);
    out.push(...bucket.dropColumns);
    out.push(...bucket.alterColumnTypes);
    out.push(...bucket.alterColumnNullables);
    out.push(...bucket.alterColumnDefaults);
    out.push(...bucket.addColumns);
  }

  out.push(...addIndexes);
  return out;
}

/**
 * Convenience: compute `next` snapshot from `ParsedResource[]` and diff it
 * against an already-applied snapshot. Returns both so callers can write
 * the next snapshot back to disk after `mandu db apply` succeeds.
 */
export function diffResources(
  resources: readonly ParsedResource[],
  applied: Snapshot | null
): { snapshot: Snapshot; changes: Change[] } {
  const snapshot = snapshotFromResources(resources);
  const changes = diffSnapshots(applied, snapshot);
  return { snapshot, changes };
}

// ============================================
// Internals — per-resource field diff
// ============================================

function diffFields(
  oldResource: DdlResource,
  newResource: DdlResource,
  bucket: {
    dropColumns: Change[];
    alterColumnTypes: Change[];
    alterColumnNullables: Change[];
    alterColumnDefaults: Change[];
    addColumns: Change[];
  }
): void {
  const oldFields = new Map(oldResource.fields.map((f) => [f.name, f]));
  const newFields = new Map(newResource.fields.map((f) => [f.name, f]));
  const resourceName = newResource.name;

  // Fields removed in `next`.
  for (const [name] of oldFields) {
    if (newFields.has(name)) continue;
    bucket.dropColumns.push({ kind: "drop-column", resourceName, fieldName: name });
  }

  // Fields added in `next`.
  for (const [name, field] of newFields) {
    if (oldFields.has(name)) continue;
    bucket.addColumns.push({ kind: "add-column", resourceName, field });
  }

  // Fields present on both sides — inspect for type / nullable / default
  // divergence. Diff engine is intentionally coarse here: one Change per
  // dimension so the CLI/emit can surface each reason separately.
  for (const [name, newField] of newFields) {
    const oldField = oldFields.get(name);
    if (!oldField) continue;

    if (oldField.type !== newField.type) {
      bucket.alterColumnTypes.push({
        kind: "alter-column-type",
        resourceName,
        fieldName: name,
        fromType: oldField.type,
        toType: newField.type,
        stub: true,
      });
    }
    if (oldField.nullable !== newField.nullable) {
      bucket.alterColumnNullables.push({
        kind: "alter-column-nullable",
        resourceName,
        fieldName: name,
        nullable: newField.nullable,
      });
    }
    if (!defaultsEqual(oldField.default, newField.default)) {
      const change: Change = {
        kind: "alter-column-default",
        resourceName,
        fieldName: name,
      };
      if (newField.default !== undefined) {
        change.default = newField.default;
      }
      bucket.alterColumnDefaults.push(change);
    }
  }
}

function ensureKeptBucket(
  keptTables: Map<
    string,
    {
      dropColumns: Change[];
      alterColumnTypes: Change[];
      alterColumnNullables: Change[];
      alterColumnDefaults: Change[];
      addColumns: Change[];
    }
  >,
  name: string
) {
  let bucket = keptTables.get(name);
  if (!bucket) {
    bucket = {
      dropColumns: [],
      alterColumnTypes: [],
      alterColumnNullables: [],
      alterColumnDefaults: [],
      addColumns: [],
    };
    keptTables.set(name, bucket);
  }
  return bucket;
}

// ============================================
// Internals — index diff
// ============================================

function diffIndexes(
  oldResource: DdlResource,
  newResource: DdlResource
): { dropped: DdlIndex[]; added: DdlIndex[] } {
  const oldByName = new Map(oldResource.indexes.map((i) => [i.name, i]));
  const newByName = new Map(newResource.indexes.map((i) => [i.name, i]));
  const dropped: DdlIndex[] = [];
  const added: DdlIndex[] = [];
  for (const [name, idx] of oldByName) {
    if (!newByName.has(name)) dropped.push(idx);
  }
  for (const [name, idx] of newByName) {
    const prior = oldByName.get(name);
    if (!prior) {
      added.push(idx);
      continue;
    }
    // Same name, different shape → drop + add (v1; see `rename-*` policy).
    if (!indexShapeEqual(prior, idx)) {
      dropped.push(prior);
      added.push(idx);
    }
  }
  return { dropped, added };
}

function indexShapeEqual(a: DdlIndex, b: DdlIndex): boolean {
  if (a.unique !== b.unique) return false;
  if (a.fields.length !== b.fields.length) return false;
  for (let i = 0; i < a.fields.length; i++) {
    if (a.fields[i] !== b.fields[i]) return false;
  }
  return true;
}

// ============================================
// Internals — default equality
// ============================================

/**
 * Defaults compare "by value". We stringify the discriminated union and
 * compare the strings — cheap, correct, and side-steps JavaScript's
 * structural-equality blind spot. Two `undefined`s compare equal.
 */
function defaultsEqual(a: DdlDefault | undefined, b: DdlDefault | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ============================================
// Internals — sort helpers
// ============================================

function sortChanges(list: Change[], key: (c: Change) => string): void {
  list.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function indexKey(c: Change): string {
  // Covers drop-index + add-index.
  if (c.kind === "drop-index") return `${c.resourceName}\u0000${c.indexName}`;
  if (c.kind === "add-index") return `${c.resourceName}\u0000${c.index.name}`;
  return "";
}

function resourceKey(c: Change): string {
  if (c.kind === "drop-table") return c.resourceName;
  if (c.kind === "create-table") return c.resource.name;
  return "";
}

function fieldNameKey(c: Change): string {
  // Covers drop-column / alter-column-*.
  if (c.kind === "drop-column" || c.kind === "alter-column-type" || c.kind === "alter-column-nullable" || c.kind === "alter-column-default") {
    return c.fieldName;
  }
  return "";
}

function addColumnFieldNameKey(c: Change): string {
  return c.kind === "add-column" ? c.field.name : "";
}
