/** Mandu Unified EventBus -- foundation for the observability system. */

import { newId } from "../id";

export type EventType = "http" | "mcp" | "guard" | "build" | "error" | "cache" | "ws";
export type ObservabilitySeverity = "info" | "warn" | "error";

export interface ObservabilityEvent {
  id: string;
  correlationId?: string;
  type: EventType;
  severity: ObservabilitySeverity;
  source: string;
  timestamp: number;
  message: string;
  data?: Record<string, unknown>;
  duration?: number;
}

export type EventHandler = (event: ObservabilityEvent) => void;

class ManduEventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private recent: ObservabilityEvent[] = [];
  private maxRecent = 200;

  on(type: EventType | "*", handler: EventHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  emit(event: Omit<ObservabilityEvent, "id" | "timestamp">): void {
    const full: ObservabilityEvent = {
      ...event,
      id: newId(),
      timestamp: Date.now(),
    };
    this.recent.push(full);
    if (this.recent.length > this.maxRecent) {
      this.recent = this.recent.slice(-this.maxRecent);
    }
    this.handlers.get(full.type)?.forEach((h) => h(full));
    this.handlers.get("*")?.forEach((h) => h(full));
  }

  getRecent(
    count?: number,
    filter?: { type?: EventType; severity?: ObservabilitySeverity },
  ): ObservabilityEvent[] {
    let result = this.recent;
    if (filter?.type) result = result.filter((e) => e.type === filter.type);
    if (filter?.severity) result = result.filter((e) => e.severity === filter.severity);
    return count ? result.slice(-count) : result;
  }

  getStats(windowMs?: number): Record<EventType, { count: number; errors: number; avgDuration: number }> {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const ALL: EventType[] = ["http", "mcp", "guard", "build", "error", "cache", "ws"];
    const stats = {} as Record<EventType, { count: number; errors: number; avgDuration: number }>;
    const dur = {} as Record<EventType, number[]>;
    for (const t of ALL) { stats[t] = { count: 0, errors: 0, avgDuration: 0 }; dur[t] = []; }
    for (const e of this.recent) {
      if (e.timestamp < cutoff) continue;
      stats[e.type].count++;
      if (e.severity === "error") stats[e.type].errors++;
      if (e.duration !== undefined) dur[e.type].push(e.duration);
    }
    for (const t of ALL) {
      const d = dur[t];
      stats[t].avgDuration = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
    }
    return stats;
  }
}

export const eventBus = new ManduEventBus();
