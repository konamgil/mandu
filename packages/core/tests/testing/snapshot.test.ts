/**
 * Tests for `packages/core/src/testing/snapshot.ts`.
 *
 * Verifies:
 * - Deterministic serialization under key reordering, Map/Set, nested
 *   structures, cycles, Dates, RegExps, Errors.
 * - First-run creation, match, mismatch, and update-mode behavior.
 * - Path derivation (`__snapshots__/<name>.snap`) next to the test file.
 * - `scrubVolatile` canonicalizes timestamps / UUIDs / absolute paths.
 * - `isUpdateMode` reflects `UPDATE_SNAPSHOTS=1` env overrides.
 *
 * All filesystem work happens under `mkdtemp` so tests are hermetic and
 * safe under `bun test --randomize`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  deriveSnapshotPath,
  isUpdateMode,
  matchSnapshot,
  scrubVolatile,
  stableStringify,
  toMatchSnapshot,
} from "../../src/testing/snapshot";

const PREFIX = path.join(os.tmpdir(), "mandu-snapshot-test-");

// ═══════════════════════════════════════════════════════════════════════════
// stableStringify
// ═══════════════════════════════════════════════════════════════════════════

describe("stableStringify", () => {
  it("orders object keys deterministically", () => {
    const a = stableStringify({ b: 1, a: 2, c: 3 });
    const b = stableStringify({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    // Keys should be alphabetical in the rendered output.
    expect(a.indexOf('"a"')).toBeLessThan(a.indexOf('"b"'));
    expect(a.indexOf('"b"')).toBeLessThan(a.indexOf('"c"'));
  });

  it("preserves array order (order is semantically meaningful)", () => {
    const forward = stableStringify([3, 1, 2]);
    const reversed = stableStringify([2, 1, 3]);
    expect(forward).not.toBe(reversed);
  });

  it("serializes Date as an ISO string wrapper", () => {
    const result = stableStringify({ at: new Date("2025-01-01T00:00:00Z") });
    expect(result).toContain("[Date 2025-01-01T00:00:00.000Z]");
  });

  it("serializes Map with sorted keys", () => {
    const m = new Map<string, number>();
    m.set("zebra", 1);
    m.set("alpha", 2);
    const result = stableStringify(m);
    expect(result.indexOf("alpha")).toBeLessThan(result.indexOf("zebra"));
    expect(result).toContain("\"__type\": \"Map\"");
  });

  it("serializes Set without throwing", () => {
    const s = new Set(["x", "y"]);
    const result = stableStringify(s);
    expect(result).toContain("\"__type\": \"Set\"");
  });

  it("handles circular references", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const result = stableStringify(obj);
    expect(result).toContain("[Circular]");
  });

  it("drops undefined and function values", () => {
    const result = stableStringify({
      keep: "yes",
      skip: undefined,
      fn: () => 1,
    });
    expect(result).not.toContain("skip");
    expect(result).not.toContain("fn");
    expect(result).toContain("keep");
  });

  it("ends with a trailing newline for diff-friendliness", () => {
    const result = stableStringify({ x: 1 });
    expect(result.endsWith("\n")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// deriveSnapshotPath
// ═══════════════════════════════════════════════════════════════════════════

describe("deriveSnapshotPath", () => {
  it("co-locates with the test file under __snapshots__/", () => {
    const result = deriveSnapshotPath("/repo/pkg/foo.test.ts");
    // Normalize for cross-platform assertions.
    const normalized = result.split(path.sep).join("/");
    expect(normalized).toBe("/repo/pkg/__snapshots__/foo.test.ts.snap");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// matchSnapshot — storage IO
// ═══════════════════════════════════════════════════════════════════════════

describe("matchSnapshot", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.promises.mkdtemp(PREFIX);
  });

  afterAll(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Ensure UPDATE_SNAPSHOTS does not leak between cases.
    delete process.env.UPDATE_SNAPSHOTS;
  });

  afterEach(() => {
    delete process.env.UPDATE_SNAPSHOTS;
  });

  it("creates the snapshot file on first run and treats it as a pass", () => {
    const snapshotPath = path.join(dir, "first.snap");
    const result = matchSnapshot({ user: "alice", age: 30 }, { snapshotPath });
    expect(result.match).toBe(true);
    expect(result.created).toBe(true);
    expect(fs.existsSync(snapshotPath)).toBe(true);
  });

  it("passes when the stored value matches", () => {
    const snapshotPath = path.join(dir, "match.snap");
    matchSnapshot({ a: 1 }, { snapshotPath });
    const second = matchSnapshot({ a: 1 }, { snapshotPath });
    expect(second.match).toBe(true);
    expect(second.created).toBe(false);
    expect(second.updated).toBe(false);
  });

  it("fails with a diff when values differ", () => {
    const snapshotPath = path.join(dir, "mismatch.snap");
    matchSnapshot({ value: "original" }, { snapshotPath });
    const result = matchSnapshot({ value: "changed" }, { snapshotPath });
    expect(result.match).toBe(false);
    expect(result.diff).toContain("- ");
    expect(result.diff).toContain("+ ");
    expect(result.diff).toContain("original");
    expect(result.diff).toContain("changed");
  });

  it("updates in-place when `update: true` is passed", () => {
    const snapshotPath = path.join(dir, "update.snap");
    matchSnapshot({ version: 1 }, { snapshotPath });
    const result = matchSnapshot(
      { version: 2 },
      { snapshotPath, update: true },
    );
    expect(result.match).toBe(true);
    expect(result.updated).toBe(true);
    // Re-read without update — should now match.
    const followup = matchSnapshot({ version: 2 }, { snapshotPath });
    expect(followup.match).toBe(true);
  });

  it("updates in-place when UPDATE_SNAPSHOTS=1 is set", () => {
    const snapshotPath = path.join(dir, "env-update.snap");
    matchSnapshot({ n: 1 }, { snapshotPath });
    process.env.UPDATE_SNAPSHOTS = "1";
    const result = matchSnapshot({ n: 99 }, { snapshotPath });
    expect(result.match).toBe(true);
    expect(result.updated).toBe(true);
  });

  it("supports multiple named snapshots in the same file", () => {
    const snapshotPath = path.join(dir, "named.snap");
    matchSnapshot({ kind: "user" }, { snapshotPath, name: "alpha" });
    matchSnapshot({ kind: "post" }, { snapshotPath, name: "beta" });

    const a = matchSnapshot({ kind: "user" }, { snapshotPath, name: "alpha" });
    const b = matchSnapshot({ kind: "post" }, { snapshotPath, name: "beta" });
    expect(a.match).toBe(true);
    expect(b.match).toBe(true);

    // Load raw file and confirm both keys exist.
    const raw = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
      snapshots: Record<string, string>;
    };
    expect(Object.keys(raw.snapshots).sort()).toEqual(["alpha", "beta"]);
  });

  it("accepts a normalize() hook to scrub volatile values", () => {
    const snapshotPath = path.join(dir, "normalize.snap");
    const at1 = new Date("2025-01-01T00:00:00Z").toISOString();
    const at2 = new Date("2025-06-01T00:00:00Z").toISOString();

    matchSnapshot(
      { id: "abc123", at: at1 },
      { snapshotPath, normalize: (v) => scrubVolatile(v) },
    );
    const result = matchSnapshot(
      { id: "abc123", at: at2 },
      { snapshotPath, normalize: (v) => scrubVolatile(v) },
    );
    // Dates differ in the raw value, but both should normalize to
    // `<timestamp>` and thus match.
    expect(result.match).toBe(true);
  });

  it("derives snapshot path from testFile when snapshotPath is omitted", () => {
    const testFile = path.join(dir, "some-test.test.ts");
    const result = matchSnapshot({ k: "v" }, { testFile });
    expect(result.snapshotPath).toBe(
      path.join(dir, "__snapshots__", "some-test.test.ts.snap"),
    );
    expect(fs.existsSync(result.snapshotPath)).toBe(true);
  });

  it("throws when neither snapshotPath nor testFile is supplied", () => {
    expect(() => matchSnapshot({ x: 1 }, {})).toThrow(/snapshotPath or testFile/);
  });

  it("tolerates corrupt snapshot files without crashing", () => {
    const snapshotPath = path.join(dir, "corrupt.snap");
    fs.writeFileSync(snapshotPath, "{ not valid json");
    // Corrupt file treated as "no snapshot stored" → recorded as create.
    const result = matchSnapshot({ ok: true }, { snapshotPath });
    expect(result.match).toBe(true);
    expect(result.created).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// toMatchSnapshot — throw on mismatch
// ═══════════════════════════════════════════════════════════════════════════

describe("toMatchSnapshot", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.promises.mkdtemp(PREFIX);
  });

  afterAll(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    delete process.env.UPDATE_SNAPSHOTS;
  });

  afterEach(() => {
    delete process.env.UPDATE_SNAPSHOTS;
  });

  it("returns on match, throws on mismatch", () => {
    const snapshotPath = path.join(dir, "throw.snap");
    toMatchSnapshot({ value: 1 }, { snapshotPath });
    expect(() =>
      toMatchSnapshot({ value: 2 }, { snapshotPath }),
    ).toThrow(/Snapshot mismatch/);
  });

  it("accepts a bare string as the snapshot name", () => {
    const snapshotPath = path.join(dir, "bare-name.snap");
    const result = toMatchSnapshot({ k: "v" }, { snapshotPath, name: "first" });
    expect(result.name).toBe("first");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isUpdateMode
// ═══════════════════════════════════════════════════════════════════════════

describe("isUpdateMode", () => {
  beforeEach(() => {
    delete process.env.UPDATE_SNAPSHOTS;
  });

  afterEach(() => {
    delete process.env.UPDATE_SNAPSHOTS;
  });

  it("is false when UPDATE_SNAPSHOTS is unset", () => {
    expect(isUpdateMode()).toBe(false);
  });

  it("is true for '1' / 'true' / 'yes'", () => {
    for (const v of ["1", "true", "TRUE", "yes"]) {
      process.env.UPDATE_SNAPSHOTS = v;
      expect(isUpdateMode()).toBe(true);
    }
  });

  it("is false for '' / '0' / 'false'", () => {
    for (const v of ["", "0", "false"]) {
      process.env.UPDATE_SNAPSHOTS = v;
      expect(isUpdateMode()).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// scrubVolatile
// ═══════════════════════════════════════════════════════════════════════════

describe("scrubVolatile", () => {
  it("replaces ISO-8601 timestamps with <timestamp>", () => {
    const result = scrubVolatile({ at: "2025-04-19T12:00:00.000Z" });
    expect((result as { at: string }).at).toBe("<timestamp>");
  });

  it("replaces epoch millis with <timestamp>", () => {
    const result = scrubVolatile({ ts: Date.now() });
    expect((result as { ts: unknown }).ts).toBe("<timestamp>");
  });

  it("replaces UUIDs with <uuid>", () => {
    const result = scrubVolatile({ id: "9f7c4a8e-4a29-4d8f-8fa2-0b9c3d5e7f12" });
    expect((result as { id: string }).id).toBe("<uuid>");
  });

  it("replaces absolute POSIX paths with <abs path>", () => {
    const result = scrubVolatile({ cwd: "/usr/local/mandu/project/file.ts" });
    expect((result as { cwd: string }).cwd).toBe("<abs path>");
  });

  it("replaces Windows absolute paths with <abs path>", () => {
    const result = scrubVolatile({ cwd: "C:\\Users\\alice\\mandu\\file.ts" });
    expect((result as { cwd: string }).cwd).toBe("<abs path>");
  });

  it("recurses into nested structures", () => {
    const input = {
      runs: [
        { id: "9f7c4a8e-4a29-4d8f-8fa2-0b9c3d5e7f12", at: "2025-01-01T00:00:00Z" },
      ],
    };
    const result = scrubVolatile(input) as {
      runs: Array<{ id: string; at: string }>;
    };
    expect(result.runs[0].id).toBe("<uuid>");
    expect(result.runs[0].at).toBe("<timestamp>");
  });

  it("leaves small numbers alone", () => {
    expect(scrubVolatile({ n: 42 })).toEqual({ n: 42 });
  });
});
