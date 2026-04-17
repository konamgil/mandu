import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { safeBuild, _getConcurrencyState } from "./safe-build";

/**
 * These tests verify that safeBuild caps concurrent Bun.build invocations.
 * We build tiny entrypoints; correctness of the output is not under test here —
 * that's covered by build.test.ts. We're testing the semaphore only.
 */

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "mandu-safebuild-test-"));
});

afterEach(async () => {
  try {
    await rm(rootDir, { recursive: true, force: true });
  } catch {
    // Windows may hold locks briefly after Bun.build
  }
});

async function makeEntry(name: string, body = "export const x = 1;\n"): Promise<string> {
  const file = path.join(rootDir, `${name}.ts`);
  await writeFile(file, body);
  return file;
}

describe("safeBuild", () => {
  it("returns the same BuildOutput shape as Bun.build", async () => {
    const entry = await makeEntry("a");
    const result = await safeBuild({
      entrypoints: [entry],
      outdir: rootDir,
      target: "browser",
    });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.outputs)).toBe(true);
    expect(result.outputs.length).toBeGreaterThan(0);
  });

  it("propagates build errors without swallowing them", async () => {
    const entry = await makeEntry("b", "import x from './does-not-exist';\nexport default x;\n");
    // Bun.build either returns { success: false } or throws AggregateError
    // depending on the failure mode. safeBuild must propagate either without
    // altering semantics.
    let caught: unknown = null;
    let result: Awaited<ReturnType<typeof safeBuild>> | null = null;
    try {
      result = await safeBuild({
        entrypoints: [entry],
        outdir: rootDir,
        target: "browser",
      });
    } catch (err) {
      caught = err;
    }
    const softFailed = result !== null && !result.success;
    const hardFailed = caught !== null;
    expect(softFailed || hardFailed).toBe(true);
  });

  it("caps concurrent builds (never exceeds max) under fan-out", async () => {
    const { max } = _getConcurrencyState();
    expect(max).toBeGreaterThanOrEqual(1);

    const entries = await Promise.all(
      Array.from({ length: 8 }, (_, i) => makeEntry(`fan-${i}`)),
    );

    // Sample concurrency peak on a microtask schedule.
    let peak = 0;
    const sampler = setInterval(() => {
      const { active } = _getConcurrencyState();
      if (active > peak) peak = active;
    }, 0);

    try {
      const results = await Promise.all(
        entries.map((entry) =>
          safeBuild({
            entrypoints: [entry],
            outdir: rootDir,
            target: "browser",
            naming: path.basename(entry, ".ts") + ".[ext]",
          }),
        ),
      );
      for (const r of results) {
        expect(r.success).toBe(true);
      }
    } finally {
      clearInterval(sampler);
    }

    // Peak observed concurrency must be <= max. Exact equality is not
    // guaranteed because all 8 may resolve faster than the sampler ticks,
    // but crucially peak must never exceed the cap.
    expect(peak).toBeLessThanOrEqual(max);
  });

  it("drains the queue: all builds eventually complete", async () => {
    const entries = await Promise.all(
      Array.from({ length: 6 }, (_, i) => makeEntry(`drain-${i}`)),
    );
    const results = await Promise.all(
      entries.map((entry) =>
        safeBuild({
          entrypoints: [entry],
          outdir: rootDir,
          target: "browser",
          naming: path.basename(entry, ".ts") + ".[ext]",
        }),
      ),
    );
    expect(results.every((r) => r.success)).toBe(true);

    // Semaphore must be fully released
    const state = _getConcurrencyState();
    expect(state.active).toBe(0);
    expect(state.queued).toBe(0);
  });
});
