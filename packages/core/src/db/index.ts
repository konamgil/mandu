/**
 * @mandujs/core/db
 *
 * Thin, production-grade wrapper around **native `Bun.SQL`** (Bun 1.3.x).
 * Provides a callable tagged-template handle with `.one()`, `.transaction()`,
 * and `.close()` affordances while preserving Bun.sql's parameter-safe
 * placeholder semantics end-to-end.
 *
 * ## Providers
 *
 * - `postgres://…` / `postgresql://…` → Postgres
 * - `mysql://…` → MySQL
 * - `sqlite::memory:` / `sqlite:./file.db` / `sqlite://./file.db` → SQLite
 *
 * The `provider` config key overrides URL-based detection when the scheme
 * is ambiguous. No other DB engines are supported — Bun.SQL itself accepts
 * `postgres`, `sqlite`, `mysql`, and `mariadb` (aliased to mysql here).
 *
 * ## Why a wrapper
 *
 * Bun.SQL is already excellent. What this module adds:
 *
 *   1. **Provider detection** — consistent scheme parsing; consumers read
 *      `db.provider` instead of sniffing `Bun.SQL.options` themselves.
 *   2. **`.one()` helper** — zero-or-one-row query with clear errors for
 *      unexpected multi-row results. (Bun.SQL's raw `[0]` access silently
 *      drops extra rows.)
 *   3. **Typed transactions** — `tx` inside `transaction(fn)` is the same
 *      `Db` shape as the outer handle (Bun.SQL's `begin()` returns a
 *      callable without `.one` / `.transaction` / `.close`).
 *   4. **Lazy runtime probe** — `createDb()` never throws when Bun.SQL is
 *      unavailable; the first query does, with a version-specific message.
 *
 * ## Parameter binding
 *
 * Placeholders are passed through Bun.SQL's native parameter binding —
 * never string-concatenated into the SQL text. Example:
 *
 * ```ts
 * const user = await db.one<User>`SELECT * FROM users WHERE name = ${name}`;
 * ```
 *
 * The `${name}` is routed as a bound parameter even if it contains `'`,
 * `--`, or other SQL metacharacters. There is no safe "unsafe interpolate"
 * escape hatch on the public surface — use Bun.SQL directly if you need
 * `sql.unsafe()` semantics.
 *
 * ## Dynamic queries
 *
 * For runtime-variable filters (optional `WHERE` conditions, sort direction,
 * pagination) compose {@link SqlFragment}s with `db.sql` and `db.join`
 * instead of branching whole queries or hand-synthesising a
 * `TemplateStringsArray`. Fragments are inert until embedded in an executing
 * call, at which point their static text inlines and their values stay bound:
 *
 * ```ts
 * const conds = [];
 * if (party)  conds.push(db.sql`party = ${party}`);
 * if (search) conds.push(db.sql`title ILIKE ${"%" + search + "%"}`);
 * const where = conds.length ? db.sql`WHERE ${db.join(conds, " AND ")}` : db.sql``;
 * const rows = await db`SELECT * FROM pledges ${where} LIMIT ${limit}`;
 * ```
 *
 * @example
 * ```ts
 * import { createDb } from "@mandujs/core/compat/db/index";
 *
 * const db = createDb({ url: "postgres://user:pass@localhost/app" });
 *
 * await db`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT)`;
 * await db`INSERT INTO users (name) VALUES (${"alice"})`;
 *
 * const one = await db.one<{ id: number; name: string }>`
 *   SELECT id, name FROM users WHERE name = ${"alice"}
 * `;
 *
 * await db.transaction(async (tx) => {
 *   await tx`INSERT INTO users (name) VALUES (${"bob"})`;
 *   await tx`INSERT INTO users (name) VALUES (${"carol"})`;
 * });
 *
 * await db.close();
 * ```
 *
 * @module db
 */

// ─── Public types ───────────────────────────────────────────────────────────

/** A single query result row. */
export type Row = Record<string, unknown>;

/** The three providers this wrapper supports. */
export type SqlProvider = "postgres" | "mysql" | "sqlite";

