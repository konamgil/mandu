/**
 * Brain v0.1 - File Watcher
 *
 * Watches for file changes and triggers warnings (no blocking).
 * Uses chokidar for reliable cross-platform file system watching.
 */

import type {
  WatchStatus,
  WatchWarning,
  WatchEventHandler,
} from "../brain/types";
import { validateFile } from "./rules";
import path from "path";
import fs from "fs";
import { spawn, type ChildProcess } from "child_process";
import chokidar, { type FSWatcher } from "chokidar";

/**
 * Format a warning for log output
 */
function formatWarning(warning: WatchWarning): string {
  const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  const icon = warning.level === "info" ? "[INFO]" : warning.event === "delete" ? "[DEL]" : "[WARN]";
  return `${time} ${icon} ${warning.ruleId}\n       ${warning.file}\n       ${warning.message}\n`;
}

/**
 * Watcher configuration
 */
export interface WatcherConfig {
  /** Root directory to watch */
  rootDir: string;
  /** Debounce delay in ms (default: 300) */
  debounceMs?: number;
  /** Extra commands to run on violations */
  extraCommands?: string[];
  /** Directories to ignore */
  ignoreDirs?: string[];
  /** File extensions to watch */
  watchExtensions?: string[];
}

/**
 * Default watcher configuration
 */
const DEFAULT_CONFIG: Partial<WatcherConfig> = {
  debounceMs: 300,
  ignoreDirs: ["node_modules", ".git", "dist", ".next", ".turbo"],
  watchExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
};

/**
 * File Watcher class
 *
 * Monitors file changes and emits warnings based on architecture rules.
 * Never blocks operations - only warns.
 */
/**
 * Windows reserved device names that cannot be used as file/directory names.
 * These cause EISDIR/ENOENT errors when file watchers try to access them.
 * See: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
 */
const WINDOWS_RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

const GENERATE_STAMP_SUPPRESS_MS = 10_000;

function readGenerateStamp(stampFile: string): number | null {
  try {
    const stamp = Number.parseInt(fs.readFileSync(stampFile, "utf-8"), 10);
    return Number.isFinite(stamp) ? stamp : null;
  } catch {
    return null;
  }
}

function isManduGeneratedPath(rootDir: string, filePath: string): boolean {
  const relativePath = path.relative(rootDir, filePath).replace(/\\/g, "/");
  return relativePath === ".mandu/generated" || relativePath.startsWith(".mandu/generated/");
}

export function hasRecentGenerateStamp(
  rootDir: string,
  filePath: string,
  now: number = Date.now()
): boolean {
  if (!isManduGeneratedPath(rootDir, filePath)) {
    return false;
  }

  const candidates = new Set<string>([
    path.join(rootDir, ".mandu", "generate.stamp"),
  ]);
  const resolvedRoot = path.resolve(rootDir);
  let stampDir = path.dirname(path.resolve(filePath));

  while (stampDir !== path.dirname(stampDir)) {
    candidates.add(path.join(stampDir, ".mandu", "generate.stamp"));
    if (stampDir === resolvedRoot) break;
    stampDir = path.dirname(stampDir);
  }

  for (const stampFile of candidates) {
    const stamp = readGenerateStamp(stampFile);
    if (stamp === null) continue;

    const ageMs = now - stamp;
    if (ageMs >= 0 && ageMs < GENERATE_STAMP_SUPPRESS_MS) {
      return true;
    }
  }

  return false;
}

export class FileWatcher {
  private config: WatcherConfig;
  private chokidarWatcher: FSWatcher | null = null;
  private handlers: Set<WatchEventHandler> = new Set();
  private recentWarnings: WatchWarning[] = [];
  private _active: boolean = false;
  private _startedAt: Date | null = null;
  private _fileCount: number = 0;
  private logFile: string | null = null;
  private logStream: fs.WriteStream | null = null;
  private tailProcess: ChildProcess | null = null;
  private _suppressed: boolean = false;

