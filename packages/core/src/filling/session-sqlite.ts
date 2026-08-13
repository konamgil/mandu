/**
 * @mandujs/core/filling/session-sqlite
 *
 * SQLite-backed `SessionStorage` — drop-in replacement for
 * {@link createCookieSessionStorage} when session payloads outgrow the
 * 4 KB cookie budget or when you need server-side invalidation.
 *
 * ## Contract
 *
 * Implements the same `SessionStorage` interface as
 * `createCookieSessionStorage`. The existing `session()` middleware and
 * the `saveSession` / `destroySession` helpers work unchanged — only the
 * construction call changes.
 *
 * ## Cookie shape
 *
 * Only a signed **session id** travels in the cookie. The actual session
 * `data` lives in SQLite keyed by id. Cookie value is
 * `encodeURIComponent(<uuidv7>) + "." + <hmac-sha256-base64>`, identical
 * in shape to `CookieManager.setSigned` output.
 *
 * ## Phase 4a Appendix D compliance
 *
 * - **D.4 WAL mode**: issued at init via `PRAGMA journal_mode = WAL` so
 *   concurrent writers don't serialise on the default rollback journal.
 *   The Bun.SQL wrapper deliberately does not auto-enable WAL (some
 *   embedded deployments need rollback journals) — we opt in here.
 * - **D.5 use `createDb`**: connection goes through `@mandujs/core/db`,
 *   never `new Bun.SQL` directly. Keeps URL/options translation in
 *   exactly one place.
 *
 * ## TTL GC
 *
 * Expired rows are swept by a cron job registered via
 * `@mandujs/core/scheduler`. If `Bun.cron` is unavailable (pre-1.3.12),
 * we warn once and continue — the caller can still invoke
 * {@link SqliteSessionStorage.gcNow} manually from their own boot hook.
 *
 * @example
 * ```ts
 * import { createSqliteSessionStorage } from "@mandujs/core/compat/filling/session-sqlite";
 * import { session } from "@mandujs/core/middleware";
 *
 * const storage = createSqliteSessionStorage({
 *   cookie: { secrets: [process.env.SESSION_SECRET!] },
 *   dbPath: ".mandu/sessions.db",
 *   ttlSeconds: 60 * 60 * 24 * 7, // 7 days
 * });
 *
 * // on shutdown:
 * await storage.close();
 * ```
 *
 * @module filling/session-sqlite
 */

import { createDb, type Db } from "../db";
import { defineCron, type CronRegistration } from "../scheduler";
import type { CookieManager, CookieOptions } from "./context";
import {
  Session,
  type CookieSessionOptions,
  type SessionData,
  type SessionStorage,
} from "./session";

// ─── Public API ─────────────────────────────────────────────────────────────

/** Construction options for {@link createSqliteSessionStorage}. */
export interface SqliteSessionStorageOptions {
  /**
   * Cookie-layer settings — reused verbatim from
   * {@link CookieSessionOptions}. The cookie only carries a signed id,
   * but name / secrets / flags / max-age still apply.
   */
  cookie: CookieSessionOptions["cookie"];
  /**
   * SQLite database path. Accepts `":memory:"` for transient tests or a
   * filesystem path for persisted sessions. Default: `".mandu/sessions.db"`.
   *
   * The string is appended to `sqlite:` to form a URL that
   * `@mandujs/core/db` accepts.
   */
  dbPath?: string;
  /**
   * Table name for the session rows. Default: `"mandu_sessions"`.
   *
   * Not parameterisable at query time (SQLite does not bind identifiers),
   * so we validate against `SAFE_IDENT_RE` at construction to keep the
   * name out of injection-prone string interpolation territory.
   */
  table?: string;
  /**
   * Absolute session lifetime in seconds. Default: `604800` (7 days). A
   * row's `expires_at` is (re)set on every commit; old values are wiped
   * by {@link SqliteSessionStorage.gcNow}.
   */
  ttlSeconds?: number;
  /**
   * Cron schedule for the TTL sweep. Default: `"0 * * * *"` (hourly).
   * Set to `false` to disable the cron entirely — callers can still
   * invoke `gcNow()` manually.
   */
  gcSchedule?: string | false;
}