/** Configuration for {@link createDb}. */
export interface DbConfig {
  /**
   * Connection URL.
   *
   * - `sqlite::memory:` — in-memory SQLite
   * - `sqlite:./data.db` / `sqlite://./data.db` — file-backed SQLite
   * - `postgres://user:pass@host:5432/db` (or `postgresql://…`)
   * - `mysql://user:pass@host:3306/db`
   */
  url: string;
  /**
   * Override provider detection. Useful when embedding a non-standard URL
   * scheme (e.g., a secrets manager placeholder the user rewrites at boot).
   * When set, wins over URL-scheme sniffing.
   */
  provider?: SqlProvider;
  /**
   * Max concurrent connections. Default: `10` for Postgres/MySQL, `1` for
   * SQLite (SQLite is serialised by the engine; more than one connection
   * just queues inside Bun).
   */
  max?: number;
  /**
   * Additional options forwarded to the `Bun.SQL` constructor. Escape hatch
   * for advanced configuration — `ssl`, `idleTimeout`, `tls`, `bigint`, etc.
   *
   * The keys `url`, `adapter`, and `max` from this object are ignored to
   * keep public surface authoritative.
   */
  options?: Record<string, unknown>;
}

/**
 * A database handle. Invoking it as a **tagged template** runs a query and
 * returns the full result array. The attached methods support one-shot
 * reads, transactions, and shutdown.
 */
export interface Db {
  /**
   * Tagged-template query. Values are bound as parameters, never
   * interpolated as SQL text.
   */
  <T extends Row = Row>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;

  /** Detected provider (`"postgres"`, `"mysql"`, or `"sqlite"`). */
  readonly provider: SqlProvider;

  /**
   * Runs the query and returns at most one row.
   *
   * - `0` rows → resolves to `null`
   * - `1` row  → resolves to that row
   * - `>= 2` rows → rejects with an Error naming the actual count
   *
   * Use when the query is expected to match at most one record (lookup by
   * unique key, `LIMIT 1`, etc.).
   */
  one<T extends Row = Row>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T | null>;

  /**
   * Runs `fn` inside a transaction. Commits if `fn` resolves; rolls back
   * if it throws (and re-throws the original error).
   *
   * Nested transactions are NOT supported — call `transaction` from within
   * another `transaction` and you'll get an error surfaced by Bun.SQL
   * ("cannot call begin inside a transaction use savepoint() instead").
   * Use savepoints via raw Bun.SQL if you need nesting.
   */
  transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R>;

  /**
   * Closes the connection pool. Subsequent queries reject with a clear
   * "pool closed" error. Calling `close()` twice is a no-op (idempotent).
   */
  close(options?: DbCloseOptions): Promise<void>;

  /**
   * Builds a composable, not-yet-executed SQL {@link SqlFragment}. Embed it
   * inside another `db`/`db.one` tagged-template call to assemble dynamic
   * queries (optional filters, conditional `WHERE`, sort direction) while
   * keeping every interpolated value a bound parameter.
   *
   * Static text in the fragment template is merged into the surrounding SQL;
   * `${value}` placeholders stay bound — never string-interpolated.
   *
   * @example
   * ```ts
   * const conds = [];
   * if (party)  conds.push(db.sql`party = ${party}`);
   * if (region) conds.push(db.sql`region = ${region}`);
   * const where = conds.length ? db.sql`WHERE ${db.join(conds, " AND ")}` : db.sql``;
   * const rows = await db`SELECT * FROM pledges ${where} ORDER BY created_at DESC`;
   * ```
   */
  sql(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment;

  /**
   * Joins fragments with a separator into a single {@link SqlFragment}.
   * Empty list → an empty fragment. The separator is static text (default
   * `", "`); pass a fragment if you need a bound value inside it.
   */
  join(
    fragments: readonly SqlFragment[],
    separator?: SqlFragment | string,
  ): SqlFragment;
}

/** Options forwarded to Bun.SQL pool shutdown. */
export interface DbCloseOptions {
  /**
   * Maximum seconds to wait for in-flight queries before closing the pool.
   * `0` asks Bun.SQL to close immediately.
   */
  timeout?: number;
}

// ─── Composable SQL fragments (dynamic WHERE / filters) ─────────────────────

const SQL_FRAGMENT_MARKER = "__manduSqlFragment";

/**
 * A composable, not-yet-executed SQL fragment produced by {@link sql} (or
 * `db.sql`). Holds the static template `strings` and the interpolated
 * `values` (which may themselves be nested fragments). Flattened into the
 * surrounding query at execution time so values stay bound parameters.
 */
export interface SqlFragment {
  readonly [SQL_FRAGMENT_MARKER]: true;
  readonly strings: readonly string[];
  readonly values: readonly unknown[];
}

/** Structural check for a {@link SqlFragment}. */
export function isSqlFragment(value: unknown): value is SqlFragment {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[SQL_FRAGMENT_MARKER] === true
  );
}

