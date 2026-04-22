/**
 * Mandu MCP - Project Tools
 *
 * - mandu.project.init: Create a new Mandu project (init + optional install)
 * - mandu.dev.start: Start dev server
 * - mandu.dev.stop: Stop dev server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ActivityMonitor } from "../activity-monitor.js";
import { spawn, type Subprocess } from "bun";
import { execSync } from "child_process";
import { createConnection } from "node:net";
import path from "path";
import fs from "fs/promises";

/**
 * Issue #237 Concern 3 — read `server.port` from `mandu.config.*` so
 * `mandu.dev.start` can poll a deterministic port instead of timing
 * out while scraping stdout. Returns `null` if the config is absent
 * or doesn't explicitly set `server.port` (callers fall back to 3333,
 * Mandu's documented default). We use the un-schema'd raw loader
 * (`loadManduConfig`) so the schema's fill-in default doesn't mask a
 * missing value — a user who set no port should poll 3333, not the
 * schema's internal default.
 *
 * We intentionally catch every error — a brittle config reader here
 * must never block dev_start. The polling path still proves liveness.
 */
export async function readConfiguredServerPort(
  cwd: string,
): Promise<number | null> {
  try {
    const core = await import("@mandujs/core");
    const raw = await core.loadManduConfig(cwd);
    const port = raw?.server?.port;
    if (typeof port === "number" && Number.isFinite(port) && port > 0) {
      return port;
    }
  } catch {
    /* ignore — fall back to default */
  }
  return null;
}

/**
 * Issue #237 Concern 3 — TCP connect probe. Resolves `true` on the
 * first successful `connect`, `false` on any error or timeout.
 * `node:net` is Node builtin and ships with Bun; no new dependency.
 */
export function probeTcpPort(
  port: number,
  hostname: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: hostname, port });
    const done = (ok: boolean) => {
      try {
        sock.destroy();
      } catch {
        /* noop */
      }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

/**
 * Issue #237 Concern 3 — poll the configured port at a fixed interval
 * until `waitMs` elapses. Returns the port on success, `null` on
 * timeout. The caller chooses whether to fall back to the stdout
 * scrape or report `port: <polled>` alongside the timeout message.
 */
export async function pollServerPort(
  port: number,
  hostname: string,
  waitMs: number,
  intervalMs = 200,
): Promise<number | null> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const probeTimeout = Math.min(500, Math.max(50, remaining));
    if (await probeTcpPort(port, hostname, probeTimeout)) {
      return port;
    }
    const sleep = Math.min(intervalMs, Math.max(0, deadline - Date.now()));
    if (sleep > 0) {
      await new Promise((r) => setTimeout(r, sleep));
    }
  }
  return null;
}

type DevServerState = {
  process: Subprocess;
  cwd: string;
  startedAt: Date;
  output: string[];
  maxLines: number;
};

let devServerState: DevServerState | null = null;
let devServerStarting = false;

/**
 * Get the current dev server state.
 * Used by other tools (e.g. kitchen) to discover the running server's port/output.
 */
export function getDevServerState(): { cwd: string; output: string[]; startedAt: Date } | null {
  if (!devServerState) return null;
  return {
    cwd: devServerState.cwd,
    output: [...devServerState.output],
    startedAt: devServerState.startedAt,
  };
}

function trimOutput(text: string, maxChars: number = 4000): string {
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}

const COMMAND_TIMEOUT_MS = 120_000; // 2 minutes

