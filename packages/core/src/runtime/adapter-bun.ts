/**
 * Mandu Bun Adapter (기본 어댑터)
 * Bun.serve() 기반 서버 생성
 */

import type { ManduAdapter, AdapterOptions, AdapterServer } from "./adapter";
import { startServer, type ManduServer } from "./server";

/**
 * Bun 어댑터 (기본)
 *
 * @example
 * ```typescript
 * // mandu.config.ts
 * import { adapterBun } from "@mandujs/core";
 *
 * export default {
 *   adapter: adapterBun(),
 * };
 * ```
 */
export function adapterBun(): ManduAdapter {
  return {
    name: "adapter-bun",

    createServer(options: AdapterOptions): AdapterServer {
      let manduServer: ManduServer | null = null;

      return {
        async fetch(req: Request): Promise<Response> {
          if (!manduServer) {
            return new Response("Server not started", { status: 503 });
          }
          // 내부 서버로 프록시
          const url = new URL(req.url);
          const targetUrl = `http://localhost:${manduServer.server.port}${url.pathname}${url.search}`;
          return globalThis.fetch(new Request(targetUrl, req));
        },

        async listen(port: number, hostname?: string) {
          manduServer = startServer(options.manifest, {
            ...options.serverOptions,
            port,
            hostname,
            rootDir: options.rootDir,
            bundleManifest: options.bundleManifest,
          });

          return {
            port: manduServer.server.port ?? port,
            // Report the effective bind address. startServer() defaults to
            // 0.0.0.0 when no hostname is supplied. See #190.
            hostname: hostname ?? "0.0.0.0",
          };
        },

        async close() {
          manduServer?.stop();
          manduServer = null;
        },
      };
    },
  };
}
