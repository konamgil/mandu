import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface ManagedServerOptions {
  /** Shell command to start dev/prod server (e.g. "bun run dev"). */
  command: string;
  cwd: string;
  env?: Record<string, string | undefined>;

  /** Base URL for health check (e.g. http://localhost:3333). */
  baseURL: string;
  /** Health endpoint path (default: /api/health). */
  healthPath?: string;
  /** Total time to wait for readiness (ms). */
  readyTimeoutMs?: number;
  /** Per-request timeout (ms). */
  requestTimeoutMs?: number;

  /** Where to write server stdout/stderr log. */
  logPath?: string;
}

export interface ManagedServerHandle {
  baseURL: string;
  pid?: number;
  /** Stop the server (best-effort; no SIGKILL). */
  stop: () => Promise<void>;
}

function withDefault<T>(v: T | undefined, d: T): T {
  return v === undefined ? d : v;
}

async function waitForHealth(baseURL: string, healthPath: string, timeoutMs: number, requestTimeoutMs: number): Promise<void> {
  const url = new URL(healthPath, baseURL).toString();
  const started = Date.now();
  let lastErr: unknown;

  while (Date.now() - started < timeoutMs) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), requestTimeoutMs);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return;
      lastErr = new Error(`Healthcheck not ok: ${res.status} ${res.statusText}`);
    } catch (e) {
      lastErr = e;
    }
    await delay(400);
  }

  const err = new Error(`Server did not become ready within ${timeoutMs}ms: ${url}`);
  (err as any).cause = lastErr;
  throw err;
}

async function gracefulStop(child: ChildProcess, timeouts = { sigintMs: 8000, sigtermMs: 6000 }): Promise<void> {
  if (child.exitCode !== null || child.killed) return;

  const waitExit = (ms: number) =>
    Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      delay(ms).then(() => {
        throw new Error("timeout");
      }),
    ]);

  // 1) SIGINT
  try {
    child.kill("SIGINT");
    await waitExit(timeouts.sigintMs);
    return;
  } catch {}

  // 2) SIGTERM
  try {
    child.kill("SIGTERM");
    await waitExit(timeouts.sigtermMs);
  } catch {
    // No SIGKILL (kill -9) by policy. Best-effort stop only.
  }
}

/**
 * Start a server process, wait until healthcheck passes, and provide a stop() handle.
 */
export async function startManagedServer(opts: ManagedServerOptions): Promise<ManagedServerHandle> {
  const healthPath = withDefault(opts.healthPath, "/api/health");
  const readyTimeoutMs = withDefault(opts.readyTimeoutMs, 60_000);
  const requestTimeoutMs = withDefault(opts.requestTimeoutMs, 2_000);

  let logStream: ReturnType<typeof createWriteStream> | undefined;
  if (opts.logPath) {
    mkdirSync(dirname(opts.logPath), { recursive: true });
    logStream = createWriteStream(opts.logPath, { flags: "a" });
  }

  const child = spawn(opts.command, {
    cwd: opts.cwd,
    shell: true,
    env: {
      ...process.env,
      ...opts.env,
    } as any,
    stdio: logStream ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (logStream && child.stdout && child.stderr) {
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
  }

  try {
    await waitForHealth(opts.baseURL, healthPath, readyTimeoutMs, requestTimeoutMs);
  } catch (e) {
    // If readiness fails, attempt to stop before bubbling.
    await gracefulStop(child).catch(() => undefined);
    throw e;
  }

  return {
    baseURL: opts.baseURL,
    pid: child.pid,
    stop: async () => {
      await gracefulStop(child);
      logStream?.end();
    },
  };
}