/**
 * `SessionStorage` + SQLite-specific affordances. Returned by
 * {@link createSqliteSessionStorage}.
 */
export interface SqliteSessionStorage extends SessionStorage {
  /**
   * Immediately sweep expired rows. Safe to invoke at any time — the
   * cron job calls the same underlying delete.
   *
   * @returns The number of rows deleted.
   */
  gcNow(): Promise<number>;
  /**
   * Stop the GC cron (if started) and close the DB pool. Call from your
   * shutdown hook to release file handles.
   */
  close(): Promise<void>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_DB_PATH = ".mandu/sessions.db";
const DEFAULT_TABLE = "mandu_sessions";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const DEFAULT_GC_SCHEDULE = "0 * * * *"; // hourly

/**
 * Safe identifier pattern for the user-supplied `table` name. SQLite does
 * not bind identifiers, so the table name is interpolated directly into
 * DDL/DML — we constrain it to `[A-Za-z_][A-Za-z0-9_]*` to eliminate any
 * injection surface.
 */
const SAFE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ─── HMAC helpers ────────────────────────────────────────────────────────────
//
// Structurally identical to the private `hmacSign` inside `context.ts` and
// the signing logic in `createCookieSessionStorage`. Duplicated rather than
// shared to avoid widening `filling/context.ts`'s public surface; TODO:
// extract into a private `filling/hmac.ts` once a third call site appears.

async function hmacSign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "");
}

/**
 * Verify a signed cookie value against each secret in rotation order.
 * Returns the raw session id on success; `null` when none of the secrets
 * validate (invalid signature, tampered value, or no cookie).
 */
