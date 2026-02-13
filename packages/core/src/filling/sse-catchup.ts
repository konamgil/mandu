export interface SSECursor {
  id: string;
}

export interface CatchupResult<T> {
  mode: "delta" | "snapshot";
  items: T[];
  reason?: "missing-cursor" | "unknown-cursor";
}

export interface CatchupOptions<T extends SSECursor> {
  cursorId?: string | null;
  snapshot: readonly T[];
}

/**
 * Resolve resume cursor from Last-Event-ID header.
 */
export function resolveResumeCursor(request: Request): string | undefined {
  const raw = request.headers.get("last-event-id")?.trim();
  return raw ? raw : undefined;
}

/**
 * Return reconnect catch-up list if cursor exists, otherwise full snapshot fallback.
 */
export function catchupFromCursor<T extends SSECursor>(options: CatchupOptions<T>): CatchupResult<T> {
  const { cursorId, snapshot } = options;

  if (!cursorId) {
    return {
      mode: "snapshot",
      reason: "missing-cursor",
      items: [...snapshot],
    };
  }

  const index = snapshot.findIndex((item) => item.id === cursorId);
  if (index < 0) {
    return {
      mode: "snapshot",
      reason: "unknown-cursor",
      items: [...snapshot],
    };
  }

  return {
    mode: "delta",
    items: snapshot.slice(index + 1),
  };
}

/**
 * Idempotent merge utility for reconnect + snapshot mix.
 */
export function mergeUniqueById<T extends SSECursor>(base: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(base.map((item) => item.id));
  const merged = [...base];

  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }

  return merged;
}