/**
 * Tagged-template builder for a {@link SqlFragment}. Also exposed as
 * `db.sql`. The fragment is inert until embedded in an executing
 * `db`/`db.one` call.
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SqlFragment {
  return { [SQL_FRAGMENT_MARKER]: true, strings: Array.from(strings), values };
}

/** A fragment carrying only static text and no bound values. */
function staticFragment(text: string): SqlFragment {
  return { [SQL_FRAGMENT_MARKER]: true, strings: [text], values: [] };
}

/**
 * Joins fragments with a separator. Also exposed as `db.join`. An empty list
 * yields an empty fragment; a single-element list returns that element.
 */
export function join(
  fragments: readonly SqlFragment[],
  separator: SqlFragment | string = ", ",
): SqlFragment {
  if (fragments.length === 0) return staticFragment("");
  if (fragments.length === 1) return fragments[0]!;
  const sep = typeof separator === "string" ? staticFragment(separator) : separator;
  const values: unknown[] = [];
  for (let i = 0; i < fragments.length; i++) {
    if (i > 0) values.push(sep);
    values.push(fragments[i]);
  }
  return {
    [SQL_FRAGMENT_MARKER]: true,
    strings: new Array<string>(values.length + 1).fill(""),
    values,
  };
}

interface FlatSql {
  parts: string[];
  binds: unknown[];
}

/**
 * Recursively flattens a (possibly fragment-bearing) template into a single
 * `{ parts, binds }` pair. Static text from nested fragments is merged into
 * `parts`; every non-fragment value becomes one bound parameter in `binds`.
 * Invariant: `parts.length === binds.length + 1`.
 */
function flattenSqlTemplate(
  strings: readonly string[],
  values: readonly unknown[],
): FlatSql {
  const parts: string[] = [strings[0] ?? ""];
  const binds: unknown[] = [];

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const tail = strings[i + 1] ?? "";

    if (isSqlFragment(value)) {
      const inner = flattenSqlTemplate(value.strings, value.values);
      parts[parts.length - 1] += inner.parts[0] ?? "";
      for (let j = 0; j < inner.binds.length; j++) {
        binds.push(inner.binds[j]);
        parts.push(inner.parts[j + 1] ?? "");
      }
      parts[parts.length - 1] += tail;
    } else {
      binds.push(value);
      parts.push(tail);
    }
  }

  return { parts, binds };
}

/** True when any value needs fragment flattening before reaching Bun.SQL. */
function hasSqlFragment(values: readonly unknown[]): boolean {
  for (const value of values) {
    if (isSqlFragment(value)) return true;
  }
  return false;
}

/**
 * Rebuilds a synthetic `TemplateStringsArray` from flattened parts so the
 * merged query can be handed back to Bun.SQL's tagged-template entry point.
 * `raw` mirrors the cooked strings — we never expose a raw-interpolation path.
 */
function toTemplateStringsArray(parts: readonly string[]): TemplateStringsArray {
  const arr = parts.slice();
  return Object.assign(arr, { raw: parts.slice() }) as unknown as TemplateStringsArray;
}

// ─── Bun runtime surface (structural; no `any`) ─────────────────────────────

/** Shape of the options object Bun.SQL accepts. */
interface BunSqlOptions {
  url?: string;
  adapter?: string;
  max?: number;
  filename?: string;
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  [key: string]: unknown;
}

/**
 * A Bun.SQL instance — itself a callable tagged-template function with
 * methods attached. We only model the subset we actually use.
 */
interface BunSqlInstance {
  <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<
    T[] & { count?: number; command?: string }
  >;
  begin<R>(fn: (tx: BunSqlInstance) => Promise<R>): Promise<R>;
  close(options?: DbCloseOptions): Promise<void>;
  readonly options?: BunSqlOptions;
}

/**
 * Constructor surface — `Bun.SQL` is a class; we only need the `new`
 * signature. Accepts either a URL string or a full options object.
 */
export type BunSqlCtor = new (
  urlOrOptions: string | BunSqlOptions,
) => BunSqlInstance;

// ─── Provider detection ─────────────────────────────────────────────────────

/**
 * Derives a {@link SqlProvider} from a connection URL. Throws a clear
 * error for unsupported / ambiguous schemes so the call site fails early
 * instead of passing a half-formed config to Bun.SQL.
 */
