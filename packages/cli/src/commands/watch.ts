/**
 * Mandu CLI - Watch Command
 *
 * Real-time file watching with architecture rule warnings.
 * Warnings only - never blocks operations.
 */

import {
  startWatcher,
  stopWatcher,
  getWatcher,
  printWatchStart,
  printWatchStop,
  printStatus,
  createConsoleHandler,
} from "../../../core/src/index";
import { getRootDir } from "../util/fs";

export interface WatchOptions {
  /** Extra commands to run on violations */
  extraCommands?: string[];
  /** Debounce delay in ms */
  debounce?: number;
  /** Show status only (don't start watching) */
  status?: boolean;
}

export async function watch(options: WatchOptions = {}): Promise<boolean> {
  const { extraCommands, debounce, status } = options;

  const rootDir = getRootDir();

  // Status only mode
  if (status) {
    const watcher = getWatcher();
    if (watcher) {
      printStatus(watcher.getStatus());
    } else {
      console.log("👁️ Watch is not running");
    }
    return true;
  }

  // Start watching
  printWatchStart(rootDir);

  try {
    const watcher = await startWatcher({
      rootDir,
      extraCommands,
      debounceMs: debounce,
    });

    // Add console handler
    watcher.onWarning(createConsoleHandler());

    // Handle shutdown signals
    const shutdown = () => {
      printWatchStop();
      stopWatcher();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep the process running
    await new Promise(() => {
      // Never resolves - runs until interrupted
    });

    return true;
  } catch (error) {
    console.error(
      "❌ Watch failed:",
      error instanceof Error ? error.message : error
    );
    return false;
  }
}