async function verifySignedId(
  rawCookieValue: string | undefined,
  secrets: readonly string[],
): Promise<string | null> {
  if (!rawCookieValue) return null;
  const dot = rawCookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = rawCookieValue.slice(0, dot);
  const signature = rawCookieValue.slice(dot + 1);
  if (!payload || !signature) return null;
  for (const secret of secrets) {
    const expected = await hmacSign(payload, secret);
    if (expected === signature) {
      try {
        return decodeURIComponent(payload);
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ─── Set-Cookie serialisation ───────────────────────────────────────────────

function serializeSetCookie(
  name: string,
  value: string,
  opts: CookieOptions,
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (typeof opts.maxAge === "number") parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  return parts.join("; ");
}

// ─── Row shape ──────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  data: string;
  expires_at: number;
  // Index signature so it satisfies the `Record<string, unknown>` constraint
  // that `queryOne`'s generic expects. Property-level types above still win
  // for known keys.
  [key: string]: unknown;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Construct a SQLite-backed session storage.
 *
 * Initialisation is performed lazily on the first call to
 * {@link SessionStorage.getSession} / {@link SessionStorage.commitSession} /
 * {@link SessionStorage.destroySession} / {@link SqliteSessionStorage.gcNow}
 * — the constructor never opens a connection itself. This matches
 * `@mandujs/core/db`'s own laziness and keeps environment-driven
 * construction cheap at boot.
 *
 * @throws {Error} Synchronously when `cookie.secrets` is empty or when
 *   `table` fails the safe-identifier check.
 */
export function createSqliteSessionStorage(
  options: SqliteSessionStorageOptions,
): SqliteSessionStorage {
  const {
    cookie,
    dbPath = DEFAULT_DB_PATH,
    table = DEFAULT_TABLE,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    gcSchedule = DEFAULT_GC_SCHEDULE,
  } = options;

  const {
    name: cookieName = "__session",
    secrets,
    httpOnly = true,
    secure = process.env.NODE_ENV === "production",
    sameSite = "lax",
    maxAge = ttlSeconds,
    path = "/",
    domain,
  } = cookie;

  if (!secrets || secrets.length === 0) {
    throw new Error(
      "[Mandu Session SQLite] At least one cookie.secret is required.",
    );
  }
  if (!SAFE_IDENT_RE.test(table)) {
    throw new Error(
      `[Mandu Session SQLite] Invalid table name ${JSON.stringify(table)}. ` +
        `Must match ${SAFE_IDENT_RE}.`,
    );
  }

  const cookieOpts: CookieOptions = {
    httpOnly,
    secure,
    sameSite,
    maxAge,
    path,
    domain,
  };

  // ─── DB init (idempotent) ─────────────────────────────────────────────────

  const url = `sqlite:${dbPath}`;
  const db: Db = createDb({ url });

  // Init is run at most once. Each public method awaits this promise to
  // guarantee the schema + PRAGMAs are in place before any other query.
  let initPromise: Promise<void> | null = null;
  let closed = false;

  function ensureInit(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      // Appendix D.4: enable WAL explicitly. Concurrent session writes on
      // the default rollback journal serialise hard; WAL gives us
      // readers-don't-block-writers semantics. Idempotent — if the file
      // is already in WAL, this is a no-op reflected in the return row.
      //
      // `PRAGMA journal_mode = WAL` must be run on the handle, not in a
      // transaction. `:memory:` databases accept the pragma but silently
      // remain in "memory" mode — we don't assert the return value here
      // to keep `:memory:` valid for tests; the WAL-mode test asserts on
      // a file-backed DB instead.
      //
      // Interpolation is safe here — the SQL text is a literal, no user
      // input.
      await db`PRAGMA journal_mode = WAL`;

      // Identifier was validated above, so direct interpolation into DDL
      // is safe and unavoidable (SQLite does not bind identifiers).
      const createTableSql = `CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`;
      const createIndexSql = `CREATE INDEX IF NOT EXISTS ${table}_expires ON ${table}(expires_at)`;

      await execRaw(db, createTableSql);
      await execRaw(db, createIndexSql);
    })();
    return initPromise;
  }

  // ─── Cron (optional) ──────────────────────────────────────────────────────

  let cronReg: CronRegistration | null = null;
  function startCronIfEnabled(): void {
    if (gcSchedule === false) return;
    if (cronReg) return;
    try {
      const reg = defineCron({
        [`${table}:gc`]: {
          schedule: gcSchedule,
          run: async () => {
            await gcNow();
          },
        },
      });
      reg.start();
      cronReg = reg;
    } catch (err) {
      // Older Bun (< 1.3.12) lacks `Bun.cron`. Warn once — the caller
      // can still call `gcNow()` manually — then keep serving traffic.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Mandu Session SQLite] GC cron disabled: ${msg}. ` +
          `Sessions will still persist; call storage.gcNow() manually.`,
      );
    }
  }

  // Register cron after the first init completes so the scheduler's first
  // tick never races with table creation. We fire-and-forget the init —
  // any error surfaces on the next real query.
  void ensureInit().then(startCronIfEnabled);

  // ─── SessionStorage methods ───────────────────────────────────────────────

  async function getSession(cookies: CookieManager): Promise<Session> {
    if (closed) {
      throw new Error("[Mandu Session SQLite] storage is closed.");
    }
    await ensureInit();

    const raw = cookies.get(cookieName);
    const decoded = typeof raw === "string" ? safeDecode(raw) : null;
    const id = await verifySignedId(decoded ?? undefined, secrets);
    if (!id) return new Session();

    const now = Date.now();
    // Direct identifier interpolation is safe (table validated at
    // construction). The user-controlled `id` and `now` go through Bun.SQL
    // placeholder binding.
    const sql = `SELECT id, data, expires_at FROM ${table} WHERE id = $1 AND expires_at > $2 LIMIT 1`;
    const row = await queryOne<SessionRow>(db, sql, [id, now]);
    if (!row) return new Session();

    let parsed: SessionData;
    try {
      parsed = JSON.parse(row.data) as SessionData;
    } catch {
      // Corrupted row — treat as a missed session rather than throwing at
      // the end user. A later commit will overwrite it.
      return new Session();
    }
    return rehydrateSession(parsed, id);
  }

  async function commitSession(session: Session): Promise<string> {
    if (closed) {
      throw new Error("[Mandu Session SQLite] storage is closed.");
    }
    await ensureInit();

    // Clean + already-persisted sessions emit no Set-Cookie — matches the
    // "no-op when nothing changed" contract.
    if (!session.isDirty()) return "";

    // Always ensure the row has a stable id. Sessions loaded by
    // `getSession` keep their DB id; freshly-constructed sessions use
    // the UUID v7 generated in the `Session` constructor.
    const id = session.id;
    if (!id || typeof id !== "string") {
      throw new Error("[Mandu Session SQLite] session.id missing.");
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    const dataJson = JSON.stringify(session.toJSON());

    // INSERT OR REPLACE — last write wins, concurrent writes resolve
    // under WAL without corruption.
    const sql = `INSERT OR REPLACE INTO ${table} (id, data, expires_at) VALUES ($1, $2, $3)`;
    await execWithParams(db, sql, [id, dataJson, expiresAt]);

    // Cookie carries ONLY the signed id. Never the data.
    const signedValue = await signPayload(id, secrets[0]);
    return serializeSetCookie(cookieName, signedValue, cookieOpts);
  }

  async function destroySession(session: Session): Promise<string> {
    if (closed) {
      throw new Error("[Mandu Session SQLite] storage is closed.");
    }
    await ensureInit();

    const id = session.id;
    if (typeof id === "string" && id.length > 0) {
      const sql = `DELETE FROM ${table} WHERE id = $1`;
      await execWithParams(db, sql, [id]);
    }

    // Emit an expiring cookie so the browser drops its copy. Shape
    // matches `createCookieSessionStorage`.
    const parts = [`${cookieName}=`, `Path=${path}`, "Max-Age=0"];
    if (domain) parts.push(`Domain=${domain}`);
    if (httpOnly) parts.push("HttpOnly");
    if (secure) parts.push("Secure");
    if (sameSite) parts.push(`SameSite=${sameSite}`);
    return parts.join("; ");
  }

  async function gcNow(): Promise<number> {
    if (closed) {
      throw new Error("[Mandu Session SQLite] storage is closed.");
    }
    await ensureInit();

    const now = Date.now();
    // Count-then-delete inside a transaction so we return an accurate
    // number even when another writer races us. Under WAL this is cheap.
    // Identifier is interpolated (validated at construction); the time
    // parameter is bound.
    let deleted = 0;
    await db.transaction(async (tx) => {
      const countSql = `SELECT COUNT(*) AS n FROM ${table} WHERE expires_at <= $1`;
      const cnt = await queryOne<{ n: number | bigint }>(tx, countSql, [now]);
      deleted = cnt ? Number(cnt.n) : 0;
      const delSql = `DELETE FROM ${table} WHERE expires_at <= $1`;
      await execWithParams(tx, delSql, [now]);
    });
    return deleted;
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    if (cronReg) {
      try {
        await cronReg.stop();
      } catch {
        // Best-effort shutdown — don't mask the caller's shutdown flow.
      }
      cronReg = null;
    }
    await db.close();
  }

  return {
    getSession,
    commitSession,
    destroySession,
    gcNow,
    close,
  };
}

// ─── Signing ────────────────────────────────────────────────────────────────

/**
 * Sign a session id with the primary secret. The cookie value carries
 * `encodeURIComponent(id) + "." + <sig>`, matching the shape produced by
 * `CookieManager.setSigned` so `CookieManager.getSigned` could consume it
 * symmetrically in a pinch.
 */
async function signPayload(id: string, secret: string): Promise<string> {
  const encoded = encodeURIComponent(id);
  const sig = await hmacSign(encoded, secret);
  return `${encoded}.${sig}`;
}

/**
 * URL-decode a cookie value, returning `null` on malformed input. We
 * never throw on untrusted cookie data.
 */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Rebuild a {@link Session} from its persisted JSON blob while preserving
 * the supplied `id`.
 *
 * `Session.fromJSON` mints a fresh UUID for the rebuilt instance —
 * correct for cookie storage (the id lives on the cookie itself) but
 * wrong for SQLite where the row's primary key must stay stable across
 * requests. We go through the public constructor with `(data, id)` and
 * then replay flash keys so `session.get(k)` returns the flash on first
 * read, empty on subsequent reads — same contract as `fromJSON`.
 *
 * The replay needs write access to the private `flash` map and to the
 * `_dirty` flag; we reuse the same narrow-interface cast the cookie
 * codepath uses internally.
 */
function rehydrateSession(data: SessionData, id: string): Session {
  const session = new Session({}, id);
  const flashKeys: string[] = [];

  // Narrow structural view of the private fields we need to populate.
  // Session's public API does not expose a "load raw JSON with id" entry,
  // so we reach in carefully — the shape matches session.ts:42-53.
  const internal = session as unknown as {
    data: SessionData;
    flash: Map<string, unknown>;
    _dirty: boolean;
  };

  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith("__flash_")) {
      const realKey = key.slice(8);
      internal.flash.set(realKey, value);
      flashKeys.push(key);
    } else {
      internal.data[key] = value;
    }
  }
  for (const key of flashKeys) {
    delete internal.data[key];
  }
  // Just-loaded state is clean by definition.
  internal._dirty = false;
  return session;
}

