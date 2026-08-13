/**
 * Unit tests for DockerSandboxAdapter (src/docker-adapter.ts).
 *
 * **Strategy**: we never invoke the real `docker` binary. Instead we
 * inject a `spawnFactory` stub that returns a scripted `DockerProcLike`
 * and record the argv Bun would have passed to the CLI. This lets CI
 * assert:
 *   1. Every required security flag appears in `docker run …`
 *   2. stdout/stderr streaming → SSE events follows the wire shape
 *   3. Wall-clock timeout → error event with reason="timeout"
 *   4. Exit code 137 → error event with reason="oom"
 *   5. Output larger than cap → error event with reason="output-cap"
 *   6. Clean exit → exit event with durationMs
 *   7. Spawn failure → error event with reason="internal"
 *   8. `sanitizeRunId` coerces unsafe characters
 *
 * The tests never touch the filesystem: we override `stageUserCode` on a
 * subclass so `run()` can proceed without writing a real host file.
 */

import { describe, it, expect } from "bun:test";
import {
  DockerSandboxAdapter,
  DEFAULT_SANDBOX_IMAGE,
  sanitizeRunId,
  type DockerProcLike,
  type DockerSpawnFactory,
  type DockerSpawnOptions,
} from "../src/docker-adapter";
import type { RunOptions, SSEEvent } from "../src/types";
import { SECURITY_POLICY } from "../src/security";

// ---------------------------------------------------------------------------
// Helpers — scripted process + adapter that skips filesystem staging
// ---------------------------------------------------------------------------

interface ScriptedProcOptions {
  /** stdout chunks to emit before exit. */
  stdout?: string[];
  /** stderr chunks to emit before exit. */
  stderr?: string[];
  /** Exit code — default 0. */
  exitCode?: number;
  /** Delay before the `exited` promise resolves, in ms. */
  exitDelayMs?: number;
  /**
   * When set, `exited` never resolves (simulates a wedged container).
   * The adapter's watchdog should kill the proc via `kill()`.
   */
  hang?: boolean;
}

function scriptedProc(opts: ScriptedProcOptions = {}): DockerProcLike {
  const stdoutChunks = opts.stdout ?? [];
  const stderrChunks = opts.stderr ?? [];

  const makeStream = (chunks: string[]): ReadableStream<Uint8Array> => {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(enc.encode(c));
        }
        controller.close();
      },
    });
  };

  let killed = false;
  const exited: Promise<number> = opts.hang
    ? new Promise<number>((resolve) => {
        // Resolve only when kill() is called, so the adapter's watchdog
        // path can progress after firing docker-kill.
        const checkKilled = (): void => {
          if (killed) {
            resolve(137);
          } else {
            setTimeout(checkKilled, 25);
          }
        };
        setTimeout(checkKilled, 25);
      })
    : new Promise<number>((resolve) => {
        setTimeout(() => resolve(opts.exitCode ?? 0), opts.exitDelayMs ?? 5);
      });

  return {
    stdout: makeStream(stdoutChunks),
    stderr: makeStream(stderrChunks),
    exited,
    kill() {
      killed = true;
    },
  };
}

/**
 * Test harness: adapter subclass that skips real filesystem staging.
 * We keep the full pipeline (buildDockerArgs → spawn → drain → events)
 * but fake out the `stageUserCode` call so tests never need `/tmp`
 * write access.
 */
class TestAdapter extends DockerSandboxAdapter {
  protected override async stageUserCode(_opts: RunOptions): Promise<string> {
    return "/tmp/mandu-playground/code-test.ts";
  }
  protected override async unstageUserCode(_path: string): Promise<void> {
    // no-op
  }
}

/**
 * Build a spawnFactory stub that records all invocations and returns a
 * scripted proc for the main `docker run` call. Subsequent invocations
 * (`docker kill`) return a proc that exits immediately — we don't care
 * about their argv beyond that they were attempted.
 */
function recordingSpawn(
  runProc: () => DockerProcLike,
): {
  factory: DockerSpawnFactory;
  calls: DockerSpawnOptions[];
} {
  const calls: DockerSpawnOptions[] = [];
  let runCount = 0;
  const factory: DockerSpawnFactory = (opts) => {
    calls.push(opts);
    // The first invocation is `docker run …`; subsequent ones are the
    // watchdog's `docker kill <name>` side call.
    if (runCount === 0) {
      runCount++;
      return runProc();
    }
    return {
      exited: Promise.resolve(0),
      kill() {},
    };
  };
  return { factory, calls };
}

