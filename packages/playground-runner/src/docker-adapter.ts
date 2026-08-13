/**
 * DockerSandboxAdapter — self-host execution backend (Phase 16.2 self-host).
 *
 * Executes user-submitted Mandu code inside an ephemeral Docker container
 * per run, providing process / filesystem / network isolation without
 * requiring Cloudflare Sandboxes. Intended for operators who want to host
 * the playground on their own Ubuntu server (`docker compose up -d`).
 *
 * **Architecture**:
 *
 *   outer container (bun run local-server.ts)
 *   └─ /var/run/docker.sock mounted (sibling spawn, *not* Docker-in-Docker)
 *      └─ Bun.spawn(['docker', 'run', ...])  <-- this file
 *         └─ ephemeral user-code container (auto-removed via --rm)
 *
 * **Security envelope** (every `docker run` invocation MUST set these):
 *
 *   --rm                         auto-remove on exit (no orphan containers)
 *   --network=none               no egress, no lateral movement
 *   --memory=256m                RAM cap (OOM → exit 137)
 *   --memory-swap=256m           disable swap (equal to memory)
 *   --cpus=0.5                   half a vCPU — caps tight loops
 *   --pids-limit=128             fork-bomb protection
 *   --read-only                  rootfs is immutable
 *   --tmpfs /tmp                 writable scratch in RAM
 *   --tmpfs /work                writable user-code dir in RAM
 *   --user=65534:65534           drop to `nobody` (no root inside container)
 *   --cap-drop=ALL               drop every Linux capability
 *   --security-opt=no-new-privs  prevent setuid escalation
 *   --stop-timeout=<30s>         graceful stop before SIGKILL
 *
 * Wall-clock timeout is enforced by an AbortController that fires
 * `docker kill <name>` at `SECURITY_POLICY.wallClockMs`. Stdout/stderr
 * output is capped at `SECURITY_POLICY.outputCapBytes` via
 * `truncateOutput` — same helper the MockAdapter uses, so the wire shape
 * is identical.
 *
 * **NOT used for tests against real Docker**. Unit tests inject a mock
 * spawn factory (`DockerAdapterOptions.spawnFactory`) so we assert the
 * `docker run` argv layout without requiring a Docker daemon in CI.
 */

import type { PlaygroundAdapter, RunOptions, SSEEvent } from "./types";
import { SECURITY_POLICY, stripAnsi, truncateOutput } from "./security";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/**
 * Minimal `Bun.spawn` subset the DockerSandboxAdapter needs. Declared as a
 * structural interface so tests can inject a mock without pulling
 * bun-types into the consumer tree.
 */
export interface DockerProcLike {
  readonly stdout?: ReadableStream<Uint8Array> | null;
  readonly stderr?: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
  kill(signal?: number | string): void;
}

export interface DockerSpawnOptions {
  cmd: string[];
  stdout?: "pipe" | "inherit" | "ignore";
  stderr?: "pipe" | "inherit" | "ignore";
  stdin?: "pipe" | "inherit" | "ignore";
  env?: Record<string, string>;
}

export type DockerSpawnFactory = (opts: DockerSpawnOptions) => DockerProcLike;

export interface DockerAdapterOptions {
  /**
   * Override the OCI image name for the ephemeral user-code container.
   * Default: `oven/bun:1.3.14-slim` (matches the outer-container image).
   * Operators can pin to a locally-built image for deterministic output.
   */
  image?: string;

  /**
   * Override for the `docker` CLI path. Defaults to `"docker"` (from PATH).
   * Operators using Podman may set `MANDU_DOCKER_BIN=podman`.
   */
  dockerBin?: string;

  /**
   * Spawn factory — defaults to `Bun.spawn`. Tests inject a mock to capture
   * the `docker run` argv and drive the async lifecycle without a daemon.
   */
  spawnFactory?: DockerSpawnFactory;

  /**
   * Host path that will be mounted read-only at `/work/index.ts` inside the
   * sandbox container. Defaults to the outer-container's `/tmp` directory,
   * which is writable and private to the outer container.
   *
   * **IMPORTANT**: When the outer container runs under Docker, paths passed
   * to `-v` are interpreted by the **host's** dockerd, not the outer
   * container's filesystem. In practice the operator bind-mounts a host
   * directory into the outer container at a predictable path (see the
   * `docker-compose.yml` for the `/tmp/mandu-playground` convention).
   */
  workHostDir?: string;

  /**
   * Override wall-clock timeout. Defaults to `SECURITY_POLICY.wallClockMs`.
   * Tests may shorten this to avoid 30s waits.
   */
  wallClockMs?: number;

  /**
   * Override memory cap (MiB). Default `SECURITY_POLICY.memoryMib` (256).
   */
  memoryMib?: number;

  /**
   * Override the CPU quota (fractional vCPU). Default 0.5. Lowering this
   * caps tight loops harder at the kernel scheduler level.
   */
  cpus?: number;

  /**
   * Override the pids-limit (max processes inside the sandbox). Default 128.
   */
  pidsLimit?: number;

