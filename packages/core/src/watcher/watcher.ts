/**
 * Brain v0.1 - File Watcher
 *
 * Watches for file changes and triggers warnings (no blocking).
 * Uses native file system watching for efficiency.
 */

import type {
  WatchStatus,
  WatchWarning,
  WatchEventHandler,
} from "../brain/types";
import { validateFile, MVP_RULES } from "./rules";
import path from "path";
import fs from "fs";

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
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private handlers: Set<WatchEventHandler> = new Set();
  private recentWarnings: WatchWarning[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private _active: boolean = false;
  private _startedAt: Date | null = null;
  private _fileCount: number = 0;

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

    const { rootDir } = this.config;

    // Verify root directory exists
    if (!fs.existsSync(rootDir)) {
      throw new Error(`Root directory does not exist: ${rootDir}`);
    }

    // Watch the root directory and subdirectories
    await this.watchDirectory(rootDir);

    this._active = true;
    this._startedAt = new Date();
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (!this._active) {
      return;
    }

    // Close all watchers
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();

    // Clear debounce timers
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

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
   * Watch a directory recursively
   */
  private async watchDirectory(dir: string): Promise<void> {
    const { ignoreDirs } = this.config;

    // Skip ignored directories
    const dirName = path.basename(dir);
    if (ignoreDirs?.includes(dirName)) {
      return;
    }

    try {
      // Watch this directory
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (filename) {
          this.handleFileEvent(eventType, path.join(dir, filename));
        }
      });

      watcher.on("error", (error) => {
        console.error(`[Watch] Error watching ${dir}:`, error.message);
      });

      this.watchers.set(dir, watcher);
      this._fileCount++;

      // Recursively watch subdirectories
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !ignoreDirs?.includes(entry.name)) {
          await this.watchDirectory(path.join(dir, entry.name));
        }
      }
    } catch (error) {
      // Directory might not exist or be accessible
      console.error(
        `[Watch] Failed to watch ${dir}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Handle a file system event
   */
  private handleFileEvent(eventType: string, filePath: string): void {
    const { debounceMs, watchExtensions } = this.config;

    // Check file extension
    const ext = path.extname(filePath);
    if (watchExtensions && !watchExtensions.includes(ext)) {
      return;
    }

    // Debounce events for the same file
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.processFileEvent(eventType, filePath);
    }, debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Process a debounced file event
   */
  private async processFileEvent(
    eventType: string,
    filePath: string
  ): Promise<void> {
    const { rootDir } = this.config;

    // Determine event type
    let event: "create" | "modify" | "delete";

    if (eventType === "rename") {
      // Check if file exists to determine create vs delete
      event = fs.existsSync(filePath) ? "create" : "delete";
    } else {
      event = "modify";
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
export function stopWatcher(): void {
  if (globalWatcher) {
    globalWatcher.stop();
    globalWatcher = null;
  }
}
