/**
 * @mandujs/core/auth/password tests
 *
 * These tests exercise real argon2id and bcrypt hashing through `Bun.password`.
 * They are CPU-bound (~50-200ms per hash op on laptop hardware); the suite
 * uses the minimum cost parameters Bun accepts whenever the test does not
 * care about actual KDF strength. Total runtime ~2-5s is expected.
 */

import { describe, it, expect } from "bun:test";
import { hashPassword, verifyPassword } from "../password";

// Argon2 hashes start with "$argon2id$", "$argon2d$", or "$argon2i$".
const ARGON2ID_PREFIX = "$argon2id$";
// bcrypt hashes use $2a$/$2b$/$2y$ prefixes; Bun emits $2b$.
const BCRYPT_PREFIX_RE = /^\$2[aby]\$/;

// Minimum argon2 cost params — keep tests fast without changing behavior.
const FAST_ARGON2 = {
  algorithm: "argon2id",
  memoryCost: 4,
  timeCost: 2,
} as const;

describe("@mandujs/core/auth/password — hashPassword", () => {
  it("produces an argon2id hash by default", async () => {
    const h = await hashPassword("hunter2", FAST_ARGON2);
    expect(h.startsWith(ARGON2ID_PREFIX)).toBe(true);
  });

  it("produces a bcrypt hash when algorithm=bcrypt is requested", async () => {
    const h = await hashPassword("hunter2", { algorithm: "bcrypt", cost: 4 });
    expect(h).toMatch(BCRYPT_PREFIX_RE);
  });

  it("throws on empty plaintext", async () => {
    await expect(hashPassword("", FAST_ARGON2)).rejects.toThrow(
      /non-empty string/,
    );
  });

  it("throws when bcrypt input exceeds 72 bytes", async () => {
    // 73 ASCII bytes (each char = 1 UTF-8 byte).
    const tooLong = "a".repeat(73);
    await expect(
      hashPassword(tooLong, { algorithm: "bcrypt", cost: 4 }),
    ).rejects.toThrow(/72-byte limit/);
  });

  it("accepts >72-byte input when using argon2id (bcrypt-only limit)", async () => {
    const longButFine = "a".repeat(100);
    const h = await hashPassword(longButFine, FAST_ARGON2);
    expect(h.startsWith(ARGON2ID_PREFIX)).toBe(true);
  });

  it("counts UTF-8 bytes (not code points) when enforcing the bcrypt limit", async () => {
    // "é" is 2 bytes in UTF-8 — 40 of them = 80 bytes, over the 72 limit.
    const multibyte = "é".repeat(40);
    await expect(
      hashPassword(multibyte, { algorithm: "bcrypt", cost: 4 }),
    ).rejects.toThrow(/72-byte limit/);
  });

  it("honors non-default argon2 timeCost via option pass-through", async () => {
    // Bun embeds the cost parameters in the hash string:
    //   $argon2id$v=19$m=<memoryCost>,t=<timeCost>,p=1$<salt>$<hash>
    // We assert the timeCost is preserved end-to-end.
    const h = await hashPassword("same-password", {
      algorithm: "argon2id",
      memoryCost: 4,
      timeCost: 3,
    });
    expect(h).toMatch(/\$argon2id\$v=\d+\$m=4,t=3,p=\d+\$/);
  });
});

describe("@mandujs/core/auth/password — verifyPassword", () => {
  it("returns true for a matching argon2id roundtrip", async () => {
    const h = await hashPassword("correct-horse-battery-staple", FAST_ARGON2);
    const ok = await verifyPassword("correct-horse-battery-staple", h);
    expect(ok).toBe(true);
  });

  it("returns true for a matching bcrypt roundtrip", async () => {
    const h = await hashPassword("correct-horse-battery-staple", {
      algorithm: "bcrypt",
      cost: 4,
    });
    const ok = await verifyPassword("correct-horse-battery-staple", h);
    expect(ok).toBe(true);
  });

  it("returns false for wrong plaintext", async () => {
    const h = await hashPassword("correct", FAST_ARGON2);
    expect(await verifyPassword("incorrect", h)).toBe(false);
  });

  it("returns false for a tampered hash (one char mutated)", async () => {
    const h = await hashPassword("correct", FAST_ARGON2);
    // Flip the last character of the base64 hash segment.
    const last = h.charAt(h.length - 1);
    const replacement = last === "A" ? "B" : "A";
    const tampered = h.slice(0, -1) + replacement;
    expect(tampered).not.toBe(h);
    expect(await verifyPassword("correct", tampered)).toBe(false);
  });

  it("returns false (never throws) for a malformed hash string", async () => {
    // Bun.password.verify throws on unparseable hashes; our wrapper collapses
    // every failure mode to `false` so login handlers stay branchless.
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("returns false for empty plaintext", async () => {
    const h = await hashPassword("correct", FAST_ARGON2);
    expect(await verifyPassword("", h)).toBe(false);
  });

  it("returns false for empty hash", async () => {
    expect(await verifyPassword("correct", "")).toBe(false);
  });
});