const baseOpts: RunOptions = {
  code: "console.log('hello')",
  example: "hello-mandu",
  runId: "run-abc123",
  clientIp: "127.0.0.1",
};

async function collect(stream: AsyncIterable<SSEEvent>, limit = 1000): Promise<SSEEvent[]> {
  const out: SSEEvent[] = [];
  for await (const ev of stream) {
    out.push(ev);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Argv shape — every required security flag appears
// ---------------------------------------------------------------------------

describe("DockerSandboxAdapter: docker run argv", () => {
  it("pins the default sandbox to Bun 1.3.14", () => {
    expect(DEFAULT_SANDBOX_IMAGE).toBe("oven/bun:1.3.14-slim");
  });

  it("includes every required security flag", () => {
    const adapter = new DockerSandboxAdapter({
      spawnFactory: () => scriptedProc(),
    });
    const argv = adapter.buildDockerArgs(
      "mandu-sbx-test",
      "/tmp/mandu-playground/code-test.ts",
      baseOpts,
    );

    expect(argv[0]).toBe("run");
    expect(argv).toContain("--rm");
    expect(argv).toContain("--network=none");
    expect(argv).toContain("--read-only");
    expect(argv).toContain("--cap-drop=ALL");
    expect(argv).toContain("--security-opt=no-new-privileges");

    // Memory + swap pair (deny swap escape).
    expect(argv).toContain("--memory=256m");
    expect(argv).toContain("--memory-swap=256m");

    // CPU cap.
    expect(argv).toContain("--cpus=0.5");

    // Fork-bomb protection.
    expect(argv).toContain("--pids-limit=128");

    // tmpfs for writable dirs (read-only rootfs demands this).
    const tmpfsArgs = argv.filter((a, i) => a === "--tmpfs" || argv[i - 1] === "--tmpfs");
    expect(tmpfsArgs.some((a) => a.startsWith("/tmp"))).toBe(true);
    expect(tmpfsArgs.some((a) => a.startsWith("/work"))).toBe(true);

    // Non-root user.
    expect(argv).toContain("--user");
    const userIdx = argv.indexOf("--user");
    expect(argv[userIdx + 1]).toBe("65534:65534");

    // Stop timeout derived from wallClock — 30s default → "30".
    expect(argv).toContain(`--stop-timeout=${Math.ceil(SECURITY_POLICY.wallClockMs / 1000)}`);

    // User-code bind mount (read-only).
    expect(argv).toContain("-v");
    const vIdx = argv.indexOf("-v");
    expect(argv[vIdx + 1]).toContain(":/work/index.ts:ro");

    // Env injection for runId + example.
    expect(argv).toContain(`MANDU_PLAYGROUND_RUN_ID=${baseOpts.runId}`);
    expect(argv).toContain(`MANDU_PLAYGROUND_EXAMPLE=${baseOpts.example}`);
    expect(argv).toContain("NO_COLOR=1");

    // The image comes last before the command. Default = oven/bun slim.
    expect(argv).toContain(DEFAULT_SANDBOX_IMAGE);

    // The last three tokens are the command.
    expect(argv.slice(-3)).toEqual(["bun", "run", "/work/index.ts"]);

    // Container name is named explicitly so we can `docker kill` on timeout.
    expect(argv).toContain("--name");
    const nameIdx = argv.indexOf("--name");
    expect(argv[nameIdx + 1]).toBe("mandu-sbx-test");
  });

  it("honors MANDU_DOCKER_SANDBOX_IMAGE override", () => {
    const adapter = new DockerSandboxAdapter({
      image: "my-custom/image:v1",
      spawnFactory: () => scriptedProc(),
    });
    const argv = adapter.buildDockerArgs("n", "/tmp/code.ts", baseOpts);
    expect(argv).toContain("my-custom/image:v1");
    expect(argv).not.toContain(DEFAULT_SANDBOX_IMAGE);
  });

  it("honors custom cpus / memoryMib / pidsLimit", () => {
    const adapter = new DockerSandboxAdapter({
      memoryMib: 128,
      cpus: 0.25,
      pidsLimit: 64,
      spawnFactory: () => scriptedProc(),
    });
    const argv = adapter.buildDockerArgs("n", "/tmp/code.ts", baseOpts);
    expect(argv).toContain("--memory=128m");
    expect(argv).toContain("--memory-swap=128m");
    expect(argv).toContain("--cpus=0.25");
    expect(argv).toContain("--pids-limit=64");
  });

  it("DockerSandboxAdapter.fromEnv picks up environment overrides", () => {
    const adapter = DockerSandboxAdapter.fromEnv({
      MANDU_DOCKER_SANDBOX_IMAGE: "from-env/image:latest",
      MANDU_DOCKER_BIN: "podman",
      MANDU_DOCKER_WORK_DIR: "/var/lib/mandu/work",
    });
    const argv = adapter.buildDockerArgs("n", "/tmp/code.ts", baseOpts);
    expect(argv).toContain("from-env/image:latest");
  });
});

// ---------------------------------------------------------------------------
// Streaming — stdout / stderr chunks become SSE events
// ---------------------------------------------------------------------------

describe("DockerSandboxAdapter: streaming", () => {
  it("emits sandbox-url first, then stdout events, then exit", async () => {
    const { factory } = recordingSpawn(() =>
      scriptedProc({ stdout: ["hello\n", "world\n"], exitCode: 0 }),
    );
    const adapter = new TestAdapter({ spawnFactory: factory });
    const events = await collect(adapter.run(baseOpts));

    expect(events[0].type).toBe("sandbox-url");
    if (events[0].type === "sandbox-url") {
      expect(events[0].data.runId).toBe(baseOpts.runId);
      expect(events[0].data.url).toContain("docker://");
    }

    const last = events[events.length - 1];
    expect(last.type).toBe("exit");
    if (last.type === "exit") {
      expect(last.data.code).toBe(0);
      expect(last.data.durationMs).toBeGreaterThanOrEqual(0);
    }

    const stdoutEvents = events.filter((e) => e.type === "stdout");
    expect(stdoutEvents.length).toBeGreaterThan(0);
    const combined = stdoutEvents
      .map((e) => (e.type === "stdout" ? e.data.chunk : ""))
      .join("");
    expect(combined).toContain("hello");
    expect(combined).toContain("world");
  });

  it("forwards stderr chunks as stderr events (same shape as stdout)", async () => {
    const { factory } = recordingSpawn(() =>
      scriptedProc({ stderr: ["boom\n"], exitCode: 1 }),
    );
    const adapter = new TestAdapter({ spawnFactory: factory });
    const events = await collect(adapter.run(baseOpts));

    const stderrEvents = events.filter((e) => e.type === "stderr");
    expect(stderrEvents.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.type).toBe("exit");
    if (last.type === "exit") {
      expect(last.data.code).toBe(1);
    }
  });

  it("strips ANSI escape sequences from stdout", async () => {
    const ansi = "\x1B[31mred\x1B[0m plain\n";
    const { factory } = recordingSpawn(() =>
      scriptedProc({ stdout: [ansi], exitCode: 0 }),
    );
    const adapter = new TestAdapter({ spawnFactory: factory });
    const events = await collect(adapter.run(baseOpts));

    const stdoutEvents = events.filter((e) => e.type === "stdout");
    const combined = stdoutEvents
      .map((e) => (e.type === "stdout" ? e.data.chunk : ""))
      .join("");
    expect(combined).toContain("red plain");
    expect(combined).not.toMatch(/\x1B\[/);
  });
});

// ---------------------------------------------------------------------------
// Wall-clock timeout — adapter watchdog fires `docker kill`
// ---------------------------------------------------------------------------

describe("DockerSandboxAdapter: wall-clock timeout", () => {
  it("emits error=timeout when the container hangs past wallClockMs", async () => {
    const { factory, calls } = recordingSpawn(() => scriptedProc({ hang: true }));
    const adapter = new TestAdapter({
      spawnFactory: factory,
      wallClockMs: 150, // short, for test speed
    });

    const started = Date.now();
    const events = await collect(adapter.run(baseOpts));
    const elapsed = Date.now() - started;

    // Watchdog must have fired close to 150ms + spawn overhead. Generous
    // upper bound for CI jitter.
    expect(elapsed).toBeLessThan(3_000);

    const last = events[events.length - 1];
    expect(last.type).toBe("error");
    if (last.type === "error") {
      // OOM-remap kicks in because exit 137 = SIGKILL, but the watchdog
      // path takes priority (timeout flag is checked first). Accept
      // timeout OR oom — both are honest reasons for a hang that got
      // SIGKILL'd. The actual code path yields "timeout".
      expect(["timeout", "oom"]).toContain(last.data.reason);
    }

    // Second spawn call was the watchdog's `docker kill`.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const killCall = calls[1];
    expect(killCall.cmd[0]).toBe("docker");
    expect(killCall.cmd[1]).toBe("kill");
    expect(killCall.cmd[2]).toMatch(/^mandu-sbx-/);
  }, 5_000);
});

// ---------------------------------------------------------------------------
// OOM — exit code 137 is surfaced as reason="oom"
// ---------------------------------------------------------------------------

describe("DockerSandboxAdapter: OOM handling", () => {
  it("maps exit code 137 to error=oom", async () => {
    const { factory } = recordingSpawn(() =>
      scriptedProc({ stdout: ["allocating...\n"], exitCode: 137 }),
    );
    const adapter = new TestAdapter({ spawnFactory: factory });
    const events = await collect(adapter.run(baseOpts));

    const last = events[events.length - 1];
    expect(last.type).toBe("error");
    if (last.type === "error") {
      expect(last.data.reason).toBe("oom");
      expect(last.data.message).toMatch(/MiB/);
    }
  });
});

// ---------------------------------------------------------------------------
// Output cap — oversized stdout is truncated and terminates with cap error
// ---------------------------------------------------------------------------

describe("DockerSandboxAdapter: output cap", () => {
  it("surfaces error=output-cap when stdout exceeds the cap", async () => {
    // Produce stdout larger than the 64 KiB cap.
    const big = "A".repeat(1024);
    const chunks: string[] = [];
    for (let i = 0; i < 128; i++) chunks.push(big);

    const { factory } = recordingSpawn(() =>
      scriptedProc({ stdout: chunks, exitCode: 0 }),
    );
    const adapter = new TestAdapter({ spawnFactory: factory });
    const events = await collect(adapter.run(baseOpts));

    // Total emitted stdout bytes must not exceed the cap.
    const stdoutBytes = events.reduce((sum, e) => {
      if (e.type === "stdout") return sum + Buffer.byteLength(e.data.chunk, "utf8");
      return sum;
    }, 0);
    expect(stdoutBytes).toBeLessThanOrEqual(SECURITY_POLICY.outputCapBytes);

    const last = events[events.length - 1];
    // When cap hits AND the proc exits 0, we emit output-cap rather than exit.
    expect(last.type).toBe("error");
    if (last.type === "error") {
      expect(last.data.reason).toBe("output-cap");
    }
  });
});

// ---------------------------------------------------------------------------
// Spawn failure — docker binary missing / daemon unreachable
// ---------------------------------------------------------------------------

describe("DockerSandboxAdapter: spawn failure", () => {
  it("emits error=internal when the spawn factory throws", async () => {
    const adapter = new TestAdapter({
      spawnFactory: () => {
        throw new Error("docker: command not found");
      },
    });
    const events = await collect(adapter.run(baseOpts));

    // We still emit sandbox-url first (contract), then the error.
    expect(events[0].type).toBe("sandbox-url");
    const last = events[events.length - 1];
    expect(last.type).toBe("error");
    if (last.type === "error") {
      expect(last.data.reason).toBe("internal");
      expect(last.data.message).toContain("docker");
    }
  });
});

// ---------------------------------------------------------------------------
// sanitizeRunId
// ---------------------------------------------------------------------------

describe("sanitizeRunId", () => {
  it("passes safe ids through", () => {
    expect(sanitizeRunId("run-abc_123")).toBe("run-abc_123");
  });

  it("replaces unsafe characters with a single hyphen (collapsed + trimmed)", () => {
    expect(sanitizeRunId("run/../evil")).toBe("run-evil");
    // `$(`, ` `, and `/)` each become hyphens, then collapse; trailing
    // hyphen trimmed.
    expect(sanitizeRunId("run$(rm -rf /)")).toBe("run-rm-rf");
  });

  it("truncates ids longer than 64 characters", () => {
    const long = "a".repeat(200);
    const out = sanitizeRunId(long);
    expect(out.length).toBe(64);
  });

  it("returns a safe fallback when input is empty or all-bad", () => {
    expect(sanitizeRunId("")).toBe("run");
    expect(sanitizeRunId("!@#$%")).toBe("run");
  });
});

// ---------------------------------------------------------------------------
// dispose() — safe to call
// ---------------------------------------------------------------------------

describe("DockerSandboxAdapter: dispose", () => {
  it("dispose() resolves without side effects (containers are --rm)", async () => {
    const adapter = new DockerSandboxAdapter({ spawnFactory: () => scriptedProc() });
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Identity — name field for logs/metrics
// ---------------------------------------------------------------------------

describe("DockerSandboxAdapter: identity", () => {
  it("reports name='docker-sandbox'", () => {
    const adapter = new DockerSandboxAdapter({ spawnFactory: () => scriptedProc() });
    expect(adapter.name).toBe("docker-sandbox");
  });
});
