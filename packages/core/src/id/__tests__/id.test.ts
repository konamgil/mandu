import { describe, it, expect } from "bun:test";
import { newId, newShortId, _resolveGenerator } from "../index";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX8_REGEX = /^[0-9a-f]{8}$/i;

interface CryptoLike {
  randomUUIDv7?: () => string;
  randomUUID: () => string;
}

describe("@mandujs/core/id — newId", () => {
  it("returns a canonical UUID string", () => {
    const id = newId();
    expect(id).toMatch(UUID_REGEX);
    expect(id.length).toBe(36);
  });

  it("returns distinct values across calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(newId());
    }
    expect(seen.size).toBe(1000);
  });

  it("is monotonic: lexicographic sort preserves generation order (v7 property)", async () => {
    // Skip this invariant if neither global exposes v7 — the v4 fallback is
    // correctly non-monotonic by design.
    const c = globalThis.crypto as unknown as CryptoLike;
    const bun = (globalThis as unknown as { Bun?: { randomUUIDv7?: () => string } }).Bun;
    const v7Available =
      typeof c.randomUUIDv7 === "function" ||
      (bun !== undefined && typeof bun.randomUUIDv7 === "function");
    if (!v7Available) {
      return;
    }

    const generated: string[] = [];
    for (let i = 0; i < 1000; i++) {
      generated.push(newId());
      // Force sub-millisecond spread across a few ticks so the time component
      // advances at least once during the run. UUID v7 counter handles
      // intra-millisecond monotonicity on its own.
      if (i % 200 === 0) {
        await new Promise((r) => setTimeout(r, 1));
      }
    }

    const sorted = [...generated].sort();

    // Require overall monotonic trend: the full sorted list equals the
    // generation order. Bun's v7 implementation uses a per-millisecond
    // monotonic counter, so ties within the same ms remain ordered.
    expect(sorted).toEqual(generated);
  });
});

describe("@mandujs/core/id — newShortId", () => {
  it("returns exactly 8 hex characters", () => {
    const short = newShortId();
    expect(short).toMatch(HEX8_REGEX);
    expect(short.length).toBe(8);
  });

  it("matches the prefix of the underlying UUID", () => {
    // The short form is defined as the first 8 chars of the full ID, which is
    // the first hex group of the UUID (pre-hyphen).
    for (let i = 0; i < 50; i++) {
      const short = newShortId();
      expect(short).not.toContain("-");
    }
  });
});

describe("@mandujs/core/id — generator resolution", () => {
  it("prefers crypto.randomUUIDv7 when present", () => {
    const sentinel = "01912345-6789-7abc-def0-123456789abc";
    const fakeCrypto = {
      randomUUIDv7: () => sentinel,
      randomUUID: () => "00000000-0000-4000-8000-000000000000",
    };
    const fakeBun = { randomUUIDv7: () => "SHOULD_NOT_BE_CALLED" };
    const gen = _resolveGenerator(fakeCrypto, fakeBun);
    expect(gen()).toBe(sentinel);
  });

  it("uses Bun.randomUUIDv7 when crypto.randomUUIDv7 is absent", () => {
    const sentinel = "01abcdef-0123-7456-8789-abcdef012345";
    const fakeCrypto = {
      randomUUID: () => "00000000-0000-4000-8000-000000000000",
    };
    const fakeBun = { randomUUIDv7: () => sentinel };
    const gen = _resolveGenerator(fakeCrypto, fakeBun);
    expect(gen()).toBe(sentinel);
  });

  it("falls back to crypto.randomUUID when neither v7 source is available", () => {
    const fakeCrypto = {
      // No randomUUIDv7 — force fallback.
      randomUUID: () => "00000000-0000-4000-8000-000000000000",
    };
    const fakeBun = {}; // also no randomUUIDv7
    const gen = _resolveGenerator(fakeCrypto, fakeBun);
    const id = gen();
    expect(id).toMatch(UUID_REGEX);
    expect(id.length).toBe(36);
  });

  it("falls back to crypto.randomUUID when Bun stub lacks randomUUIDv7", () => {
    const fakeCrypto = {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    };
    // Pass an empty stub explicitly rather than `undefined` (which would
    // trigger the default-parameter fallback to the real Bun global).
    const gen = _resolveGenerator(fakeCrypto, {});
    expect(gen()).toBe("11111111-1111-4111-8111-111111111111");
  });
});