export function detectProvider(url: string): SqlProvider {
  // Matches `sqlite::memory:`, `sqlite://path`, `sqlite:./file` — any
  // "starts with sqlite:" variant. We intentionally accept the no-slash
  // form because it's what Bun.SQL documents as canonical.
  if (url.startsWith("sqlite:")) return "sqlite";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return "postgres";
  }
  if (url.startsWith("mysql://") || url.startsWith("mariadb://")) {
    return "mysql";
  }
  throw new Error(
    `[@mandujs/core/db] Unable to detect provider from url: ${JSON.stringify(
      url,
    )}. Supported schemes: postgres://, postgresql://, mysql://, mariadb://, sqlite:. ` +
      `Pass { provider: "postgres" | "mysql" | "sqlite" } to override.`,
  );
}

/** Maps our {@link SqlProvider} to the adapter name Bun.SQL expects. */
function providerToAdapter(p: SqlProvider): string {
  // Bun.SQL uses "postgres" / "sqlite" / "mysql" verbatim; no mapping fuzz.
  return p;
}

/** Default `max` connections per provider. SQLite serialises at the engine. */
function defaultMax(p: SqlProvider): number {
  return p === "sqlite" ? 1 : 10;
}

// ─── Bun runtime probe ──────────────────────────────────────────────────────

function getBunSqlCtor(): BunSqlCtor {
  const g = globalThis as unknown as { Bun?: { SQL?: BunSqlCtor } };
  if (!g.Bun || typeof g.Bun.SQL !== "function") {
    throw new Error(
      "[@mandujs/core/db] Bun.sql is unavailable — this module requires Bun runtime >= 1.3.x. " +
        "Install/upgrade Bun: https://bun.com/docs/installation",
    );
  }
  return g.Bun.SQL;
}

// ─── Error helpers ──────────────────────────────────────────────────────────

const POOL_CLOSED_MESSAGE =
  "[@mandujs/core/db] pool closed — query issued after Db.close().";

const PIN_DB_HANDLE = Symbol.for("@mandujs/core/compat/db/pin-handle");

interface DbHandlePin {
  [PIN_DB_HANDLE]?: <R>(fn: () => Promise<R>) => Promise<R>;
}

/**
 * Internal helper for code paths that must keep a MySQL session alive across
 * transaction boundaries, such as named advisory locks. Public Db callers do
 * not need this; normal MySQL transactions recycle the handle afterwards.
 *
 * @internal
 */
export async function withPinnedDbHandle<R>(
  db: Db,
  fn: () => Promise<R>,
): Promise<R> {
  const pin = (db as DbHandlePin)[PIN_DB_HANDLE];
  if (!pin) return await fn();
  return await pin(fn);
}

/**
 * Structural check for "connection/pool closed" errors that Bun.SQL raises
 * after `.close()`. Bun surfaces these as `SQLiteError` / `PostgresError` /
 * `MySQLError` with a `code` ending in `CLOSED`.
 */
function isPoolClosedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === "string" && e.code.includes("CLOSED")) return true;
  if (
    typeof e.message === "string" &&
    /(connection|pool)\s+closed/i.test(e.message)
  ) {
    return true;
  }
  return false;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Internal factory accepting an injectable `Bun.SQL` constructor — used by
 * unit tests to swap in a fake implementation. Production callers use
 * {@link createDb}, which binds this to `Bun.SQL`.
 *
 * @internal
 */
export function _createDbWith(Ctor: BunSqlCtor, config: DbConfig): Db {
  if (!config || typeof config.url !== "string" || config.url.length === 0) {
    throw new TypeError(
      "[@mandujs/core/db] createDb: 'url' is required and must be a non-empty string.",
    );
  }

  const provider: SqlProvider = config.provider ?? detectProvider(config.url);
  const max = config.max ?? defaultMax(provider);

  // Compose Bun.SQL options. The user-supplied `options` bag is merged
  // FIRST so our authoritative fields win.
  //
  // Why per-provider options: when Bun.SQL receives an options OBJECT with
  // a `url` property, it does NOT parse the URL into connection fields —
  // it treats it as metadata and defaults to `:memory:` for SQLite (and
  // localhost/5432 for Postgres). To make URL-based config actually work
  // through an options object, we translate ourselves.
  //
  //   - SQLite: pull the path out of `sqlite:` / `sqlite://` into `filename`.
  //   - Postgres / MySQL: parse the URL into hostname / port / credentials /
  //     database — Bun accepts these fields directly and applies its own
  //     defaulting logic on top.
  const composed: BunSqlOptions = {
    ...(config.options ?? {}),
    adapter: providerToAdapter(provider),
    max,
  };
  applyUrlToOptions(composed, provider, config.url);

  const bunSql = new Ctor(composed);
  return buildDbHandle(bunSql, provider);
}

