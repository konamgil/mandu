/**
 * @mandujs/core/auth/tokens — internal token store for email verification
 * and password reset flows (Phase 5.3).
 *
 * Tokens are single-use, expiring, and persisted in SQLite. Only a **hash**
 * of the random nonce is stored — the plaintext nonce never touches disk.
 * A leaked row therefore does NOT reveal a token that can be replayed
 * against our `consume()` verifier (the hash is keyed by a secret the
 * caller supplies).
 *
 * ## Wire format
 *
 * `id.nonce` where:
 *   - `id`    — UUIDv7 (row primary key, scan-friendly)
 *   - `nonce` — 32 random bytes, base64url encoded (~43 chars). Never stored
 *     plaintext; the row carries `sha256(nonce || "|" || purpose || "|" || secret)`
 *     in hex.
 *
 * Base64url is already URL-safe. We still wrap the emitted token in
 * `encodeURIComponent` at the template-render layer (verification.ts /
 * reset.ts) so a future nonce charset change can't silently break link
 * parsing downstream.
 *
 * ## Atomicity
 *
 * `consume()` runs inside a transaction:
 *   1. `SELECT … WHERE id = $1` — load the row under tx
 *   2. Validate purpose / expiry / not-yet-consumed / hash match (constant-time)
 *   3. `UPDATE … SET consumed_at = $now WHERE id = $1 AND consumed_at IS NULL`
 *      — the predicate prevents a second concurrent consumer from re-marking
 *   4. Row is only returned to the caller when the UPDATE changed one row
 *
 * Under SQLite WAL with a single writer serialised by the engine, concurrent
 * `consume()` calls on the same token race into the transaction — the second
 * transaction observes `consumed_at IS NOT NULL` and returns null.
 *
 * ## Appendix D compliance
 *
 * - **D.4 WAL**: `PRAGMA journal_mode = WAL` at init, same pattern as
 *   `filling/session-sqlite.ts`.
 * - **D.5 createDb routing**: all DB access goes through `@mandujs/core/db`;
 *   we never touch `Bun.SQL` directly.
 *
 * @module auth/tokens
 * @internal — Not re-exported from `@mandujs/core/auth`. verification.ts and
 * reset.ts are the public surface; this module is their shared plumbing.
 */

import { createDb, type Db } from "../db/index.js";
import { newId } from "../id/index.js";
import { defineCron, type CronRegistration } from "../scheduler/index.js";

// ─── Public types ───────────────────────────────────────────────────────────

/** What the token can be consumed for. New purposes require a schema review. */
export type TokenPurpose = "verify-email" | "reset-password";

/**
 * Persisted token record. `tokenHash` is the only identifier-like field that
 * is safe to log — it is not the plaintext nonce.
 */
export interface TokenRecord {
  /** UUIDv7 — row primary key, also the first half of the emitted token. */
  id: string;
  userId: string;
  purpose: TokenPurpose;
  /** `sha256(nonce || "|" || purpose || "|" || secret)`, hex-encoded. */
  tokenHash: string;
  /**
   * Purpose-specific sidecar data. For "verify-email" we persist the email
   * being verified; reset tokens typically carry `undefined`.
   *
   * Serialised as JSON in the DB. `null` and `undefined` round-trip as `undefined`.
   */
  meta?: Record<string, string>;
  /** Unix ms, absolute — compared to `Date.now()` at consume time. */
  expiresAt: number;
  /** Unix ms when `consume()` marked the row used; `null` while still live. */
  consumedAt: number | null;
}

/** Stored-store contract consumed by verification.ts and reset.ts. */
export interface AuthTokenStore {
  /**
   * Mint a new token. Inserts a row, returns the plaintext `id.nonce` pair
   * (wire format) plus the record (minus the nonce — {@link TokenRecord.tokenHash}
   * is what was persisted).
   */
  mint(
    purpose: TokenPurpose,
    userId: string,
    meta?: Record<string, string>,
  ): Promise<{ token: string; record: TokenRecord }>;
  /**
   * Atomically validate and consume a token. Returns the record on success.
   * Returns `null` when the token is malformed, unknown, expired, already
   * consumed, wrong-purpose, or the hash fails to verify. **Never throws**
   * on user-supplied values.
   */
  consume(purpose: TokenPurpose, token: string): Promise<TokenRecord | null>;
  /** Delete expired + already-consumed rows. Returns the deleted count. */
  gcNow(): Promise<number>;
  /** Stop the GC cron (if started) and close the SQLite pool. */
  close(): Promise<void>;
}

