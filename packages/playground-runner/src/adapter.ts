/**
 * Playground execution adapters.
 *
 * Three implementations:
 *  1. {@link CloudflareSandboxAdapter} — production. Talks to the CF
 *     Sandboxes SDK (Phase 16.2 live). NEVER instantiated in tests.
 *  2. {@link FlyMachineAdapter} — fallback if CF pricing tightens or
 *     egress rules change. STUB — TODO before enabling.
 *  3. {@link MockAdapter} — local dev + CI. Uses `Bun.spawn` inside the
 *     test process. No network, no sandbox, no CF account required.
 *
 * Selection is done by {@link selectAdapter} based on environment.
 *
 * **Hard contract**: production adapters MUST NOT be imported by tests.
 * `worker.ts` selects the adapter by reading `env.ADAPTER_MODE`; in CI we
 * set it to `"mock"`.
 */

import type { PlaygroundAdapter, RunOptions, SSEEvent, WorkerBindings } from "./types";
import { SECURITY_POLICY, stripAnsi, truncateOutput } from "./security";
import { DockerSandboxAdapter } from "./docker-adapter";

// -----------------------------------------------------------------------------
// Mock adapter — used by unit + integration tests. NO network access.
// -----------------------------------------------------------------------------

/**
 * Mock execution backend that runs user code locally in-process via
 * `Bun.spawn`. Used for:
 *  - CI integration test (`tests/mock-flow.test.ts`)
 *  - Local `wrangler dev` when `ADAPTER_MODE=mock`
 *  - Any developer that doesn't have a CF account
 *
 * **Security note**: The mock adapter runs code on the developer's
 * machine. It's NOT hardened for untrusted input. Never expose the
 * MockAdapter to a public network. The real CloudflareSandboxAdapter
 * provides isolation.
 */
export class MockAdapter implements PlaygroundAdapter {
  readonly name = "mock" as const;

  /**
   * Optional script override — tests inject a deterministic script to
   * exercise timeout / output-cap / OOM paths without real compilation.
   */
  constructor(private readonly options: MockAdapterOptions = {}) {}

  async *run(opts: RunOptions): AsyncIterable<SSEEvent> {
    const { wallClockMs, outputCapBytes } = SECURITY_POLICY;
    const startedAt = Date.now();

    // Fake sandbox URL — front-end still renders an iframe shell.
    yield {
      type: "sandbox-url",
      data: {
        url: `mock://sbx-${opts.runId}.localhost`,
        runId: opts.runId,
      },
    };

    // We purposefully do NOT write user code to disk — the test doubles
    // are driven by `options.script`. Passing user code to Bun.spawn
    // would run arbitrary TSX in the test process.
    const script = this.options.script ?? defaultMockScript(opts);

    // Bun.spawn signature differs slightly; we cast to avoid pulling
    // bun-types into consumers. The test env guarantees Bun >= 1.3.12.
    const proc: MockProcLike = (globalThis as unknown as { Bun: MockBunLike }).Bun.spawn({
      cmd: ["bun", "-e", script],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "",
        MANDU_PLAYGROUND_RUN_ID: opts.runId,
        MANDU_PLAYGROUND_EXAMPLE: opts.example,
      },
    });