/**
 * Translates a connection URL into provider-specific `Bun.SQL` options.
 * Mutates `opts` in place (the caller already has a fresh object).
 *
 * @internal
 */
function applyUrlToOptions(
  opts: BunSqlOptions,
  provider: SqlProvider,
  url: string,
): void {
  if (provider === "sqlite") {
    // Accept "sqlite::memory:", "sqlite:<path>", and "sqlite://<path>".
    // The first is a special in-memory marker; everything after the scheme
    // is the filename.
    const rest = stripScheme(url);
    opts.filename = rest === ":memory:" ? ":memory:" : rest;
    return;
  }
  // Postgres / MySQL: delegate to Bun by passing the URL string directly as
  // an extra field. Bun's constructor accepts `url` AND parses it when no
  // `hostname` is provided alongside — verified in 1.3.12. We also keep the
  // original URL on the options so advanced logging can read it back.
  opts.url = url;
}

/**
 * Strips the leading `scheme:` (or `scheme://`) from a URL. Returns the
 * portion Bun uses as the connection target — for SQLite that's the file
 * path, for Postgres that's `user:pass@host:port/db`.
 */
function stripScheme(url: string): string {
  // `sqlite::memory:` → `:memory:`
  // `sqlite://./data.db` → `./data.db`
  // `sqlite:./data.db` → `./data.db`
  // `sqlite://C:\path\to\db` → `C:\path\to\db`
  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:(\/\/)?/.exec(url);
  if (!schemeMatch) return url;
  return url.slice(schemeMatch[0].length);
}

/**
 * Wraps a Bun.SQL instance (top-level or transaction-scoped) with the
 * public `Db` shape. Shared by `_createDbWith` and `transaction()`.
 */
function buildDbHandle(bunSql: BunSqlInstance, provider: SqlProvider): Db {
  // Closed flag tracked per-handle. A transaction-scoped handle inherits
  // the outer pool's close state transitively (Bun.SQL errors itself), but
  // we also short-circuit here so we can return the canonical message.
  let closed = false;

  // Callable core: forward the tagged-template call straight to Bun.SQL,
  // but translate post-close failures into our uniform error.
  async function call<T extends Row = Row>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> {
    if (closed) {
      throw new Error(POOL_CLOSED_MESSAGE);
    }
    // Flatten any composable fragments into a single merged template so
    // their static text inlines and their values stay bound parameters.
    let tsa: TemplateStringsArray = strings;
    let binds: unknown[] = values;
    if (hasSqlFragment(values)) {
      const flat = flattenSqlTemplate(strings, values);
      tsa = toTemplateStringsArray(flat.parts);
      binds = flat.binds;
    }
    try {
      // `bunSql` is itself a tagged-template callable; pass through verbatim.
      const result = await bunSql<T>(tsa, ...binds);
      // Bun.SQL returns an array-like with metadata props (count/command/…).
      // Coerce to a plain array so consumers don't accidentally couple to
      // those fields through this wrapper's public surface.
      return Array.from(result) as T[];
    } catch (err) {
      if (isPoolClosedError(err)) {
        throw new Error(POOL_CLOSED_MESSAGE, { cause: err });
      }
      throw err;
    }
  }

  // Function.prototype trick: make `call` itself the Db object by attaching
  // the methods. This preserves the tagged-template call signature while
  // satisfying the attached-methods part of the interface.
  const db = call as unknown as Db;

  Object.defineProperty(db, "provider", {
    value: provider,
    enumerable: true,
    writable: false,
    configurable: false,
  });

  (db as { one: Db["one"] }).one = async function one<T extends Row = Row>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T | null> {
    const rows = await call<T>(strings, ...values);
    if (rows.length === 0) return null;
    if (rows.length === 1) return rows[0] as T;
    throw new Error(
      `[@mandujs/core/db] one(): expected 0 or 1 row, got ${rows.length}.`,
    );
  };

  (db as { transaction: Db["transaction"] }).transaction =
    async function transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R> {
      if (closed) {
        throw new Error(POOL_CLOSED_MESSAGE);
      }
      // Delegate to Bun.SQL's native begin(). The inner `tx` is a Bun.SQL
      // handle bound to the active transaction; we wrap it with the same
      // Db shape so user callbacks get a consistent API.
      return await bunSql.begin(async (innerBunSql) => {
        const innerDb = buildDbHandle(innerBunSql, provider);
        return await fn(innerDb);
      });
    };

  (db as { close: Db["close"] }).close = async function close(
    options?: DbCloseOptions,
  ): Promise<void> {
    if (closed) return; // idempotent
    closed = true;
    try {
      await bunSql.close(options);
    } catch (err) {
      // Bun.SQL can throw if already-closed under the hood (mostly from a
      // racing concurrent close). We already flipped our flag so subsequent
      // queries reject cleanly — swallow this one.
      if (isPoolClosedError(err)) return;
      throw err;
    }
  };

  (db as { sql: Db["sql"] }).sql = sql;
  (db as { join: Db["join"] }).join = join;

  return db;
}

