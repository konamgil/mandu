/**
 * @mandujs/core/db/migrations/lock
 *
 * Per-dialect serialization for the migration apply loop. Prevents two
 * concurrent `MigrationRunner.apply()` calls — in the same process or
 * (for PG/MySQL) across processes — from stepping on each other.
 *
 * ## Strategy matrix
 *
 * | Provider  | Strategy              | Mechanism                                                        |
 * |-----------|-----------------------|------------------------------------------------------------------|
 * | postgres  | `pg_advisory_lock`    | `pg_advisory_lock($1)` — lockId = `hashtext('mandu:migrations')` |
 * | mysql     | `mysql_get_lock`      | `GET_LOCK('mandu:migrations', 60)` — blocks up to 60 s           |
 * | sqlite    | `sqlite_immediate`    | `BEGIN IMMEDIATE` on a dedicated connection                      |
 * | (any)     | `none`                | No-op (tests / non-concurrent scenarios)                         |
 *
 * All strategies wrap the same conceptual lock — the lockId string
 * (`"mandu:migrations"` by default) is stable across runs, so two
 * processes agreeing on the same string will serialise. If callers pass
 * a custom `lockId`, every participant MUST use the same value.
 *
 * ## Release semantics
 *
 * `acquireMigrationLock(...)` returns a `MigrationLock` whose
 * `release()` is idempotent. Callers should invoke it in a `finally`
 * block — the `MigrationRunner.apply()` implementation does exactly
 * this. SQLite's `sqlite_immediate` releases by committing the wrapper
 * transaction; the other strategies issue an explicit unlock statement.
 *
 * @module db/migrations/lock
 */

import type { LockStrategy } from "../../resource/ddl/types";
import type { Db } from "../index";

// ─── Public API ─────────────────────────────────────────────────────────────

/** A held migration lock. Calling `release()` twice is a no-op. */
export interface MigrationLock {
  release(): Promise<void>;
}

/**
 * Default lockId — a stable string shared by every participant. For
 * `pg_advisory_lock` we hash this to a bigint via `hashtext()`; the
 * other dialects use the raw string.
 */
export const DEFAULT_LOCK_ID = "mandu:migrations";

/** MySQL `GET_LOCK` default timeout in seconds. */
const MYSQL_LOCK_TIMEOUT_SECONDS = 60;

/**
 * Acquire the migration lock for the configured dialect.
 *
 * - `pg_advisory_lock` blocks the connection until the lock is granted.
 * - `mysql_get_lock` blocks up to {@link MYSQL_LOCK_TIMEOUT_SECONDS}; on
 *   timeout we throw a descriptive error.
 * - `sqlite_immediate` enters a BEGIN IMMEDIATE transaction on a
 *   dedicated connection; if another writer holds the database lock,
 *   Bun.SQL surfaces `SQLITE_BUSY` which we rethrow.
 * - `none` is a no-op — useful for tests and single-shot CLI runs.
 *
 * @throws on MySQL lock timeout (`GET_LOCK` returns `0`), on explicit
 *   `GET_LOCK` error (returns `null`), or on provider/strategy mismatch
 *   (e.g. requesting `pg_advisory_lock` while `db.provider === "sqlite"`).
 */
export async function acquireMigrationLock(
  db: Db,
  strategy: LockStrategy,
  lockId: string = DEFAULT_LOCK_ID,
): Promise<MigrationLock> {
  switch (strategy) {
    case "pg_advisory_lock":
      assertProvider(db, "postgres", strategy);
      return await acquirePgAdvisoryLock(db, lockId);
    case "mysql_get_lock":
      assertProvider(db, "mysql", strategy);
      return await acquireMysqlLock(db, lockId);
    case "sqlite_immediate":
      assertProvider(db, "sqlite", strategy);
      return await acquireSqliteImmediate(db, lockId);
    case "none":
      return makeNoopLock();
  }
}

// ─── Strategy impls ─────────────────────────────────────────────────────────

async function acquirePgAdvisoryLock(
  db: Db,
  lockId: string,
): Promise<MigrationLock> {
  // Postgres advisory locks take a bigint. We derive it from the lockId
  // string via `hashtext()::bigint` so the value is deterministic for
  // the same input across instances. `hashtext` returns int4; cast to
  // bigint for compatibility with `pg_advisory_lock(bigint)`.
  //
  // `SELECT pg_advisory_lock(hashtext($1)::bigint)` is safer than
  // computing the hash client-side because it keeps every participant
  // in the same database agreeing on the value without language-specific
  // hash-function reproduction.
  await db`SELECT pg_advisory_lock(hashtext(${lockId})::bigint)`;

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      try {
        await db`SELECT pg_advisory_unlock(hashtext(${lockId})::bigint)`;
      } catch (err) {
        // Best-effort release — if the connection has already died or
        // the lock is no longer held, we don't want to mask the caller's
        // unwind path. Surface the error name for diagnostics.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[@mandujs/core/db/migrations] pg_advisory_unlock failed: ${msg}`,
        );
      }
    },
  };
}

