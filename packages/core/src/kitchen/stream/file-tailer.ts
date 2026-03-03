/**
 * FileTailer - Tails a JSONL file and emits new lines as events.
 *
 * Used by Kitchen SSE to watch .mandu/activity.jsonl written by MCP server.
 * Communication between MCP process and dev server is file-system based.
 */

import { EventEmitter } from "events";
import fs from "fs";

export interface FileTailerOptions {
  /** Start reading from end of file (skip existing content) */
  startAtEnd: boolean;
  /** Polling interval in ms for fs.watchFile */
  pollIntervalMs: number;
}

const DEFAULT_OPTIONS: FileTailerOptions = {
  startAtEnd: true,
  pollIntervalMs: 300,
};

export class FileTailer extends EventEmitter {
  private position = 0;
  private buffer = "";
  private watching = false;

  constructor(
    private filePath: string,
    private options: FileTailerOptions = DEFAULT_OPTIONS
  ) {
    super();
  }

  start(): void {
    if (this.watching) return;
    this.watching = true;

    try {
      const stat = fs.statSync(this.filePath);
      this.position = this.options.startAtEnd ? stat.size : 0;
    } catch {
      // File doesn't exist yet — start from 0
      this.position = 0;
    }

    fs.watchFile(
      this.filePath,
      { interval: this.options.pollIntervalMs },
      (curr) => {
        if (curr.size > this.position) {
          this.readNewContent(curr.size);
        } else if (curr.size < this.position) {
          // File was truncated/recreated (MCP server restart)
          this.position = 0;
          this.buffer = "";
          if (curr.size > 0) {
            this.readNewContent(curr.size);
          }
        }
      }
    );
  }

  private readNewContent(newSize: number): void {
    let fd: number | undefined;
    try {
      fd = fs.openSync(this.filePath, "r");
      const length = newSize - this.position;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, this.position);
      this.position = newSize;

      this.buffer += buf.toString("utf-8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          this.emit("line", trimmed);
        }
      }
    } catch {
      // File read error — will retry on next poll
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* ignore */ }
      }
    }
  }

  stop(): void {
    if (!this.watching) return;
    this.watching = false;
    fs.unwatchFile(this.filePath);
    this.removeAllListeners();
  }
}