/** Construction options for {@link createAuthTokenStore}. */
export interface AuthTokenStoreOptions {
  /**
   * HMAC-style keyed SHA-256 secret. The secret is NOT a true HMAC key (we
   * mix it into a hashed suffix rather than using HMAC construction) — the
   * effect is equivalent for our threat model: an attacker who dumps the
   * DB cannot forge a token without also knowing the secret. Recommended
   * length: ≥ 32 bytes of entropy.
   */
  secret: string;
  /** SQLite path. Default: `.mandu/auth-tokens.db`. */
  dbPath?: string;
  /** Table name. Must match `[A-Za-z_][A-Za-z0-9_]*`. Default: `mandu_auth_tokens`. */
  table?: string;
  /**
   * Per-purpose TTL in seconds. Missing purposes fall back to the built-in
   * default. Built-ins: verify-email=24h, reset-password=1h.
   */
  ttlSecondsByPurpose?: Partial<Record<TokenPurpose, number>>;
  /**
   * Cron schedule for expired/consumed sweep. Default: `"0 * * * *"` (hourly).
   * Set `false` to disable — callers can still invoke `gcNow()`.
   */
  gcSchedule?: string | false;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_DB_PATH = ".mandu/auth-tokens.db";
const DEFAULT_TABLE = "mandu_auth_tokens";
const DEFAULT_GC_SCHEDULE = "0 * * * *";

/** 24 hours in seconds — verification links are long-lived. */
const DEFAULT_TTL_VERIFY_EMAIL = 60 * 60 * 24;
/** 1 hour in seconds — reset links are short-lived to narrow the leak window. */
const DEFAULT_TTL_RESET_PASSWORD = 60 * 60;

const SAFE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 32 bytes of entropy — comfortably above birthday-collision bounds. */
const NONCE_BYTES = 32;

// ─── Crypto helpers ─────────────────────────────────────────────────────────

/**
 * Encode bytes as base64url (no padding). URL-safe and shell-safe.
 *
 * `btoa` is our binary-to-base64 primitive; we then translate the +/= alphabet
 * to the URL-safe variant. We avoid `Buffer.from(...).toString("base64url")`
 * so the module stays runtime-portable.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Shape of the small subset of `Bun.CryptoHasher` we consume. */
interface CryptoHasherLike {
  update(input: string | ArrayBufferView | ArrayBuffer): CryptoHasherLike;
  digest(encoding: "hex"): string;
}
interface CryptoHasherCtor {
  new (algorithm: "sha256"): CryptoHasherLike;
}

/**
 * Resolve `Bun.CryptoHasher` at call time. Falls back to the Web Crypto
 * `subtle.digest` path (async) if Bun isn't present — but the sync fallback
 * below throws and documents the requirement.
 */
function getCryptoHasher(): CryptoHasherCtor {
  const g = globalThis as unknown as { Bun?: { CryptoHasher?: CryptoHasherCtor } };
  if (!g.Bun || typeof g.Bun.CryptoHasher !== "function") {
    throw new Error(
      "[@mandujs/core/auth/tokens] Bun.CryptoHasher is unavailable — this module requires the Bun runtime (>= 1.3).",
    );
  }
  return g.Bun.CryptoHasher;
}

/**
 * Hash `nonce` under `purpose` + `secret`. The composition
 * `sha256(nonce + "|" + purpose + "|" + secret)` binds the hash to both a
 * purpose (so a `verify-email` token cannot be replayed into the reset flow)
 * and the server's secret (so a leaked row alone cannot be used to forge).
 *
 * Pipes are deliberate separators — they cannot appear inside base64url
 * nonces, so there is no concatenation ambiguity.
 */
function hashNonce(nonce: string, purpose: TokenPurpose, secret: string): string {
  const hasher = new (getCryptoHasher())("sha256");
  hasher.update(nonce);
  hasher.update("|");
  hasher.update(purpose);
  hasher.update("|");
  hasher.update(secret);
  return hasher.digest("hex");
}

/**
 * Constant-time string equality. Length mismatch is observed (our hashes are
 * fixed length, so it leaks nothing) — but byte-wise comparison XOR-folds
 * into a single diff bit so the runtime can't short-circuit early.
 *
 * Mirrors the pattern in `middleware/csrf.ts` and `middleware/oauth/index.ts`.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Generate {@link NONCE_BYTES} random bytes as a base64url string.
 *
 * `crypto.getRandomValues` is CSPRNG-backed in every supported runtime
 * (Bun ≥ 1.3, Node ≥ 20, browsers, Deno).
 */
function generateNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

// ─── DB helpers (mirror session-sqlite.ts) ──────────────────────────────────

/**
 * `@mandujs/core/db` is tagged-template first; our DDL/DML strings are
 * dynamic (table name interpolated — SQLite cannot bind identifiers), so we
 * reconstruct a synthetic `TemplateStringsArray` from `$1`/`$2`/… split
 * segments and forward positional params. Lifted verbatim from
 * `filling/session-sqlite.ts`.
 */
async function execWithParams(dbOrTx: Db, sql: string, params: unknown[]): Promise<void> {
  const parts = splitPlaceholders(sql, params.length);
  const strings = Object.assign(parts.slice(), {
    raw: parts.slice(),
  }) as unknown as TemplateStringsArray;
  await dbOrTx(strings, ...params);
}

async function queryOne<T extends Record<string, unknown>>(
  dbOrTx: Db,
  sql: string,
  params: unknown[],
): Promise<T | null> {
  const parts = splitPlaceholders(sql, params.length);
  const strings = Object.assign(parts.slice(), {
    raw: parts.slice(),
  }) as unknown as TemplateStringsArray;
  const rows = await dbOrTx<T>(strings, ...params);
  if (!rows || rows.length === 0) return null;
  return rows[0] as T;
}

async function execRaw(dbOrTx: Db, sql: string): Promise<void> {
  const strings = Object.assign([sql], { raw: [sql] }) as unknown as TemplateStringsArray;
  await dbOrTx(strings);
}

function splitPlaceholders(sql: string, expected: number): string[] {
  const parts: string[] = [];
  let rest = sql;
  for (let i = 1; i <= expected; i++) {
    const marker = `$${i}`;
    const idx = rest.indexOf(marker);
    if (idx === -1) {
      throw new Error(
        `[@mandujs/core/auth/tokens] placeholder ${marker} missing in SQL: ${sql}`,
      );
    }
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx + marker.length);
  }
  parts.push(rest);
  return parts;
}