  /**
   * Override the unprivileged uid:gid inside the container. Default
   * `65534:65534` (standard `nobody:nogroup`). Must match a user that
   * exists in the sandbox image — `oven/bun:1.3.14-slim` ships `nobody`.
   */
  user?: string;
}

/** Environment keys honored by {@link DockerSandboxAdapter.fromEnv}. */
export const DOCKER_ENV_KEYS = Object.freeze({
  image: "MANDU_DOCKER_SANDBOX_IMAGE",
  dockerBin: "MANDU_DOCKER_BIN",
  workHostDir: "MANDU_DOCKER_WORK_DIR",
} as const);

/** Default image — matches the outer container so no extra pull step. */
export const DEFAULT_SANDBOX_IMAGE = "oven/bun:1.3.14-slim";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class DockerSandboxAdapter implements PlaygroundAdapter {
  readonly name = "docker-sandbox" as const;

  private readonly image: string;
  private readonly dockerBin: string;
  private readonly spawn: DockerSpawnFactory;
  private readonly workHostDir: string;
  private readonly wallClockMs: number;
  private readonly memoryMib: number;
  private readonly cpus: number;
  private readonly pidsLimit: number;
  private readonly user: string;

  constructor(options: DockerAdapterOptions = {}) {
    this.image = options.image ?? DEFAULT_SANDBOX_IMAGE;
    this.dockerBin = options.dockerBin ?? "docker";
    this.spawn = options.spawnFactory ?? defaultSpawnFactory();
    this.workHostDir = options.workHostDir ?? "/tmp/mandu-playground";
    this.wallClockMs = options.wallClockMs ?? SECURITY_POLICY.wallClockMs;
    this.memoryMib = options.memoryMib ?? SECURITY_POLICY.memoryMib;
    this.cpus = options.cpus ?? 0.5;
    this.pidsLimit = options.pidsLimit ?? 128;
    this.user = options.user ?? "65534:65534";
  }

  /**
   * Construct from process.env — convenience for `selectAdapter`. Tests
   * should construct directly and pass a `spawnFactory` mock instead.
   */
  static fromEnv(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): DockerSandboxAdapter {
    return new DockerSandboxAdapter({
      image: env[DOCKER_ENV_KEYS.image],
      dockerBin: env[DOCKER_ENV_KEYS.dockerBin],
      workHostDir: env[DOCKER_ENV_KEYS.workHostDir],
    });
  }

  /**
   * Build the full `docker run` argv used for a single run. Exposed as a
   * method (not a free function) so tests can instantiate an adapter and
   * assert the flags without calling `run()`.
   *
   * @param containerName  unique name so we can `docker kill <name>` on timeout.
   * @param codeHostPath   absolute path on the host that contains the user
   *                       code file; mounted read-only at `/work/index.ts`.
   */
  buildDockerArgs(containerName: string, codeHostPath: string, opts: RunOptions): string[] {
    return [
      "run",
      "--rm",
      "--name",
      containerName,
      "--network=none",
      `--memory=${this.memoryMib}m`,
      `--memory-swap=${this.memoryMib}m`,
      `--cpus=${this.cpus}`,
      `--pids-limit=${this.pidsLimit}`,
      "--read-only",
      "--tmpfs",
      "/tmp:rw,size=64m,mode=1777",
      "--tmpfs",
      "/work:rw,size=8m,mode=0755",
      "--user",
      this.user,
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      `--stop-timeout=${Math.ceil(this.wallClockMs / 1000)}`,
      "--workdir=/work",
      // User code bind-mount — read-only, target file is the single entry.
      "-v",
      `${codeHostPath}:/work/index.ts:ro`,
      // Environment — mirrors MockAdapter for wire-shape parity.
      "--env",
      `MANDU_PLAYGROUND_RUN_ID=${opts.runId}`,
      "--env",
      `MANDU_PLAYGROUND_EXAMPLE=${opts.example}`,
      // Suppress any accidental color output from Bun itself — we strip
      // ANSI downstream but this is belt-and-suspenders.
      "--env",
      "NO_COLOR=1",
      this.image,
      "bun",
      "run",
      "/work/index.ts",
    ];
  }

  async *run(opts: RunOptions): AsyncIterable<SSEEvent> {
    const startedAt = Date.now();
    const containerName = `mandu-sbx-${sanitizeRunId(opts.runId)}`;
    const codeHostPath = await this.stageUserCode(opts);

    // Front-end contract: emit sandbox-url first. Self-host deployments
    // don't expose a live user-app URL (the container has --network=none),
    // so we return a deterministic `docker://` scheme the front-end can
    // display as "running in local sandbox" without trying to iframe it.
    yield {
      type: "sandbox-url",
      data: {
        url: `docker://${containerName}`,
        runId: opts.runId,
      },
    };

    const argv = this.buildDockerArgs(containerName, codeHostPath, opts);

    let proc: DockerProcLike;
    try {
      proc = this.spawn({
        cmd: [this.dockerBin, ...argv],
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: (process.env.PATH as string | undefined) ?? "",
        },
      });
    } catch (err) {
      yield {
        type: "error",
        data: {
          reason: "internal",
          message:
            err instanceof Error
              ? `docker spawn failed: ${err.message}`
              : "docker spawn failed",
        },
      };
      return;
    }

    // Wall-clock watchdog — on expiry we `docker kill <name>` so the
    // container goes down even if `bun` ignored SIGTERM.
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      this.forceKill(containerName);
      try {
        proc.kill("SIGKILL");
      } catch {
        // already exited
      }
    }, this.wallClockMs);

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

      const results = await Promise.all(streams);
      for (const events of results) {
        for (const ev of events) yield ev;
      }

      const exitCode = await proc.exited;

      if (timedOut) {
        yield {
          type: "error",
          data: {
            reason: "timeout",
            message: `exceeded ${this.wallClockMs}ms wall-clock`,
          },
        };
      } else if (exitCode === 137) {
        // Docker maps OOM kill to 128 + SIGKILL(9) = 137. Surface as OOM
        // rather than internal so the front-end can show the right copy.
        yield {
          type: "error",
          data: {
            reason: "oom",
            message: `container OOM-killed at ${this.memoryMib} MiB`,
          },
        };
      } else if (capped) {
        yield {
          type: "error",
          data: {
            reason: "output-cap",
            message: `output exceeded ${SECURITY_POLICY.outputCapBytes} bytes`,
          },
        };
      } else {
        yield {
          type: "exit",
          data: {
            code: exitCode ?? 0,
            durationMs: Date.now() - startedAt,
          },
        };
      }
    } catch (err) {
      yield {
        type: "error",
        data: {
          reason: "internal",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      clearTimeout(watchdog);
      // Clean up the staged code file so repeated runs don't fill tmpfs.
      await this.unstageUserCode(codeHostPath);
    }
  }

  async dispose(): Promise<void> {
    // Ephemeral containers auto-remove via `--rm`. Nothing to drain here.
  }

  /**
   * Write user code to a unique file on the host so we can bind-mount it
   * into the sandbox container. Default implementation uses `Bun.write`;
   * tests override via subclass or by stubbing `stageUserCode` on an
   * instance.
   */
  protected async stageUserCode(opts: RunOptions): Promise<string> {
    const filename = `${this.workHostDir}/code-${sanitizeRunId(opts.runId)}.ts`;
    try {
      // Late import so the type surface of this module is clean for tests
      // that never touch the filesystem.
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(this.workHostDir, { recursive: true });
      await writeFile(filename, opts.code, { encoding: "utf8", mode: 0o644 });
    } catch (err) {
      throw new Error(
        `DockerSandboxAdapter: failed to stage user code at ${filename}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err }
      );
    }
    return filename;
  }

  protected async unstageUserCode(path: string): Promise<void> {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(path);
    } catch {
      // Best-effort cleanup — the container is gone regardless.
    }
  }

  /**
   * Force-kill the named container via `docker kill`. Fire-and-forget:
   * if the container has already exited Docker returns a nonzero status
   * which we ignore — the outer process will observe `exited`.
   */
  private forceKill(containerName: string): void {
    try {
      const killer = this.spawn({
        cmd: [this.dockerBin, "kill", containerName],
        stdout: "ignore",
        stderr: "ignore",
      });
      // Do not await — we're in the watchdog path, main loop is still
      // awaiting proc.exited.
      void killer.exited.catch(() => {
        // Swallow — docker kill on a missing container is expected when
        // the process already exited between watchdog firing and kill.
      });
    } catch {
      // Swallow spawn errors — the container will eventually be reaped.
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Restrict run ids to `[A-Za-z0-9_-]` for use as a docker container name.
 * Docker rejects names with special characters; we sanitize defensively.
 *
 * Behavior:
 *   - Consecutive unsafe chars collapse to a single hyphen
 *   - Leading/trailing hyphens are trimmed (docker requires `[a-zA-Z0-9]`
 *     as the first character anyway)
 *   - Result is capped at 64 chars — well under dockerd's 253-char limit
 *   - Empty / all-unsafe input falls back to the literal "run"
 */
export function sanitizeRunId(runId: string): string {
  const cleaned = runId
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "run";
}

/**
 * Default spawn factory — wraps `Bun.spawn`. Extracted so tests can
 * substitute a stub that records the argv without needing a real Bun
 * runtime feature (we always run on Bun, but isolating the call site
 * keeps the unit tests deterministic).
 */
function defaultSpawnFactory(): DockerSpawnFactory {
  return (opts: DockerSpawnOptions) => {
    const Bun = (globalThis as unknown as { Bun?: { spawn: (opts: DockerSpawnOptions) => DockerProcLike } }).Bun;
    if (!Bun || typeof Bun.spawn !== "function") {
      throw new Error(
        "DockerSandboxAdapter requires the Bun runtime (Bun.spawn). " +
          "Run the outer container via `bun run src/local-server.ts` or " +
          "inject a spawnFactory for tests."
      );
    }
    return Bun.spawn(opts);
  };
}

/**
 * Drain a ReadableStream<Uint8Array> into SSE events — identical contract
 * to the MockAdapter's helper but reused here for wire parity.
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