async function acquireMysqlLock(
  db: Db,
  lockId: string,
): Promise<MigrationLock> {
  // `GET_LOCK` returns:
  //   1 — lock granted
  //   0 — timeout (still blocked after the timeout)
  //   NULL — error (aborted, killed, etc.)
  //
  // Bun.SQL returns the single row as `[{ acquired: 1 }]`; we destructure
  // defensively to handle any driver-side aliasing.
  const timeoutSec = MYSQL_LOCK_TIMEOUT_SECONDS;
  const rows = await db<{ acquired: number | bigint | null }>`
    SELECT GET_LOCK(${lockId}, ${timeoutSec}) AS acquired
  `;
  const first = rows[0];
  const value = first ? Number(first.acquired) : NaN;
  if (value !== 1) {
    throw new Error(
      `[@mandujs/core/db/migrations] GET_LOCK(${JSON.stringify(lockId)}, ${timeoutSec}) ` +
        `returned ${value === 0 ? "0 (timeout)" : "NULL (error)"}; ` +
        `another migration runner may be holding the lock.`,
    );
  }

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      try {
        await db`SELECT RELEASE_LOCK(${lockId})`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[@mandujs/core/db/migrations] RELEASE_LOCK failed: ${msg}`,
        );
      }
    },
  };
}

/**
 * Per-process mutex queues keyed by lockId. SQLite is single-writer at
 * the engine level, so cross-process writes already serialise — the
 * remaining failure mode is two `apply()` calls in the SAME process
 * interleaving their `db.transaction(...)` calls. A process-local
 * promise chain is the simplest correct coordinator.
 *
 * This is stored on `globalThis` rather than module scope so that
 * multiple copies of the module (e.g. reloads under watch mode) still
 * agree on the same queue.
 */
const SQLITE_LOCK_REGISTRY_SYMBOL = Symbol.for(
  "@mandujs/core/db/migrations/sqlite-locks",
);
interface SqliteLockRegistry {
  /** Most-recent promise in each lockId's queue. */
  chains: Map<string, Promise<void>>;
}
function getSqliteLockRegistry(): SqliteLockRegistry {
  const g = globalThis as unknown as Record<symbol, unknown>;
  let reg = g[SQLITE_LOCK_REGISTRY_SYMBOL] as SqliteLockRegistry | undefined;
  if (!reg) {
    reg = { chains: new Map() };
    g[SQLITE_LOCK_REGISTRY_SYMBOL] = reg;
  }
  return reg;
}

async function acquireSqliteImmediate(
  db: Db,
  lockId: string,
): Promise<MigrationLock> {
  // Why an in-process mutex instead of `BEGIN IMMEDIATE`:
  //
  //   - `BEGIN IMMEDIATE` at the handle level conflicts with the
  //     `db.transaction()` calls we issue per-migration — SQLite
  //     errors with "cannot start a transaction within a transaction".
  //   - SQLite is already single-writer at the engine level, so
  //     cross-process writes queue via the OS file lock; the only
  //     race we need to close is two concurrent `apply()` calls in
  //     the SAME process interleaving their statements.
  //   - A promise-chain mutex is the minimal correct mechanism for
  //     in-process serialisation. Every apply() awaits the previous
  //     holder's release before entering the critical section.
  //
  // Cross-process migration coordination is v2 per RFC 0001 §8.
  //
  // Sanity probe: executing a trivial statement on the handle at
  // acquire time catches "pool closed" / handle validity issues
  // before the caller commits resources to the apply loop.
  await db`SELECT 1`;

  const registry = getSqliteLockRegistry();
  const previous = registry.chains.get(lockId) ?? Promise.resolve();

  let release!: () => void;
  const nextPromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => nextPromise);
  registry.chains.set(lockId, tail);

  // Wait for the previous holder to release.
  await previous;

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      release();
      // If no one queued behind us, drop the entry so the registry
      // doesn't grow unbounded across many apply() cycles.
      if (registry.chains.get(lockId) === tail) {
        registry.chains.delete(lockId);
      }
    },
  };
}

function makeNoopLock(): MigrationLock {
  let released = false;
  return {
    async release(): Promise<void> {
      released = true;
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function assertProvider(
  db: Db,
  expected: Db["provider"],
  strategy: LockStrategy,
): void {
  if (db.provider !== expected) {
    throw new Error(
      `[@mandujs/core/db/migrations] Lock strategy ${JSON.stringify(strategy)} requires ` +
        `provider ${JSON.stringify(expected)}, but db.provider is ${JSON.stringify(db.provider)}.`,
    );
  }
}