  constructor(config: WatcherConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Start watching
   */
  async start(): Promise<void> {
    if (this._active) {
      return;
    }

    const { rootDir, ignoreDirs, watchExtensions, debounceMs } = this.config;

    // Verify root directory exists
    if (!fs.existsSync(rootDir)) {
      throw new Error(`Root directory does not exist: ${rootDir}`);
    }

    // Setup log file at .mandu/watch.log
    const manduDir = path.join(rootDir, ".mandu");
    if (!fs.existsSync(manduDir)) {
      fs.mkdirSync(manduDir, { recursive: true });
    }
    this.logFile = path.join(manduDir, "watch.log");
    this.logStream = fs.createWriteStream(this.logFile, { flags: "w" });
    const startTime = new Date().toLocaleTimeString("ko-KR", { hour12: false });
    this.logStream.write(
      `${"=".repeat(50)}\n` +
      `  Mandu Watch - ${startTime}\n` +
      `  Root: ${rootDir}\n` +
      `${"=".repeat(50)}\n\n`
    );

    // Terminal is now handled by ActivityMonitor in MCP server

    // Build sets for fast lookup
    const ignoredSet = new Set(ignoreDirs || []);
    const extSet = new Set(watchExtensions || []);

    // Start chokidar watcher
    this.chokidarWatcher = chokidar.watch(rootDir, {
      ignored: (filePath, stats) => {
        const basename = path.basename(filePath);
        // Ignore directories in the ignore list
        if (ignoredSet.has(basename)) return true;
        // Filter out Windows reserved device names (#12)
        // These cause EISDIR errors when chokidar tries to scandir them
        if (WINDOWS_RESERVED_NAMES.has(basename.toUpperCase().replace(/\..*$/, ""))) return true;
        // For files, only watch matching extensions
        if (stats?.isFile() && extSet.size > 0) {
          const ext = path.extname(filePath);
          return !extSet.has(ext);
        }
        return false;
      },
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: debounceMs ?? 300,
        pollInterval: 100,
      },
    });

    // Count initial files
    this.chokidarWatcher.on("ready", () => {
      const watched = this.chokidarWatcher?.getWatched() ?? {};
      let count = 0;
      for (const files of Object.values(watched)) {
        count += files.length;
      }
      this._fileCount = count;
    });

    // Handle events (v5 passes absolute paths when watching absolute rootDir)
    this.chokidarWatcher.on("change", (filePath) => {
      void this.processFileEvent("modify", filePath);
    });

    this.chokidarWatcher.on("add", (filePath) => {
      this._fileCount++;
      void this.processFileEvent("create", filePath);
    });

    this.chokidarWatcher.on("unlink", (filePath) => {
      this._fileCount = Math.max(0, this._fileCount - 1);
      void this.processFileEvent("delete", filePath);
    });

    this.chokidarWatcher.on("error", (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      // Suppress EISDIR errors from Windows reserved device names (#12)
      // e.g. "EISDIR: illegal operation on a directory, scandir 'C:\...\nul'"
      if (message.includes("EISDIR")) {
        const pathMatch = message.match(/scandir\s+'([^']+)'/);
        if (pathMatch) {
          const baseName = pathMatch[1].split(/[/\\]/).pop() || "";
          if (WINDOWS_RESERVED_NAMES.has(baseName.toUpperCase())) {
            return; // Silently ignore — these are not real directories
          }
        }
      }
      console.error(`[Watch] Error:`, message);
    });

    this._active = true;
    this._startedAt = new Date();
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (!this._active) {
      return;
    }

    // Close tail terminal process
    if (this.tailProcess) {
      this.tailProcess.kill();
      this.tailProcess = null;
    }