// ─── DB helpers ─────────────────────────────────────────────────────────────
//
// `@mandujs/core/db` exposes a tagged-template API. Our DDL/DML strings
// are dynamic (they interpolate the table name, which SQLite doesn't
// bind), so we construct the TemplateStringsArray ourselves via the
// pattern used by Bun.SQL: split the string at `$1`, `$2`, … markers and
// forward values in positional order.

/** Run a SQL string with positional `$N` placeholders. No result rows consumed. */
async function execWithParams(
  dbOrTx: Db,
  sql: string,
  params: unknown[],
): Promise<void> {
  const parts = splitPlaceholders(sql, params.length);
  const strings = Object.assign(parts.slice(), { raw: parts.slice() }) as unknown as TemplateStringsArray;
  await dbOrTx(strings, ...params);
}

/** Run a SQL string and return at most one row, or `null`. */
async function queryOne<T extends Record<string, unknown>>(
  dbOrTx: Db,
  sql: string,
  params: unknown[],
): Promise<T | null> {
  const parts = splitPlaceholders(sql, params.length);
  const strings = Object.assign(parts.slice(), { raw: parts.slice() }) as unknown as TemplateStringsArray;
  const rows = await dbOrTx<T>(strings, ...params);
  if (!rows || rows.length === 0) return null;
  return rows[0] as T;
}

/** Run a parameter-less DDL/DML statement. */
async function execRaw(dbOrTx: Db, sql: string): Promise<void> {
  const strings = Object.assign([sql], { raw: [sql] }) as unknown as TemplateStringsArray;
  await dbOrTx(strings);
}

/**
 * Split a SQL string with `$1`, `$2`, … markers into the string segments
 * that bracket each placeholder. The resulting array has
 * `placeholderCount + 1` entries — matches the shape of a
 * `TemplateStringsArray` produced by literal interpolation.
 *
 * Throws when the detected placeholder count does not match the expected
 * count — a diagnostic for mismatched SQL + params pairs.
 */
function splitPlaceholders(sql: string, expected: number): string[] {
  const parts: string[] = [];
  let rest = sql;
  for (let i = 1; i <= expected; i++) {
    const marker = `$${i}`;
    const idx = rest.indexOf(marker);
    if (idx === -1) {
      throw new Error(
        `[Mandu Session SQLite] placeholder ${marker} missing in SQL: ${sql}`,
      );
    }
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx + marker.length);
  }
  parts.push(rest);
  return parts;
}