/**
 * Creates a {@link Db} handle backed by `Bun.SQL`. The Bun runtime probe
 * is lazy — `createDb(...)` itself does not throw when Bun.SQL is missing;
 * the first query (or `.close()`) does.
 *
 * @throws {TypeError} when `config.url` is missing or empty.
 */
export function createDb(config: DbConfig): Db {
  // Up-front config validation. We check `url` here (not only in
  // `_createDbWith`) so the error fires at construction time — matches
  // the TypeError contract the public API documents.
  if (!config || typeof config.url !== "string" || config.url.length === 0) {
    throw new TypeError(
      "[@mandujs/core/db] createDb: 'url' is required and must be a non-empty string.",
    );
  }

  // Lazy probe: we defer the `Bun.SQL` lookup to first query by capturing
  // a thunk here. In practice, Bun.SQL's constructor itself is cheap and
  // doesn't open a connection (only `connect()` / first query do), so
  // constructing the ctor-facing shape up-front would be fine — but we
  // honor the precedent set by scheduler/storage.s3: the runtime error
  // fires on the first real call, with a version-specific message.
  //
  // We still need to *return* a Db now, so call through a forwarding
  // function that probes on demand.
  let real: Db | null = null;
  let closed = false;
  let pinDepth = 0;
  let pendingMysqlRecycle = false;
  function materialize(): Db {
    if (closed) {
      throw new Error(POOL_CLOSED_MESSAGE);
    }
    if (real) return real;
    real = _createDbWith(getBunSqlCtor(), config);
    return real;
  }

  async function flushPendingMysqlRecycle(): Promise<void> {
    if (provider !== "mysql" || pinDepth > 0 || !pendingMysqlRecycle) return;
    pendingMysqlRecycle = false;
    if (closed || !real) return;
    const db = real;
    real = null;
    await db.close({ timeout: 0 });
  }

  async function recycleMysqlHandle(db: Db): Promise<void> {
    if (provider !== "mysql" || real !== db || closed) return;
    if (pinDepth > 0) {
      pendingMysqlRecycle = true;
      return;
    }
    real = null;
    await db.close({ timeout: 0 });
  }

  const forward = async function forwardCall<T extends Row = Row>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> {
    return await materialize()<T>(strings, ...values);
  } as unknown as Db;

  const provider: SqlProvider = config.provider ?? detectProvider(config.url);
  Object.defineProperty(forward, "provider", {
    value: provider,
    enumerable: true,
    writable: false,
    configurable: false,
  });

  (forward as { one: Db["one"] }).one = async function one<T extends Row = Row>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T | null> {
    return await materialize().one<T>(strings, ...values);
  };
  (forward as { transaction: Db["transaction"] }).transaction =
    async function transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R> {
      const hadMaterializedHandle = real !== null;
      let db = materialize();
      if (provider === "mysql" && hadMaterializedHandle) {
        await recycleMysqlHandle(db);
        db = materialize();
      }
      try {
        return await db.transaction(fn);
      } finally {
        await recycleMysqlHandle(db);
      }
    };
  (forward as { close: Db["close"] }).close = async function close(
    options?: DbCloseOptions,
  ): Promise<void> {
    if (closed) return;
    closed = true;
    // If no query ever ran, materialize() was never called — nothing to close.
    if (!real) return;
    const db = real;
    real = null;
    await db.close(options);
  };
  (forward as { sql: Db["sql"] }).sql = sql;
  (forward as { join: Db["join"] }).join = join;
  Object.defineProperty(forward, PIN_DB_HANDLE, {
    value: async function withPinnedHandle<R>(fn: () => Promise<R>): Promise<R> {
      pinDepth += 1;
      try {
        return await fn();
      } finally {
        pinDepth -= 1;
        await flushPendingMysqlRecycle();
      }
    },
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return forward;
}
