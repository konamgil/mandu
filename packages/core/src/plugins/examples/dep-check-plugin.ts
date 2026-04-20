/**
 * Example plugin: dependency gate.
 *
 * Demonstrates `onRouteRegistered` — we read each route's source file
 * and warn (or throw) when it imports from a forbidden package. Useful
 * for keeping e.g. `node:fs` out of edge-bound routes.
 *
 * Educational only. A production-ready version would use the module
 * graph from the bundler rather than a line-wise regex scan.
 *
 * @example
 * ```ts
 * export default {
 *   plugins: [
 *     depCheckPlugin({
 *       forbidden: ["node:fs", "node:child_process"],
 *       severity: "error",
 *     }),
 *   ],
 * } satisfies ManduConfig;
 * ```
 */

import { readFile } from "fs/promises";
import path from "path";
import { definePlugin } from "../define";
import type { ManduPlugin } from "../hooks";

export interface DepCheckPluginOptions {
  /** Bare-specifier prefixes that routes must NOT import. */
  forbidden: readonly string[];
  /**
   * How to react to a violation:
   *   - `"warn"` (default) — log to stderr.
   *   - `"error"` — throw. The runner captures the error per-route so
   *     other plugins still run, but the CLI sees a non-empty errors
   *     array in `FSGenerateResult.warnings`.
   */
  severity?: "warn" | "error";
}

export function depCheckPlugin(options: DepCheckPluginOptions): ManduPlugin {
  const { forbidden, severity = "warn" } = options;

  return definePlugin({
    name: "dep-check",
    hooks: {
      async onRouteRegistered(route) {
        const modulePath = path.resolve(process.cwd(), route.module);
        let source: string;
        try {
          source = await readFile(modulePath, "utf-8");
        } catch {
          return; // Module not readable — not a gate concern.
        }
        const offenders: string[] = [];
        const importRegex =
          /(?:import|from|require)\s*\(?\s*["']([^"']+)["']/g;
        for (const match of source.matchAll(importRegex)) {
          const specifier = match[1];
          for (const f of forbidden) {
            if (specifier === f || specifier.startsWith(`${f}/`)) {
              offenders.push(specifier);
              break;
            }
          }
        }
        if (offenders.length === 0) return;

        const message =
          `[dep-check] route ${route.id} (${route.module}) imports forbidden ` +
          `specifiers: ${offenders.join(", ")}`;
        if (severity === "error") {
          throw new Error(message);
        }
        console.warn(message);
      },
    },
  });
}
