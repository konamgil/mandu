/**
 * Mandu Adapter Interface
 * 런타임 중립적 서버 어댑터 추상화
 */

import type { RoutesManifest } from "../spec/schema";
import type { BundleManifest } from "../bundler/types";
import type { ServerOptions } from "./server";

// ========== Types ==========

export interface AdapterOptions {
  manifest: RoutesManifest;
  bundleManifest?: BundleManifest;
  rootDir: string;
  serverOptions: ServerOptions;
}

export interface AdapterServer {
  /** fetch handler (Web Fetch API — 런타임 중립) */
  fetch: (request: Request) => Promise<Response>;
  /** 서버 시작 */
  listen(port: number, hostname?: string): Promise<{ port: number; hostname: string }>;
  /** 서버 중지 */
  close(): Promise<void>;
}

/**
 * Mandu Adapter 인터페이스
 *
 * @example
 * ```typescript
 * // mandu.config.ts
 * import adapterBun from "@mandujs/adapter-bun";
 *
 * export default {
 *   adapter: adapterBun(),
 * };
 * ```
 */
export interface ManduAdapter {
  name: string;
  /** 빌드 타임: 배포 산출물 생성 (SSG, 서버리스 번들 등) */
  build?(options: AdapterOptions): Promise<void>;
  /** 런타임: 서버 인스턴스 생성 */
  createServer(options: AdapterOptions): AdapterServer;
}