    // Close log stream
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }

    // Close chokidar watcher (async in v5)
    if (this.chokidarWatcher) {
      await this.chokidarWatcher.close();
      this.chokidarWatcher = null;
    }

    this._active = false;
    this._fileCount = 0;
  }

  /**
   * Add an event handler
   */
  onWarning(handler: WatchEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Get current status
   */
  getStatus(): WatchStatus {
    return {
      active: this._active,
      rootDir: this._active ? this.config.rootDir : null,
      fileCount: this._fileCount,
      recentWarnings: this.recentWarnings.slice(-20), // Last 20 warnings
      startedAt: this._startedAt,
    };
  }

  /**
   * Get recent warnings
   */
  getRecentWarnings(limit: number = 20): WatchWarning[] {
    return this.recentWarnings.slice(-limit);
  }

  /**
   * Clear recent warnings
   */
  clearWarnings(): void {
    this.recentWarnings = [];
  }

  /**
   * Suppress warnings (e.g. during generate)
   */
  suppress(): void {
    this._suppressed = true;
  }

  /**
   * Resume warnings after suppression
   */
  resume(): void {
    this._suppressed = false;
  }

  /**
   * Open a new terminal window tailing the log file
   */
  private openLogTerminal(logFile: string, cwd: string): void {
    try {
      if (process.platform === "win32") {
        // Windows: open new cmd window with PowerShell Get-Content -Wait
        this.tailProcess = spawn("cmd", [
          "/c", "start",
          "Mandu Watch",
          "powershell", "-NoExit", "-Command",
          `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 | Out-Null; Get-Content '${logFile}' -Wait -Encoding UTF8`,
        ], { cwd, detached: true, stdio: "ignore" });
      } else if (process.platform === "darwin") {
        // macOS: open new Terminal.app tab
        this.tailProcess = spawn("osascript", [
          "-e", `tell application "Terminal" to do script "tail -f '${logFile}'"`,
        ], { detached: true, stdio: "ignore" });
      } else {
        // Linux: try common terminal emulators
        this.tailProcess = spawn("x-terminal-emulator", [
          "-e", `tail -f '${logFile}'`,
        ], { cwd, detached: true, stdio: "ignore" });
      }
      this.tailProcess?.unref();
    } catch {
      // Terminal auto-open failed silently — user can still tail manually
    }
  }

  /**
   * Process a file event
   */
  private async processFileEvent(
    event: "create" | "modify" | "delete",
    filePath: string
  ): Promise<void> {
    if (this._suppressed) return;

    const { rootDir } = this.config;

    // Cross-process: skip generated-file churn from a recent mandu generate.
    if (hasRecentGenerateStamp(rootDir, filePath)) return;

    // Validate file against rules
    try {
      const warnings = await validateFile(filePath, event, rootDir);

      for (const warning of warnings) {
        this.emitWarning(warning);
      }
    } catch (error) {
      console.error(
        `[Watch] Error validating ${filePath}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Emit a warning to all handlers
   */
  private emitWarning(warning: WatchWarning): void {
    // Write to log file
    if (this.logStream) {
      this.logStream.write(formatWarning(warning));
    }

    // Add to recent warnings
    this.recentWarnings.push(warning);

    // Keep only last 100 warnings
    if (this.recentWarnings.length > 100) {
      this.recentWarnings = this.recentWarnings.slice(-100);
    }

    // Notify all handlers
    for (const handler of this.handlers) {
      try {
        handler(warning);
      } catch (error) {
        console.error(
          "[Watch] Handler error:",
          error instanceof Error ? error.message : error
        );
      }
    }
  }
}

/**
 * Create a file watcher with default console output
 */
export function createWatcher(config: WatcherConfig): FileWatcher {
  const watcher = new FileWatcher(config);

  // Add default console handler
  watcher.onWarning((warning) => {
    const icon = warning.event === "delete" ? "🗑️" : "⚠️";
    console.log(
      `${icon} [${warning.ruleId}] ${warning.file}\n   ${warning.message}`
    );
  });

  return watcher;
}

/**
 * Global watcher instance
 */
let globalWatcher: FileWatcher | null = null;

/**
 * Get or create the global watcher
 */
export function getWatcher(config?: WatcherConfig): FileWatcher | null {
  if (!globalWatcher && config) {
    globalWatcher = new FileWatcher(config);
  }
  return globalWatcher;
}

/**
 * Start the global watcher
 */
export async function startWatcher(config: WatcherConfig): Promise<FileWatcher> {
  if (globalWatcher) {
    await globalWatcher.stop();
  }

  globalWatcher = createWatcher(config);
  await globalWatcher.start();

  return globalWatcher;
}

/**
 * Stop the global watcher
 */
export async function stopWatcher(): Promise<void> {
  if (globalWatcher) {
    await globalWatcher.stop();
    globalWatcher = null;
  }
}