async function runCommand(cmd: string[], cwd: string, timeoutMs: number = COMMAND_TIMEOUT_MS) {
  const proc = spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${cmd.join(" ")}`));
    }, timeoutMs)
  );

  const [stdout, stderr, exitCode] = await Promise.race([
    Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]),
    timeoutPromise,
  ]);

  return {
    exitCode,
    stdout,
    stderr,
  };
}

async function consumeStream(
  stream: ReadableStream<Uint8Array> | null,
  state: DevServerState,
  label: "stdout" | "stderr",
  server?: Server
) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      const entry = `[${label}] ${text}`;
      state.output.push(entry);
      if (state.output.length > state.maxLines) {
        state.output.shift();
      }

      if (server) {
        server.sendLoggingMessage({
          level: label === "stderr" ? "warning" : "info",
          logger: "mandu-dev",
          data: {
            type: "dev_log",
            stream: label,
            message: text,
          },
        }).catch(() => {});
      }
    }
  }

  if (buffer.trim()) {
    const entry = `[${label}] ${buffer.trim()}`;
    state.output.push(entry);
    if (state.output.length > state.maxLines) {
      state.output.shift();
    }
  }
}

export const projectToolDefinitions: Tool[] = [
  {
    name: "mandu.project.init",
    description:
      "Initialize a new Mandu project (runs `mandu init` and optionally `bun install`).",
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Project name (directory name)",
        },
        parentDir: {
          type: "string",
          description: "Parent directory to create the project in (default: cwd)",
        },
        css: {
          type: "string",
          enum: ["tailwind", "panda", "none"],
          description: "CSS framework (default: tailwind)",
        },
        ui: {
          type: "string",
          enum: ["shadcn", "ark", "none"],
          description: "UI library (default: shadcn)",
        },
        theme: {
          type: "boolean",
          description: "Enable dark mode theme system",
        },
        minimal: {
          type: "boolean",
          description: "Create minimal template (no CSS/UI)",
        },
        install: {
          type: "boolean",
          description: "Run bun install after init (default: true)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "mandu.dev.start",
    description:
      "Start Mandu dev server (bun run dev). Issue #237 — polls server.port from " +
      "mandu.config.ts (fallback 3333) via TCP connect for up to waitMs (default 15s) " +
      "before declaring a port-detection timeout. On success: { port, url, message }. " +
      "On timeout: still returns { port: <polled>, message } so callers can retry / probe.",
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Project directory to run dev server in (default: current project)",
        },
        waitMs: {
          type: "number",
          description:
            "How long (ms) to wait for the dev server to accept TCP connections on " +
            "the configured port. Default 15000 (15s).",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.dev.stop",
    description: "Stop Mandu dev server if running.",
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export function projectTools(projectRoot: string, server?: Server, monitor?: ActivityMonitor) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.project.init": async (args: Record<string, unknown>) => {
      const {
        name,
        parentDir,
        css,
        ui,
        theme,
        minimal,
        install = true,
      } = args as {
        name: string;
        parentDir?: string;
        css?: "tailwind" | "panda" | "none";
        ui?: "shadcn" | "ark" | "none";
        theme?: boolean;
        minimal?: boolean;
        install?: boolean;
      };

      const baseDir = parentDir
        ? path.resolve(projectRoot, parentDir)
        : projectRoot;

      await fs.mkdir(baseDir, { recursive: true });

      // Runtime whitelist validation for spawn arguments
      const VALID_CSS = ["tailwind", "panda", "none"];
      const VALID_UI = ["shadcn", "ark", "none"];
      if (css !== undefined && !VALID_CSS.includes(css)) {
        return { success: false, error: `Invalid css value: ${css}. Must be one of: ${VALID_CSS.join(", ")}` };
      }
      if (ui !== undefined && !VALID_UI.includes(ui)) {
        return { success: false, error: `Invalid ui value: ${ui}. Must be one of: ${VALID_UI.join(", ")}` };
      }

      const initArgs = ["@mandujs/cli", "init", name];
      if (minimal) {
        initArgs.push("--minimal");
      } else {
        if (css) initArgs.push("--css", css);
        if (ui) initArgs.push("--ui", ui);
        if (theme) initArgs.push("--theme");
      }

      let initResult: { exitCode: number | null; stdout: string; stderr: string };
      try {
        initResult = await runCommand(["bunx", ...initArgs], baseDir);
      } catch (err) {
        return {
          success: false,
          step: "init",
          error: err instanceof Error ? err.message : String(err),
        };
      }
      if (initResult.exitCode !== 0) {
        return {
          success: false,
          step: "init",
          exitCode: initResult.exitCode,
          stdout: trimOutput(initResult.stdout),
          stderr: trimOutput(initResult.stderr),
        };
      }

      const projectDir = path.join(baseDir, name);

      let installResult: { exitCode: number | null; stdout: string; stderr: string } | null = null;
      if (install !== false) {
        try {
          installResult = await runCommand(["bun", "install"], projectDir);
        } catch (err) {
          return {
            success: false,
            step: "install",
            projectDir,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        if (installResult.exitCode !== 0) {
          return {
            success: false,
            step: "install",
            projectDir,
            exitCode: installResult.exitCode,
            stdout: trimOutput(installResult.stdout),
            stderr: trimOutput(installResult.stderr),
          };
        }
      }

      return {
        success: true,
        projectDir,
        installed: install !== false,
        init: {
          exitCode: initResult.exitCode,
          stdout: trimOutput(initResult.stdout),
          stderr: trimOutput(initResult.stderr),
        },
        install: installResult
          ? {
              exitCode: installResult.exitCode,
              stdout: trimOutput(installResult.stdout),
              stderr: trimOutput(installResult.stderr),
            }
          : null,
        next: install !== false
          ? ["cd " + name, "bun run dev"]
          : ["cd " + name, "bun install", "bun run dev"],
      };
    },

    "mandu.dev.start": async (args: Record<string, unknown>) => {
      const { cwd, waitMs } = args as { cwd?: string; waitMs?: number };
      if (devServerState || devServerStarting) {
        return {
          success: false,
          message: devServerStarting
            ? "Dev server is starting up, please wait"
            : "Dev server is already running",
          pid: devServerState?.process.pid,
          cwd: devServerState?.cwd,
        };
      }

      devServerStarting = true;
      try {
        const targetDir = cwd ? path.resolve(projectRoot, cwd) : projectRoot;

        // Issue #237 Concern 3 — read `server.port` from mandu.config.*
        // so we can poll a deterministic port instead of racing a
        // regex against stdout. The env override takes precedence (it
        // also takes precedence in the CLI — see cli/commands/dev.ts).
        // Fall back to 3333 (Mandu's default) when neither is set.
        const envPort = process.env.PORT ? Number(process.env.PORT) : null;
        const configPort =
          envPort && Number.isFinite(envPort)
            ? envPort
            : await readConfiguredServerPort(targetDir);
        const polledPort = configPort ?? 3333;
        const pollWaitMs =
          typeof waitMs === "number" && Number.isFinite(waitMs) && waitMs > 0
            ? waitMs
            : 15_000;

        const proc = spawn(["bun", "run", "dev"], {
          cwd: targetDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
        });

        const state: DevServerState = {
          process: proc,
          cwd: targetDir,
          startedAt: new Date(),
          output: [],
          maxLines: 50,
        };
        devServerState = state;

        consumeStream(proc.stdout, state, "stdout", server).catch(() => {});
        consumeStream(proc.stderr, state, "stderr", server).catch(() => {});

        proc.exited.then(() => {
          if (devServerState?.process === proc) {
            devServerState = null;
          }
        }).catch(() => {});

        if (monitor) {
          monitor.logEvent("dev", `Dev server started (${targetDir})`);
        }

        // Issue #237 Concern 3 — TCP poll the expected port. 127.0.0.1
        // matches what the CLI prints; dual-stack (`::`) binds accept
        // loopback v4 connects. We use 127.0.0.1 because `localhost`
        // resolution varies across Windows + macOS.
        const detectedPort = await pollServerPort(
          polledPort,
          "127.0.0.1",
          pollWaitMs,
        );

        const url = detectedPort ? `http://localhost:${detectedPort}` : null;

        return {
          success: true,
          pid: proc.pid,
          port: detectedPort ?? polledPort,
          url,
          cwd: targetDir,
          startedAt: state.startedAt.toISOString(),
          message: detectedPort
            ? `Dev server ready at http://localhost:${detectedPort}`
            : `Dev server started (port detection timed out after ${pollWaitMs}ms polling ${polledPort})`,
        };
      } finally {
        devServerStarting = false;
      }
    },

    "mandu.dev.stop": async () => {
      if (!devServerState) {
        return {
          success: false,
          message: "Dev server is not running",
        };
      }

      const { process: proc, cwd, output } = devServerState;
      const pid = proc.pid;
      devServerState = null;

      // Kill the entire process tree to prevent zombie processes
      try {
        if (pid) {
          if (process.platform === "win32") {
            // Windows: taskkill /T kills the process tree, /F forces termination
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
          } else {
            // Unix: kill the entire process group (negative PID)
            try {
              process.kill(-pid, "SIGKILL");
            } catch {
              // Fallback: kill just the process if process group kill fails
              proc.kill("SIGKILL");
            }
          }
        } else {
          proc.kill();
        }
      } catch {
        // Process may have already exited
      }

      if (monitor) {
        monitor.logEvent("dev", `Dev server stopped (${cwd})`);
      }

      return {
        success: true,
        message: "Dev server stopped",
        cwd,
        tail: output.slice(-10),
      };
    },
  };

  // Backward-compatible aliases (deprecated)
  handlers["mandu_init"] = handlers["mandu.project.init"];
  handlers["mandu_dev_start"] = handlers["mandu.dev.start"];
  handlers["mandu_dev_stop"] = handlers["mandu.dev.stop"];

  return handlers;
}
