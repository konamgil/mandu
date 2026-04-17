/**
 * @mandujs/core/auth/password
 *
 * Password hashing and verification backed by `Bun.password`.
 *
 * Defaults to **argon2id** — the OWASP-recommended memory-hard KDF. `bcrypt`
 * is exposed for legacy database interop only. PBKDF2/scrypt are intentionally
 * not supported (see non-goals in the module design doc).
 *
 * This module is **Bun-native**. It will throw at first call if executed in a
 * runtime without `Bun.password`. Use the Web Crypto polyfills in `@mandujs/core/id`
 * as a reference for how we handle runtime-specific APIs.
 *
 * @example
 * ```ts
 * import { hashPassword, verifyPassword } from "@mandujs/core/auth/password";
 *
 * const hash = await hashPassword("s3cret!");
 * const ok = await verifyPassword("s3cret!", hash); // true
 * ```
 *
 * @module auth/password
 */

/**
 * bcrypt hard-limits passwords to 72 bytes. We reject at the boundary instead
 * of letting Bun silently truncate, so callers get a clear error at hash time.
 * See https://en.wikipedia.org/wiki/Bcrypt#User_input
 */
const BCRYPT_MAX_BYTES = 72;

/**
 * Password hashing options. Mirrors the `Bun.password` option shape.
 */
export interface PasswordOptions {
  /** Default: "argon2id". bcrypt available for legacy interop. */
  algorithm?: "argon2id" | "argon2d" | "argon2i" | "bcrypt";
  /** Argon2 only. Memory cost in KiB. Default: Bun default. */
  memoryCost?: number;
  /** Argon2 only. Time cost (iterations). Default: Bun default. */
  timeCost?: number;
  /** bcrypt only. Cost factor. Default: Bun default. */
  cost?: number;
}

/** Minimal structural type for the Bun.password surface we consume. */
interface BunPasswordApi {
  hash: (plain: string, options?: PasswordOptions) => Promise<string>;
  verify: (plain: string, hash: string) => Promise<boolean>;
}

function getBunPassword(): BunPasswordApi {
  const g = globalThis as unknown as { Bun?: { password?: BunPasswordApi } };
  if (!g.Bun || !g.Bun.password) {
    throw new Error(
      "[@mandujs/core/auth/password] Bun.password is unavailable — this module requires the Bun runtime (>= 1.3).",
    );
  }
  return g.Bun.password;
}

/**
 * Hashes a plaintext password. Uses argon2id by default.
 *
 * Throws if `plain` is empty, or if `algorithm: "bcrypt"` is selected and the
 * UTF-8 byte length exceeds 72 (bcrypt's hard limit — we surface the error
 * early instead of silently truncating).
 */
export async function hashPassword(
  plain: string,
  options?: PasswordOptions,
): Promise<string> {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error(
      "[@mandujs/core/auth/password] hashPassword: plaintext must be a non-empty string.",
    );
  }

  if (options?.algorithm === "bcrypt") {
    const bytes = Buffer.byteLength(plain, "utf8");
    if (bytes > BCRYPT_MAX_BYTES) {
      throw new Error(
        `[@mandujs/core/auth/password] hashPassword: bcrypt input exceeds 72-byte limit (got ${bytes} bytes). Use argon2id for longer passwords.`,
      );
    }
  }

  return await getBunPassword().hash(plain, options);
}

/**
 * Verifies a plaintext password against a stored hash. Algorithm is
 * auto-detected from the hash prefix by Bun.
 *
 * Returns `false` on mismatch, malformed hash, or empty input. Never throws
 * for user-supplied values — a throwing verify path would leak hash-format
 * signal via timing/exception type to callers on the login path, so we
 * collapse every failure mode to the same boolean result.
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (
    typeof plain !== "string" ||
    plain.length === 0 ||
    typeof hash !== "string" ||
    hash.length === 0
  ) {
    return false;
  }

  try {
    return await getBunPassword().verify(plain, hash);
  } catch {
    // Malformed hash, unsupported algorithm, or any other internal error —
    // treat as verification failure. See function-level comment for rationale.
    return false;
  }
}
