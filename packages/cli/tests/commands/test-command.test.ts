/**
 * `mandu test` command — orchestrator unit tests.
 *
 * Covers: glob discovery (positive + exclusion), argv composition, unknown
 * target rejection. We purposefully do NOT spawn actual `bun test`
 * subprocesses here — that's covered by CLI e2e in a higher tier so this
 * suite stays fast + deterministic.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  buildBunTestArgs,
  discoverTestFiles,
  resolveTargetFiles,
  testCommand,
} from "../../src/commands/test";
import { resolveTestConfig } from "@mandujs/core/compat/config/validate";

describe("discoverTestFiles", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mandu-test-discover-"));
    await mkdir(path.join(dir, "src"), { recursive: true });
    await mkdir(path.join(dir, "src", "nested"), { recursive: true });
    await mkdir(path.join(dir, "node_modules", "foo"), { recursive: true });

    await writeFile(path.join(dir, "src", "a.test.ts"), "// a");
    await writeFile(path.join(dir, "src", "nested", "b.test.ts"), "// b");
    await writeFile(path.join(dir, "src", "regular.ts"), "// not a test");
    await writeFile(path.join(dir, "node_modules", "foo", "x.test.ts"), "// should be excluded");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("matches the default *.test.ts glob", async () => {
    const files = await discoverTestFiles(dir, ["**/*.test.ts"], []);
    // 3 matches including node_modules — exclusion is caller-supplied.
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("filters out node_modules via exclusion globs", async () => {
    const files = await discoverTestFiles(
      dir,
      ["**/*.test.ts"],
      ["node_modules/**"],
    );
    for (const f of files) {
      expect(f).not.toContain("node_modules");
    }
    expect(files.length).toBe(2);
  });

  it("returns a deterministic, sorted list", async () => {
    const files = await discoverTestFiles(
      dir,
      ["**/*.test.ts"],
      ["node_modules/**"],
    );
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  it("returns an empty list when no files match", async () => {
    const files = await discoverTestFiles(dir, ["**/*.nope.ts"], []);
    expect(files).toEqual([]);
  });
});

describe("buildBunTestArgs", () => {
  it("emits the minimal form with just timeout + files", () => {
    const args = buildBunTestArgs(["a.test.ts", "b.test.ts"], {}, 10_000);
    expect(args[0]).toBe("test");
    expect(args).toContain("--timeout");
    expect(args).toContain("10000");
    expect(args).toContain("a.test.ts");
    expect(args).toContain("b.test.ts");
  });

  it("forwards --filter with its argument", () => {
    const args = buildBunTestArgs(["a.test.ts"], { filter: "login" }, 1);
    const idx = args.indexOf("--filter");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("login");
  });

  it("forwards boolean flags independently", () => {
    const args = buildBunTestArgs(
      ["a.test.ts"],
      { watch: true, coverage: true, bail: true, updateSnapshots: true },
      1,
    );
    // Phase 12.3: --watch is owned by mandu's watcher, NOT forwarded to bun test.
    // The watch loop (runWatchMode) re-invokes bun test on changes — we must not
    // pass --watch to the child or it short-circuits affected-file mapping.
    expect(args).not.toContain("--watch");
    expect(args).toContain("--coverage");
    expect(args).toContain("--bail");
    expect(args).toContain("--update-snapshots");
  });
});

describe("resolveTargetFiles", () => {
  it("returns files for unit block", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mandu-test-resolve-"));
    try {
      await writeFile(path.join(dir, "x.test.ts"), "// t");
      const cfg = resolveTestConfig({});
      const files = await resolveTargetFiles(dir, "unit", cfg);
      expect(files.some((f) => f.endsWith("x.test.ts"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("testCommand — argument validation", () => {
  it("rejects unknown target", async () => {
    // Using `any` so we can intentionally pass an invalid string to prove
    // the runtime branch in testCommand. The compile-time TestTarget union
    // is enforced at the call site separately.
    const ok = await testCommand("bogus" as "unit", { cwd: process.cwd() });
    expect(ok).toBe(false);
  });

  it("returns false when glob produces zero matches for a target", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mandu-test-empty-"));
    try {
      // Write a config that narrows unit include to a non-existent pattern.
      await writeFile(
        path.join(dir, "mandu.config.json"),
        JSON.stringify({
          test: {
            unit: { include: ["definitely-nothing/**/*.test.ts"], exclude: [] },
          },
        }),
      );
      const ok = await testCommand("unit", { cwd: dir });
      expect(ok).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
