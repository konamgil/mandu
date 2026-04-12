/**
 * Compress Middleware Plugin
 * filling.use(compress())
 */

import type { MiddlewarePlugin } from "../filling/filling";
import type { ManduContext } from "../filling/context";

export interface CompressMiddlewareOptions {
  /** 압축 최소 크기 (바이트, 기본: 1024) */
  threshold?: number;
  /** 압축할 Content-Type (기본: text/*, application/json, application/xml) */
  contentTypes?: string[];
}

const DEFAULT_COMPRESSIBLE = ["text/", "application/json", "application/xml", "application/javascript"];

/**
 * Gzip 압축 미들웨어
 *
 * @example
 * ```typescript
 * import { compress } from "@mandujs/core/middleware";
 *
 * export default Mandu.filling()
 *   .use(compress({ threshold: 512 }))
 *   .get((ctx) => ctx.ok({ largeData: "..." }));
 * ```
 */
export function compress(options?: CompressMiddlewareOptions): MiddlewarePlugin {
  const threshold = options?.threshold ?? 1024;
  const types = options?.contentTypes ?? DEFAULT_COMPRESSIBLE;

  return {
    beforeHandle: async (ctx: ManduContext): Promise<void> => {
      const acceptEncoding = ctx.headers.get("Accept-Encoding") ?? "";
      if (acceptEncoding.includes("gzip")) {
        ctx.set("_compress_enabled", true);
      }
    },
    afterHandle: async (ctx: ManduContext, response: Response): Promise<Response> => {
      if (!ctx.get<boolean>("_compress_enabled")) return response;

      const contentType = response.headers.get("Content-Type") ?? "";
      const isCompressible = types.some(t => contentType.includes(t));
      if (!isCompressible) return response;

      const body = await response.arrayBuffer();
      if (body.byteLength < threshold) {
        return new Response(body, { status: response.status, headers: response.headers });
      }

      const compressed = Bun.gzipSync(new Uint8Array(body));
      const headers = new Headers(response.headers);
      headers.set("Content-Encoding", "gzip");
      headers.set("Vary", "Accept-Encoding");
      headers.delete("Content-Length");

      return new Response(compressed, { status: response.status, headers });
    },
  };
}