    // Wall-clock abort. The Sandbox SDK has its own `AbortSignal.timeout`;
    // in MockAdapter we implement the same semantics so the integration
    // test can assert timeout behavior without a real container.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill?.();
      } catch {
        // proc may have already exited.
      }
    }, wallClockMs);

    let outTotal = 0;
    let errTotal = 0;
    let capped = false;

    try {
      const streams: Array<Promise<SSEEvent[]>> = [];
      if (proc.stdout) {
        streams.push(
          drainStream(proc.stdout, "stdout", (chunk) => {
            const res = truncateOutput(outTotal, stripAnsi(chunk));
            outTotal = res.newTotal;
            if (res.truncated) capped = true;
            return res.chunk;
          })
        );
      }
      if (proc.stderr) {
        streams.push(
          drainStream(proc.stderr, "stderr", (chunk) => {
            const res = truncateOutput(errTotal, stripAnsi(chunk));
            errTotal = res.newTotal;
            if (res.truncated) capped = true;
            return res.chunk;
          })
        );
      }

      // Yield events as they arrive. We collect per-stream arrays rather
      // than multiplexing because the mock's chunks are small; in the
      // real adapter we'd use a ReadableStream tee.
      const results = await Promise.all(streams);
      for (const events of results) {
        for (const event of events) yield event;
      }

      const exitCode = await proc.exited;

      if (timedOut) {
        yield {
          type: "error",
          data: { reason: "timeout", message: `exceeded ${wallClockMs}ms wall-clock` },
        };
      } else if (capped) {
        yield {
          type: "error",
          data: { reason: "output-cap", message: `output exceeded ${outputCapBytes} bytes` },
        };
      } else {
        yield {
          type: "exit",
          data: { code: exitCode ?? 0, durationMs: Date.now() - startedAt },
        };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async dispose(): Promise<void> {
    // No-op — Bun.spawn cleans itself up.
  }
}

export interface MockAdapterOptions {
  /**
   * Test hook: replace the script the mock spawns. Defaults to a harmless
   * `console.log` so local dev yields non-empty output.
   */
  script?: string;
}

// -----------------------------------------------------------------------------
// Cloudflare Sandbox adapter — production. NEVER imported by tests.
// -----------------------------------------------------------------------------

/**
 * Real execution backend: Cloudflare Sandboxes SDK.
 *
 * This class lives behind {@link selectAdapter} and is instantiated ONLY
 * when `env.ADAPTER_MODE === "cloudflare"`. Tests set `ADAPTER_MODE=mock`
 * and this code path is never taken — that's the boundary that keeps the
 * test suite offline.
 *
 * **Wiring plan** (Phase 16.2 live):
 *   1. Operator runs `wrangler deploy` with `wrangler.toml` from template.
 *   2. `env.SANDBOX` binding is populated by the Containers runtime.
 *   3. Worker instantiates `new CloudflareSandboxAdapter(env.SANDBOX)`.
 *   4. Per run: `sandbox.writeFile("/work/page.tsx", code)` →
 *      `sandbox.exec("bun run /vendor/mandu-test-runner.ts",
 *      { timeout: wallClockMs })` → stream stdout/stderr.
 *   5. Egress intercept: outbound proxy checks {@link isAllowedEgress}.
 *
 * The actual SDK call sites are TODO placeholders — we're not importing
 * `@cloudflare/sandbox` at runtime because bundling CF-specific deps into
 * the npm package would break `bun test`. The operator's `wrangler deploy`
 * step (not tested in CI) pulls the SDK.
 */
export class CloudflareSandboxAdapter implements PlaygroundAdapter {
  readonly name = "cloudflare-sandbox" as const;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly sandboxBinding: any) {
    if (!sandboxBinding) {
      throw new Error(
        "CloudflareSandboxAdapter requires a sandbox binding. " +
          "Configure `[[containers]]` in wrangler.toml — see " +
          "docs/playground/deployment.md §3."
      );
    }
  }

  async *run(_opts: RunOptions): AsyncIterable<SSEEvent> {
    // TODO(phase-16.2-live): Actual CF SDK wiring.
    // The SDK shape (per 2026-04-13 GA release):
    //
    //   const sandbox = this.sandboxBinding.get("playground");
    //   await sandbox.writeFile("/work/page.tsx", _opts.code);
    //   const { stdout, stderr, exitCode } = await sandbox.exec(
    //     "bun run /vendor/mandu-test-runner.ts",
    //     {
    //       cwd: "/work",
    //       timeout: SECURITY_POLICY.wallClockMs,
    //       env: { MANDU_PLAYGROUND_RUN_ID: _opts.runId },
    //     }
    //   );
    //   const proxyUrl = await sandbox.proxyToSandbox(...);
    //   yield { type: "sandbox-url", data: { url: proxyUrl, runId: _opts.runId } };
    //   for await (const chunk of stdout) {
    //     const res = truncateOutput(outTotal, stripAnsi(chunk));
    //     ...
    //   }
    //
    // Until the live wiring lands, this adapter throws loudly — which is
    // correct: if someone deploys without finishing the wiring, they
    // should see an error, not a silent fallback.
    throw new Error(
      "CloudflareSandboxAdapter is a scaffold. " +
        "Complete the SDK wiring in Phase 16.2-live before deploying. " +
        "See docs/playground/deployment.md."
    );
    // Unreachable — present so the compiler/linter treats this as a
    // generator even though every invocation throws synchronously on
    // the first `next()`. Removing it flips `require-yield` to error.
    yield undefined as never;
  }

  async dispose(): Promise<void> {
    // TODO(phase-16.2-live): Drain pooled sandboxes.
  }
}

// -----------------------------------------------------------------------------
// Fly.io Machine adapter — fallback. STUB.
// -----------------------------------------------------------------------------

/**
 * Fly.io Machines fallback. Tracked as D16-B fallback in the Phase 16 R0
 * document. Activated only if:
 *  - Cloudflare Sandboxes pricing diverges significantly from the $8/mo
 *    model, OR
 *  - CF egress rules block a user primitive we need (e.g. outbound DB).
 *
 * **STUB** — not implemented. We keep the class so `selectAdapter` has a
 * type-safe "fly" branch and the interface surface is explicit.
 */
export class FlyMachineAdapter implements PlaygroundAdapter {
  readonly name = "fly-machine" as const;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(_config: { apiToken: string; appName: string; region?: string }) {
    // TODO(phase-16.2-fallback): Build out fly-machines control-plane integration.
    // Required pieces:
    //  - POST /v1/apps/<app>/machines (spawn with image)
    //  - Wait for state=started
    //  - exec via `fly machine exec` or SSH
    //  - Stream stdout back through a WS relay (fly doesn't have SSE native)
    //  - Kill on timeout
    //  - Recycle idle machines after 60s
  }

