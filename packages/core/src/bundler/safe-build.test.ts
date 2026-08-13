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

describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")("safeBuild", () => {
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

  it("slot handoff — new callers cannot bypass queued waiters (regression for cap+1 race)", async () => {
    // Scenario: a build completes with a waiter queued; a NEW safeBuild call
    // fires on the same microtask. A prior revision decremented `active`
    // before resolving the waiter, leaving a microtask-sized window where
    // the new caller saw `active < max`, skipped the wait, and became the
    // cap+1 concurrent build. This test launches 3*max + 1 builds, samples
    // active at every slot release, and asserts the peak never exceeds max.
    const { max } = _getConcurrencyState();
    const N = max * 3 + 1; // always enough to trigger at least one handoff
    const entries = await Promise.all(
      Array.from({ length: N }, (_, i) => makeEntry(`handoff-${i}`)),
    );

    let peak = 0;
    let samples = 0;
    // Sample active-slot count while the build burst is in flight. An earlier
    // revision of this test used a `while (!stop) { await Promise.resolve() }`
    // microtask busy-loop to push sampling granularity below setInterval's
    // Windows 4ms-ish clamp. That deadlocks under Bun 1.3.x on Windows:
    // `await Promise.resolve()` stays on the microtask queue, which runs
    // to exhaustion before Bun's libuv I/O phase — so Bun.build completion
    // callbacks never fire, `releaseSlot()` never runs, and the promises
    // returned by the 7 parallel `safeBuild()` calls hang indefinitely.
    // Reproduction: `bun test src/bundler/safe-build.test.ts` times out with
    // only the banner printed (confirmed with a standalone repro of the
    // sampler + 7 safeBuild calls — hung at "start" past 60s).
    //
    // Fix: yield to the macrotask queue via `setImmediate`. This lets
    // libuv I/O callbacks run between samples, so Bun.build completes and
    // `releaseSlot()` advances the queue. Per-tick granularity on Node/Bun
    // is still sub-millisecond and fires ~hundreds of times during a 7-
    // build burst — more than enough to statistically catch the cap+1
    // regression window if it ever returned (the window is microtask-sized,
    // but any cross-tick sampling with high fan-out has a realistic chance
    // of landing inside it). The strict assertion is still `peak <= max`.
    let stop = false;
    const sample = async () => {
      for (;;) {
        if (stop) break;
        const { active } = _getConcurrencyState();
        if (active > peak) peak = active;
        samples++;
        // Yield to libuv I/O phase so Bun.build callbacks can fire.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    };
    const sampler = sample();

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
      expect(results.every((r) => r.success)).toBe(true);
    } finally {
      stop = true;
      await sampler;
    }

    expect(peak).toBeLessThanOrEqual(max);
    expect(samples).toBeGreaterThan(0);

    const state = _getConcurrencyState();
    expect(state.active).toBe(0);
    expect(state.queued).toBe(0);
  });
});
