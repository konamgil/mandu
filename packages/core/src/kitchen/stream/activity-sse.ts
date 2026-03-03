/**
 * ActivitySSEBroadcaster - Broadcasts MCP activity events to Kitchen UI via SSE.
 *
 * Watches .mandu/activity.jsonl (written by MCP server process) and pushes
 * new events to connected browser clients using Server-Sent Events.
 *
 * Uses 500ms throttle (AionUI pattern) to avoid overwhelming the browser.
 */

import path from "path";
import { FileTailer } from "./file-tailer";

interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  connectedAt: number;
}

const THROTTLE_MS = 500;
const HEARTBEAT_MS = 30_000;

export class ActivitySSEBroadcaster {
  private clients = new Map<string, SSEClient>();
  private tailer: FileTailer;
  private pendingEvents: string[] = [];
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(rootDir: string) {
    const logPath = path.join(rootDir, ".mandu", "activity.jsonl");
    this.tailer = new FileTailer(logPath, {
      startAtEnd: true,
      pollIntervalMs: 300,
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.tailer.on("line", (line: string) => {
      this.pendingEvents.push(line);
      this.scheduleFlush();
    });
    this.tailer.start();

    // Heartbeat to keep connections alive and detect stale clients
    this.heartbeatTimer = setInterval(() => {
      this.broadcast(JSON.stringify({ type: "heartbeat", ts: new Date().toISOString() }));
    }, HEARTBEAT_MS);
  }

  private scheduleFlush(): void {
    if (this.throttleTimer) return;
    this.throttleTimer = setTimeout(() => {
      this.flush();
      this.throttleTimer = null;
    }, THROTTLE_MS);
  }

  private flush(): void {
    const events = this.pendingEvents.splice(0);
    for (const event of events) {
      this.broadcast(event);
    }
  }

  /** Broadcast a raw JSON string to all connected SSE clients */
  broadcast(data: string): void {
    const message = `data: ${data}\n\n`;
    const encoded = new TextEncoder().encode(message);

    for (const [id, client] of this.clients) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  /** Create an SSE Response for a new client connection */
  createResponse(): Response {
    const clientId = crypto.randomUUID();

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.clients.set(clientId, {
          id: clientId,
          controller,
          connectedAt: Date.now(),
        });

        // Send connection confirmation
        const welcome = `data: ${JSON.stringify({
          type: "connected",
          clientId,
          ts: new Date().toISOString(),
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(welcome));
      },
      cancel: () => {
        this.clients.delete(clientId);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Kitchen-Version": "1",
      },
    });
  }

  /** Get the number of connected clients */
  get clientCount(): number {
    return this.clients.size;
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.tailer.stop();

    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const [, client] of this.clients) {
      try {
        client.controller.close();
      } catch { /* ignore */ }
    }
    this.clients.clear();
  }
}
