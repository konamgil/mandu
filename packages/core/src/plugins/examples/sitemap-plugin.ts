/**
 * Example plugin: sitemap emitter.
 *
 * Demonstrates `onManifestBuilt` — we read the final manifest and
 * write a `sitemap.xml` into the project root. The manifest is
 * returned unchanged (we only need to observe, not mutate).
 *
 * Educational only — not published as a standalone package. Copy /
 * adapt into your own project.
 *
 * @example
 * ```ts
 * // mandu.config.ts
 * import { sitemapPlugin } from "@mandujs/core/plugins/examples/sitemap-plugin";
 *
 * export default {
 *   plugins: [sitemapPlugin({ baseUrl: "https://example.com" })],
 * } satisfies ManduConfig;
 * ```
 */

import { writeFile } from "fs/promises";
import path from "path";
import { definePlugin } from "../define";
import type { ManduPlugin } from "../hooks";

export interface SitemapPluginOptions {
  /** Absolute public URL, e.g. `"https://example.com"`. No trailing slash. */
  baseUrl: string;
  /** Output path (relative to cwd). Default `"public/sitemap.xml"`. */
  outFile?: string;
  /** Filter predicate — return `false` to exclude a route. */
  include?: (pattern: string) => boolean;
}

export function sitemapPlugin(options: SitemapPluginOptions): ManduPlugin {
  const { baseUrl, outFile = "public/sitemap.xml", include } = options;
  const cleanBase = baseUrl.replace(/\/+$/, "");

  return definePlugin({
    name: "sitemap",
    hooks: {
      async onManifestBuilt(manifest) {
        const urls: string[] = [];
        for (const route of manifest.routes) {
          if (route.kind !== "page") continue;
          if (route.pattern.includes(":") || route.pattern.includes("*")) {
            // Skip dynamic patterns — a real plugin would hydrate them
            // via `generateStaticParams`. Educational subset.
            continue;
          }
          if (include && !include(route.pattern)) continue;
          urls.push(`${cleanBase}${route.pattern}`);
        }
        const xml =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
          `\n</urlset>\n`;
        await writeFile(path.resolve(process.cwd(), outFile), xml, "utf-8");
        // Return undefined — we observed, we didn't mutate.
      },
    },
  });
}
