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
import { validateFile, MVP_RULES } from "./rules";
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
      this.processFileEvent("modify", filePath);
    });

    this.chokidarWatcher.on("add", (filePath) => {
      this._fileCount++;
      this.processFileEvent("create", filePath);
    });

    this.chokidarWatcher.on("unlink", (filePath) => {
      this._fileCount = Math.max(0, this._fileCount - 1);
      this.processFileEvent("delete", filePath);
    });

    this.chokidarWatcher.on("error", (error) => {
      console.error(`[Watch] Error:`, error.message);
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

    // Cross-process: skip if generate finished within last 2 seconds
    // Walk up from the changed file to find nearest .mandu/generate.stamp
    let stampDir = path.dirname(filePath);
    while (stampDir !== path.dirname(stampDir)) {
      const stampFile = path.join(stampDir, ".mandu", "generate.stamp");
      try {
        const stamp = parseInt(fs.readFileSync(stampFile, "utf-8"), 10);
        if (Date.now() - stamp < 2000) return;
        break;
      } catch {}
      stampDir = path.dirname(stampDir);
    }


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
    globalWatcher.stop();
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
