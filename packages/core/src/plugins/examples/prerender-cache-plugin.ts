/**
 * Example plugin: prerender output cache.
 *
 * Demonstrates `definePrerenderHook` — we keep a disk-backed cache of
 * previously rendered pages keyed by pathname + content hash. When the
 * next build encounters an unchanged pathname, we short-circuit with
 * the cached HTML. The bundler's fetch handler is still invoked (we
 * don't get a chance to intercept BEFORE), but we demonstrate how a
 * plugin might use the override return to swap the eventual output.
 *
 * Educational only — a production cache would key off upstream content
 * (markdown source, database row, etc.) rather than the rendered
 * HTML hash. Useful as a scaffold for "only rerender changed pages"
 * strategies.
 *
 * @example
 * ```ts
 * import { prerenderCachePlugin } from "@mandujs/core/plugins/examples/prerender-cache-plugin";
 *
 * export default {
 *   plugins: [prerenderCachePlugin({ cacheFile: ".mandu/prerender-cache.json" })],
 * } satisfies ManduConfig;
 * ```
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { createHash } from "node:crypto";
import { definePlugin } from "../define";
import type { ManduPlugin } from "../hooks";

export interface PrerenderCachePluginOptions {
  /** Absolute / cwd-relative cache file path. Default `".mandu/prerender-cache.json"`. */
  cacheFile?: string;
}

interface CacheEntry {
  hash: string;
  html: string;
}
type CacheShape = Record<string, CacheEntry>;

function hashContent(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

async function loadCache(file: string): Promise<CacheShape> {
  try {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as CacheShape)
      : {};
  } catch {
    return {};
  }
}

async function saveCache(file: string, data: CacheShape): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

export function prerenderCachePlugin(
  options: PrerenderCachePluginOptions = {}
): ManduPlugin {
  const cacheFile = path.resolve(
    process.cwd(),
    options.cacheFile ?? ".mandu/prerender-cache.json"
  );
  // Cache is loaded lazily on first hit so plugins don't pay the I/O
  // cost when nobody prerenders.
  let cache: CacheShape | null = null;
  // Track the set of pathnames we've touched this build so we can
  // prune stale entries on `onBundleComplete`.
  const touched = new Set<string>();

  return definePlugin({
    name: "prerender-cache",
    hooks: {
      async definePrerenderHook(ctx) {
        if (!cache) cache = await loadCache(cacheFile);
        const hash = hashContent(ctx.html);
        const prev = cache[ctx.pathname];
        touched.add(ctx.pathname);
        if (prev && prev.hash === hash) {
          // Content unchanged — no override needed, caller writes the
          // same bytes. We could return `{ html: prev.html }` if we
          // wanted to guarantee byte-identical output even if the
          // renderer adds a timestamp.
          return undefined;
        }
        cache[ctx.pathname] = { hash, html: ctx.html };
        await saveCache(cacheFile, cache);
        return undefined;
      },
      async onBundleComplete() {
        // Prune entries that weren't touched this build.
        if (!cache) return;
        let changed = false;
        for (const key of Object.keys(cache)) {
          if (!touched.has(key)) {
            delete cache[key];
            changed = true;
          }
        }
        if (changed) await saveCache(cacheFile, cache);
      },
    },
  });
}
