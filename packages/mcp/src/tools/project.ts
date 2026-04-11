/**
 * Mandu MCP - Project Tools
 *
 * - mandu_init: Create a new Mandu project (init + optional install)
 * - mandu_dev_start: Start dev server
 * - mandu_dev_stop: Stop dev server
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ActivityMonitor } from "../activity-monitor.js";
import { spawn, type Subprocess } from "bun";
import { execSync } from "child_process";
import path from "path";
import fs from "fs/promises";

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
    name: "mandu_init",
    description:
      "Initialize a new Mandu project (runs `mandu init` and optionally `bun install`).",
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
    name: "mandu_dev_start",
    description: "Start Mandu dev server (bun run dev).",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Project directory to run dev server in (default: current project)",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu_dev_stop",
    description: "Stop Mandu dev server if running.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export function projectTools(projectRoot: string, server?: Server, monitor?: ActivityMonitor) {
  return {
    mandu_init: async (args: Record<string, unknown>) => {
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

    mandu_dev_start: async (args: Record<string, unknown>) => {
      const { cwd } = args as { cwd?: string };
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

        // Wait for the server to output its port before returning
        const portPromise = new Promise<{ port: number; url: string } | null>((resolve) => {
          const PORT_DETECT_TIMEOUT_MS = 15_000;
          const timeout = setTimeout(() => resolve(null), PORT_DETECT_TIMEOUT_MS);
          const portPattern = /https?:\/\/[^:\s]+:(\d+)/;

          const originalPush = state.output.push.bind(state.output);
          state.output.push = (...items: string[]) => {
            const result = originalPush(...items);
            for (const item of items) {
              const match = item.match(portPattern);
              if (match) {
                const detectedPort = parseInt(match[1], 10);
                clearTimeout(timeout);
                state.output.push = originalPush;
                resolve({
                  port: detectedPort,
                  url: match[0],
                });
                break;
              }
            }
            return result;
          };
        });

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

        // Wait for port detection (with timeout fallback)
        const detected = await portPromise;

        return {
          success: true,
          pid: proc.pid,
          port: detected?.port ?? null,
          url: detected?.url ?? null,
          cwd: targetDir,
          startedAt: state.startedAt.toISOString(),
          message: detected
            ? `Dev server started on port ${detected.port}`
            : "Dev server started (port detection timed out)",
        };
      } finally {
        devServerStarting = false;
      }
    },

    mandu_dev_stop: async () => {
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
}