// ─── Row shape ──────────────────────────────────────────────────────────────

interface TokenRow {
  id: string;
  user_id: string;
  purpose: string;
  token_hash: string;
  meta: string | null;
  expires_at: number | bigint;
  consumed_at: number | bigint | null;
  [key: string]: unknown;
}

function rowToRecord(row: TokenRow): TokenRecord {
  let meta: Record<string, string> | undefined;
  if (typeof row.meta === "string" && row.meta.length > 0) {
    try {
      const parsed: unknown = JSON.parse(row.meta);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Force-narrow to Record<string,string> — we wrote it, we know the shape.
        meta = parsed as Record<string, string>;
      }
    } catch {
      // Corrupted row meta — treat as missing. The happy-path writer always
      // emits valid JSON, so this branch only fires on a hand-edited DB.
      meta = undefined;
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    purpose: row.purpose as TokenPurpose,
    tokenHash: row.token_hash,
    meta,
    expiresAt: Number(row.expires_at),
    consumedAt: row.consumed_at === null ? null : Number(row.consumed_at),
  };
}

// ─── Wire format ────────────────────────────────────────────────────────────

/**
 * Split the wire-format token into `{ id, nonce }`. Returns `null` on
 * anything malformed — called from `consume()`, which must never throw on
 * user input.
 *
 * The only validation we do is structural: "has exactly one `.` with
 * nonempty sides". We do NOT verify `id` is a UUID here — that would leak
 * "id was a UUID but nonce was wrong" vs "id wasn't a UUID" via branch
 * taken. Both paths fall through to the DB lookup, which returns null for
 * unknown ids uniformly.
 */
function parseToken(token: string): { id: string; nonce: string } | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  // Reject multi-dot tokens — base64url doesn't produce dots, and UUIDv7
  // doesn't either. A stray extra dot means "tampered" → null.
  if (token.indexOf(".", dot + 1) !== -1) return null;
  return { id: token.slice(0, dot), nonce: token.slice(dot + 1) };
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Build a token store backed by SQLite. Initialisation is lazy — the DB
 * connection and schema are created on first use, matching the pattern in
 * `filling/session-sqlite.ts` so boot stays cheap.
 *
 * @throws {TypeError} Synchronously when `secret` is empty or `table` fails
 *   the safe-identifier check.
 */