  async *run(_opts: RunOptions): AsyncIterable<SSEEvent> {
    yield {
      type: "error",
      data: {
        reason: "internal",
        message:
          "FlyMachineAdapter not yet implemented — see docs/playground/deployment.md §5",
      },
    };
  }
}

// -----------------------------------------------------------------------------
// Adapter selection
// -----------------------------------------------------------------------------

/**
 * Pick the adapter appropriate for the current environment. The Worker
 * entrypoint calls this once per request.
 *
 * Selection logic:
 *  - `env.ADAPTER_MODE === "mock"`   → MockAdapter (dev + CI)
 *  - `env.ADAPTER_MODE === "docker"` → DockerSandboxAdapter (self-host)
 *  - `env.ADAPTER_MODE === "fly"`    → FlyMachineAdapter (stubbed, errors)
 *  - default                         → CloudflareSandboxAdapter (prod CF)
 *
 * **Self-host detection**: in addition to explicit `ADAPTER_MODE`, the
 * host process may also set `MANDU_PLAYGROUND_ADAPTER=docker` on the
 * ambient `process.env` — this is the path used by the Docker Compose
 * stack. The Worker-side `env.ADAPTER_MODE` still wins if provided so
 * CF operators can override per-deploy.
 */
export function selectAdapter(env: WorkerBindings): PlaygroundAdapter {
  const mode = resolveAdapterMode(env);
  switch (mode) {
    case "mock":
      return new MockAdapter();
    case "docker":
      return DockerSandboxAdapter.fromEnv();
    case "fly":
      return new FlyMachineAdapter({
        apiToken: "",
        appName: "mandu-playground",
      });
    case "cloudflare":
    default:
      return new CloudflareSandboxAdapter(env.SANDBOX);
  }
}

/**
 * Resolve the adapter mode using (in priority order):
 *   1. explicit `env.ADAPTER_MODE` (Worker binding)
 *   2. ambient `process.env.MANDU_PLAYGROUND_ADAPTER` (self-host, local-server)
 *   3. fallback to `"cloudflare"` (default production CF Worker path)
 *
 * Exposed so `local-server.ts` can reuse the exact same resolution.
 */
export function resolveAdapterMode(
  env: WorkerBindings,
  processEnv: Record<string, string | undefined> = (typeof process !== "undefined"
    ? (process.env as Record<string, string | undefined>)
    : {}),
): NonNullable<WorkerBindings["ADAPTER_MODE"]> {
  if (env.ADAPTER_MODE) return env.ADAPTER_MODE;
  const ambient = processEnv.MANDU_PLAYGROUND_ADAPTER;
  if (ambient === "mock" || ambient === "docker" || ambient === "fly" || ambient === "cloudflare") {
    return ambient;
  }
  return "cloudflare";
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** A minimal `Bun.spawn` subset type used by MockAdapter. */
interface MockProcLike {
  stdout?: ReadableStream<Uint8Array> | null;
  stderr?: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill?(): void;
}

interface MockBunLike {
  spawn(opts: {
    cmd: string[];
    stdout?: string;
    stderr?: string;
    env?: Record<string, string>;
  }): MockProcLike;
}

/**
 * Drain a ReadableStream of bytes into SSE events. Runs the provided
 * shaping function on every chunk — callers use it for ANSI stripping
 * + output-cap truncation.
 */
async function drainStream(
  stream: ReadableStream<Uint8Array>,
  kind: "stdout" | "stderr",
  shape: (chunk: string) => string
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const raw = decoder.decode(value, { stream: true });
      const shaped = shape(raw);
      if (shaped.length > 0) {
        events.push({ type: kind, data: { chunk: shaped } });
      }
    }
    // Flush any remaining bytes from the decoder.
    const tail = decoder.decode();
    if (tail.length > 0) {
      const shaped = shape(tail);
      if (shaped.length > 0) {
        events.push({ type: kind, data: { chunk: shaped } });
      }
    }
  } finally {
    reader.releaseLock();
  }
  return events;
}

/**
 * Default mock script — prints a harmless banner so that `bun test`
 * without `options.script` produces deterministic, bounded output.
 */
function defaultMockScript(opts: RunOptions): string {
  // We deliberately DO NOT interpolate user code. The mock adapter never
  // runs user-submitted TSX — it only runs this canned script.
  return `
    const runId = process.env.MANDU_PLAYGROUND_RUN_ID;
    const example = process.env.MANDU_PLAYGROUND_EXAMPLE;
    process.stdout.write(\`[mock] run=\${runId} example=\${example}\\n\`);
    process.stdout.write("[mock] hello from the playground sandbox\\n");
  `.trim();
}
