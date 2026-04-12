import { resolveFromCwd } from "../util/fs";
import { readRuntimeControl } from "../util/runtime-control";

export interface CacheOptions {
  tag?: string;
  all?: boolean;
  path?: string;
  json?: boolean;
}

interface CacheStatsPayload {
  enabled?: boolean;
  message?: string;
  stats?: {
    entries?: number;
    maxEntries?: number;
    staleEntries?: number;
    hits?: number;
    staleHits?: number;
    misses?: number;
    hitRate?: number;
  } | null;
}

interface CacheClearPayload extends CacheStatsPayload {
  cleared?: number;
  target?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatPercent(value?: number): string {
  if (typeof value !== "number") {
    return "n/a";
  }
  return `${(value * 100).toFixed(0)}%`;
}

function parseStatsPayload(value: unknown): CacheStatsPayload {
  if (!isRecord(value)) {
    return {};
  }

  const rawStats = isRecord(value.stats) ? value.stats : null;
  return {
    enabled: value.enabled === true,
    message: typeof value.message === "string" ? value.message : undefined,
    stats: rawStats
      ? {
          entries: typeof rawStats.entries === "number" ? rawStats.entries : undefined,
          maxEntries: typeof rawStats.maxEntries === "number" ? rawStats.maxEntries : undefined,
          staleEntries: typeof rawStats.staleEntries === "number" ? rawStats.staleEntries : undefined,
          hits: typeof rawStats.hits === "number" ? rawStats.hits : undefined,
          staleHits: typeof rawStats.staleHits === "number" ? rawStats.staleHits : undefined,
          misses: typeof rawStats.misses === "number" ? rawStats.misses : undefined,
          hitRate: typeof rawStats.hitRate === "number" ? rawStats.hitRate : undefined,
        }
      : null,
    };
}

function parseClearPayload(value: unknown): CacheClearPayload {
  if (!isRecord(value)) {
    return {};
  }

  const parsed = parseStatsPayload(value);
  return {
    ...parsed,
    cleared: typeof value.cleared === "number" ? value.cleared : undefined,
    target: typeof value.target === "string" ? value.target : undefined,
  };
}

export async function cache(action: string, options: CacheOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const control = await readRuntimeControl(rootDir);

  if (!control) {
    return printUnavailable(action, options);
  }

  try {
    if (action === "stats") {
      const response = await fetch(`${control.baseUrl}/_mandu/cache`, {
        headers: {
          "x-mandu-control-token": control.token,
        },
      });

      const payload = parseStatsPayload(await response.json());
      if (options.json) {
        console.log(JSON.stringify({
          action: "stats",
          serverStatus: response.ok ? "up" : "down",
          mode: control.mode,
          ...payload,
        }, null, 2));
        return response.ok;
      }

      printStats({
        serverStatus: response.ok ? "up" : "down",
        mode: control.mode,
        ...payload,
      });
      return response.ok;
    }

    if (action === "clear") {
      const response = await fetch(`${control.baseUrl}/_mandu/cache`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mandu-control-token": control.token,
        },
        body: JSON.stringify({
          ...(options.path ? { path: options.path } : {}),
          ...(options.tag ? { tag: options.tag } : {}),
          ...(options.all ? { all: true } : {}),
        }),
      });

      const payload = parseClearPayload(await response.json());
      if (options.json) {
        console.log(JSON.stringify({
          action: "clear",
          serverStatus: response.ok ? "up" : "down",
          mode: control.mode,
          ...payload,
        }, null, 2));
        return response.ok;
      }

      printClear({
        serverStatus: response.ok ? "up" : "down",
        mode: control.mode,
        ...payload,
      }, options);
      return response.ok;
    }

    console.error(`Unknown cache action: ${action}`);
    return false;
  } catch {
    return printUnavailable(action, options, control.mode);
  }
}

function printUnavailable(action: string, options: CacheOptions, mode?: string): false {
  const payload = {
    action,
    serverStatus: "down",
    message: "Runtime control file missing or server unreachable. Start `mandu dev` or `mandu start` first.",
    ...(mode ? { mode } : {}),
    ...(action === "clear"
      ? {
          target: options.path
            ? `path=${options.path}`
            : options.tag
              ? `tag=${options.tag}`
              : options.all
                ? "all"
                : "all",
        }
      : {}),
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    if (action === "clear") {
      console.log("Cache Clear Request");
      console.log("- Server: down");
      console.log(`- Target: ${payload.target}`);
      console.log(`- Message: ${payload.message}`);
    } else {
      console.log("Cache Status");
      console.log("- Server: down");
      console.log(`- Message: ${payload.message}`);
    }
  }

  return false;
}

function printStats(result: CacheStatsPayload & { serverStatus: string; mode: string }): void {
  console.log("Cache Status");
  console.log(`- Server: ${result.serverStatus}`);
  console.log(`- Mode: ${result.mode}`);
  console.log(`- Cache enabled: ${result.enabled === true ? "yes" : "no"}`);

  if (result.stats) {
    const entries = result.stats.entries ?? 0;
    const maxEntries = result.stats.maxEntries ?? 0;
    const staleEntries = result.stats.staleEntries ?? 0;
    console.log(`- Entries: ${entries}${maxEntries > 0 ? `/${maxEntries}` : ""}`);
    console.log(`- Stale entries: ${staleEntries}`);
    console.log(`- Hit rate: ${formatPercent(result.stats.hitRate)}`);
  }

  if (result.message) {
    console.log(`- Message: ${result.message}`);
  }
}

function printClear(
  result: CacheClearPayload & { serverStatus: string; mode: string },
  options: CacheOptions
): void {
  const target =
    result.target ??
    (options.path ? `path=${options.path}` : options.tag ? `tag=${options.tag}` : options.all ? "all" : "all");

  console.log("Cache Clear Request");
  console.log(`- Server: ${result.serverStatus}`);
  console.log(`- Mode: ${result.mode}`);
  console.log(`- Target: ${target}`);
  if (typeof result.cleared === "number") {
    console.log(`- Cleared: ${result.cleared}`);
  }

  if (result.stats) {
    const entries = result.stats.entries ?? 0;
    const maxEntries = result.stats.maxEntries ?? 0;
    console.log(`- Remaining entries: ${entries}${maxEntries > 0 ? `/${maxEntries}` : ""}`);
  }

  if (result.message) {
    console.log(`- Message: ${result.message}`);
  }
}
