/**
 * @mandujs/core/id
 *
 * Centralized ID generation utilities.
 *
 * Uses `crypto.randomUUIDv7()` when available (Bun 1.3+) so that generated IDs
 * are time-ordered — lexicographic string sort matches chronological creation
 * order. This makes v7 UUIDs ideal for log correlation, database primary keys,
 * and any context where sortability is useful.
 *
 * On older runtimes we fall back to `crypto.randomUUID()` (v4). The fallback
 * emits a single dev-only warning so integrators notice the reduced guarantee,
 * and remains silent in production.
 */

interface CryptoWithUUIDv7 {
  randomUUIDv7?: () => string;
  randomUUID: () => string;
}

interface BunWithUUIDv7 {
  randomUUIDv7?: () => string;
}

const FALLBACK_WARNING =
  "[@mandujs/core/id] randomUUIDv7 is unavailable — falling back to randomUUID (v4). IDs will not be time-ordered. Upgrade to Bun >= 1.3 for v7 support.";

let fallbackWarned = false;

function getCrypto(): CryptoWithUUIDv7 {
  // `crypto` is available globally in Bun, Node 20+, Deno, and modern browsers.
  // We type-assert via the narrow interface we actually use.
  return globalThis.crypto as unknown as CryptoWithUUIDv7;
}

function getBun(): BunWithUUIDv7 | undefined {
  // `Bun` is only present when running under the Bun runtime. Access via
  // a dynamic lookup so the module stays importable in Node / browsers.
  const g = globalThis as unknown as { Bun?: BunWithUUIDv7 };
  return g.Bun;
}

function warnFallbackOnce(): void {
  if (fallbackWarned) return;
  fallbackWarned = true;
  if (
    typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV !== "production"
  ) {
    console.warn(FALLBACK_WARNING);
  }
}

/**
 * Resolves the concrete UUID generator function once per call. Exported
 * internally so tests can validate the resolution order without monkey
 * patching non-configurable globals.
 *
 * @internal
 */
export function _resolveGenerator(
  c: CryptoWithUUIDv7 = getCrypto(),
  bun: BunWithUUIDv7 | undefined = getBun(),
): () => string {
  if (typeof c.randomUUIDv7 === "function") {
    return c.randomUUIDv7.bind(c);
  }
  if (bun && typeof bun.randomUUIDv7 === "function") {
    return bun.randomUUIDv7.bind(bun);
  }
  warnFallbackOnce();
  return c.randomUUID.bind(c);
}

/**
 * Generates a UUID v7 — a time-ordered UUID whose string sort matches
 * chronological order.
 *
 * Resolution order:
 *   1. `crypto.randomUUIDv7()` — web standard, Node 24+, newer Bun
 *   2. `Bun.randomUUIDv7()`    — Bun 1.3+ runtime API
 *   3. `crypto.randomUUID()`   — v4 fallback (non-monotonic)
 *
 * The fallback path emits a one-time warning in dev mode.
 *
 * @returns A 36-character UUID string in canonical 8-4-4-4-12 form.
 */
export function newId(): string {
  return _resolveGenerator()();
}

/**
 * First 8 hex characters of a UUID v7 — suitable for log correlation IDs
 * where collision risk is acceptable within a single request lifetime.
 *
 * Because v7 encodes the timestamp in its high bits, two short IDs generated
 * within the same millisecond share a prefix; this is normal and expected.
 * For strong uniqueness use {@link newId} instead.
 *
 * @returns Exactly 8 lowercase hex characters.
 */
export function newShortId(): string {
  return newId().slice(0, 8);
}