export function createAuthTokenStore(options: AuthTokenStoreOptions): AuthTokenStore {
  const {
    secret,
    dbPath = DEFAULT_DB_PATH,
    table = DEFAULT_TABLE,
    ttlSecondsByPurpose,
    gcSchedule = DEFAULT_GC_SCHEDULE,
  } = options;

  if (typeof secret !== "string" || secret.length === 0) {
    throw new TypeError(
      "[@mandujs/core/auth/tokens] createAuthTokenStore: 'secret' is required and must be a non-empty string.",
    );
  }
  if (!SAFE_IDENT_RE.test(table)) {
    throw new TypeError(
      `[@mandujs/core/auth/tokens] Invalid table name ${JSON.stringify(table)}. ` +
        `Must match ${SAFE_IDENT_RE}.`,
    );
  }

  const ttlByPurpose: Record<TokenPurpose, number> = {
    "verify-email": ttlSecondsByPurpose?.["verify-email"] ?? DEFAULT_TTL_VERIFY_EMAIL,
    "reset-password": ttlSecondsByPurpose?.["reset-password"] ?? DEFAULT_TTL_RESET_PASSWORD,
  };

  const url = `sqlite:${dbPath}`;
  const db: Db = createDb({ url });

  let initPromise: Promise<void> | null = null;
  let closed = false;
  let cronReg: CronRegistration | null = null;

  function ensureInit(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      // D.4: enable WAL so the GC sweep + live writers don't block each other.
      // :memory: accepts the pragma and silently stays in-memory — matches
      // session-sqlite.ts.
      await db`PRAGMA journal_mode = WAL`;

      const createTableSql = `CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        meta TEXT,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      )`;
      const createUserIndexSql = `CREATE INDEX IF NOT EXISTS ${table}_user ON ${table}(user_id, purpose)`;
      const createExpiresIndexSql = `CREATE INDEX IF NOT EXISTS ${table}_expires ON ${table}(expires_at)`;

      await execRaw(db, createTableSql);
      await execRaw(db, createUserIndexSql);
      await execRaw(db, createExpiresIndexSql);
    })();
    return initPromise;
  }

  function startCronIfEnabled(): void {
    if (gcSchedule === false) return;
    if (cronReg) return;
    try {
      const reg = defineCron({
        [`${table}:gc`]: {
          schedule: gcSchedule,
          run: async () => {
            // Swallow errors at the cron boundary — a stuck GC must not
            // crash the process. The scheduler already logs thrown errors,
            // but we also don't want a transient DB glitch to propagate.
            try {
              await gcNow();
            } catch (err) {
              console.warn(
                `[@mandujs/core/auth/tokens] GC sweep failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }
          },
        },
      });
      reg.start();
      cronReg = reg;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[@mandujs/core/auth/tokens] GC cron disabled: ${msg}. ` +
          `Call store.gcNow() manually if needed.`,
      );
    }
  }

  // Fire-and-forget init + cron wiring — any error surfaces on the first
  // real call. Mirrors session-sqlite.ts.
  void ensureInit().then(startCronIfEnabled);

  // ─── mint ─────────────────────────────────────────────────────────────────

  async function mint(
    purpose: TokenPurpose,
    userId: string,
    meta?: Record<string, string>,
  ): Promise<{ token: string; record: TokenRecord }> {
    if (closed) {
      throw new Error("[@mandujs/core/auth/tokens] store is closed.");
    }
    if (typeof userId !== "string" || userId.length === 0) {
      throw new TypeError(
        "[@mandujs/core/auth/tokens] mint: userId must be a non-empty string.",
      );
    }
    await ensureInit();

    const id = newId();
    const nonce = generateNonce();
    const tokenHash = hashNonce(nonce, purpose, secret);
    const expiresAt = Date.now() + ttlByPurpose[purpose] * 1000;
    const metaJson =
      meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;

    const sql = `INSERT INTO ${table} (id, user_id, purpose, token_hash, meta, expires_at, consumed_at) VALUES ($1, $2, $3, $4, $5, $6, NULL)`;
    await execWithParams(db, sql, [id, userId, purpose, tokenHash, metaJson, expiresAt]);

    const record: TokenRecord = {
      id,
      userId,
      purpose,
      tokenHash,
      meta: meta && Object.keys(meta).length > 0 ? { ...meta } : undefined,
      expiresAt,
      consumedAt: null,
    };
    return { token: `${id}.${nonce}`, record };
  }

  // ─── consume ──────────────────────────────────────────────────────────────

  async function consume(
    purpose: TokenPurpose,
    token: string,
  ): Promise<TokenRecord | null> {
    if (closed) {
      throw new Error("[@mandujs/core/auth/tokens] store is closed.");
    }
    // Validate BEFORE ensureInit — malformed tokens are cheap to reject
    // without opening the DB. But we still need init for the DB path below.
    const parsed = parseToken(token);
    if (!parsed) return null;
    await ensureInit();

    const now = Date.now();
    const expectedHash = hashNonce(parsed.nonce, purpose, secret);

    // Wrap in a transaction so the SELECT and the consuming UPDATE cannot be
    // interleaved by a second consumer. Under WAL with SQLite's single-
    // writer-serialised model, the second tx blocks on the first and then
    // observes `consumed_at IS NOT NULL`.
    let result: TokenRecord | null = null;
    await db.transaction(async (tx) => {
      const row = await queryOne<TokenRow>(
        tx,
        `SELECT id, user_id, purpose, token_hash, meta, expires_at, consumed_at FROM ${table} WHERE id = $1 LIMIT 1`,
        [parsed.id],
      );
      if (!row) return; // unknown id

      // Collapse every validation failure into "return null" without
      // revealing which check fired. Order doesn't matter for correctness
      // but we do the cheap checks first to keep the hot path fast.
      if (row.purpose !== purpose) return;
      if (Number(row.expires_at) <= now) return;
      if (row.consumed_at !== null) return;
      if (!safeEqual(row.token_hash, expectedHash)) return;

      // Conditional UPDATE — the `consumed_at IS NULL` predicate is the
      // atomic guard against a racing consumer. Even if two transactions
      // both passed the SELECT (which WAL prevents at the single-writer
      // level, but we keep the belt for correctness), only one UPDATE
      // changes a row.
      await execWithParams(
        tx,
        `UPDATE ${table} SET consumed_at = $1 WHERE id = $2 AND consumed_at IS NULL`,
        [now, row.id],
      );

      // Re-read the row to confirm we won the race AND to return the
      // authoritative state. A concurrent consumer would have flipped
      // `consumed_at` to some other timestamp between our check and update
      // — we cross-check by comparing back.
      const updated = await queryOne<TokenRow>(
        tx,
        `SELECT id, user_id, purpose, token_hash, meta, expires_at, consumed_at FROM ${table} WHERE id = $1 LIMIT 1`,
        [row.id],
      );
      if (!updated || updated.consumed_at === null) {
        // Either vanished (impossible in a tx) or the UPDATE didn't land
        // (should be impossible given our IS NULL guard) — fall through
        // to null.
        return;
      }
      // If another tx wrote a different `consumed_at`, concede and return
      // null — we lost the race.
      if (Number(updated.consumed_at) !== now) {
        return;
      }
      result = rowToRecord(updated);
    });
    return result;
  }

  // ─── gcNow ────────────────────────────────────────────────────────────────

  async function gcNow(): Promise<number> {
    if (closed) {
      throw new Error("[@mandujs/core/auth/tokens] store is closed.");
    }
    await ensureInit();

    const now = Date.now();
    let deleted = 0;
    await db.transaction(async (tx) => {
      const countSql = `SELECT COUNT(*) AS n FROM ${table} WHERE expires_at <= $1 OR consumed_at IS NOT NULL`;
      const cnt = await queryOne<{ n: number | bigint }>(tx, countSql, [now]);
      deleted = cnt ? Number(cnt.n) : 0;
      const delSql = `DELETE FROM ${table} WHERE expires_at <= $1 OR consumed_at IS NOT NULL`;
      await execWithParams(tx, delSql, [now]);
    });
    return deleted;
  }

  // ─── close ────────────────────────────────────────────────────────────────

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    if (cronReg) {
      try {
        await cronReg.stop();
      } catch {
        // Best-effort shutdown — don't mask the caller's flow.
      }
      cronReg = null;
    }
    await db.close();
  }

  return { mint, consume, gcNow, close };
}
