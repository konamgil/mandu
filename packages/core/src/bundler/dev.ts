/**
 * Mandu Dev Bundler 🔥
 * 개발 모드 번들링 + HMR (Hot Module Replacement)
 */

import type { RoutesManifest, RouteSpec } from "../spec/schema";
import { buildClientBundles } from "./build";
import type { BundleResult } from "./types";
import path from "path";
import fs from "fs";

export interface DevBundlerOptions {
  /** 프로젝트 루트 */
  rootDir: string;
  /** 라우트 매니페스트 */
  manifest: RoutesManifest;
  /** 재빌드 콜백 */
  onRebuild?: (result: RebuildResult) => void;
  /** 에러 콜백 */
  onError?: (error: Error, routeId?: string) => void;
}

export interface RebuildResult {
  routeId: string;
  success: boolean;
  buildTime: number;
  error?: string;
}

export interface DevBundler {
  /** 초기 빌드 결과 */
  initialBuild: BundleResult;
  /** 파일 감시 중지 */
  close: () => void;
}

/**
 * 개발 모드 번들러 시작
 * 파일 변경 감시 및 자동 재빌드
 */
export async function startDevBundler(options: DevBundlerOptions): Promise<DevBundler> {
  const { rootDir, manifest, onRebuild, onError } = options;
  const slotsDir = path.join(rootDir, "spec", "slots");

  // 초기 빌드
  console.log("🔨 Initial client bundle build...");
  const initialBuild = await buildClientBundles(manifest, rootDir, {
    minify: false,
    sourcemap: true,
  });

  if (initialBuild.success) {
    console.log(`✅ Built ${initialBuild.stats.bundleCount} islands`);
  } else {
    console.error("⚠️  Initial build had errors:", initialBuild.errors);
  }

  // 파일 감시 설정
  let watcher: fs.FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    await fs.promises.access(slotsDir);

    watcher = fs.watch(slotsDir, { recursive: true }, async (event, filename) => {
      if (!filename) return;

      // .client.ts 파일만 감시
      if (!filename.endsWith(".client.ts")) return;

      // Debounce - 연속 변경 무시
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(async () => {
        const routeId = filename.replace(".client.ts", "").replace(/\\/g, "/").split("/").pop();
        if (!routeId) return;

        const route = manifest.routes.find((r) => r.id === routeId);
        if (!route || !route.clientModule) return;

        console.log(`\n🔄 Rebuilding: ${routeId}`);
        const startTime = performance.now();

        try {
          const result = await buildClientBundles(manifest, rootDir, {
            minify: false,
            sourcemap: true,
          });

          const buildTime = performance.now() - startTime;

          if (result.success) {
            console.log(`✅ Rebuilt in ${buildTime.toFixed(0)}ms`);
            onRebuild?.({
              routeId,
              success: true,
              buildTime,
            });
          } else {
            console.error(`❌ Build failed:`, result.errors);
            onRebuild?.({
              routeId,
              success: false,
              buildTime,
              error: result.errors.join(", "),
            });
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          console.error(`❌ Build error:`, err.message);
          onError?.(err, routeId);
        }
      }, 100); // 100ms debounce
    });

    console.log("👀 Watching for client slot changes...");
  } catch {
    console.warn(`⚠️  Slots directory not found: ${slotsDir}`);
  }

  return {
    initialBuild,
    close: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      if (watcher) {
        watcher.close();
      }
    },
  };
}

/**
 * HMR WebSocket 서버
 */
export interface HMRServer {
  /** 연결된 클라이언트 수 */
  clientCount: number;
  /** 모든 클라이언트에게 메시지 전송 */
  broadcast: (message: HMRMessage) => void;
  /** 서버 중지 */
  close: () => void;
}

export interface HMRMessage {
  type: "connected" | "reload" | "island-update" | "error" | "ping";
  data?: {
    routeId?: string;
    message?: string;
    timestamp?: number;
  };
}

/**
 * HMR WebSocket 서버 생성
 */
export function createHMRServer(port: number): HMRServer {
  const clients = new Set<any>();
  const hmrPort = port + 1;

  const server = Bun.serve({
    port: hmrPort,
    fetch(req, server) {
      // WebSocket 업그레이드
      if (server.upgrade(req)) {
        return;
      }

      // 일반 HTTP 요청은 상태 반환
      return new Response(
        JSON.stringify({
          status: "ok",
          clients: clients.size,
          port: hmrPort,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(
          JSON.stringify({
            type: "connected",
            data: { timestamp: Date.now() },
          })
        );
      },
      close(ws) {
        clients.delete(ws);
      },
      message(ws, message) {
        // 클라이언트로부터의 ping 처리
        try {
          const data = JSON.parse(String(message));
          if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", data: { timestamp: Date.now() } }));
          }
        } catch {
          // 무시
        }
      },
    },
  });

  console.log(`🔥 HMR server running on ws://localhost:${hmrPort}`);

  return {
    get clientCount() {
      return clients.size;
    },
    broadcast: (message: HMRMessage) => {
      const payload = JSON.stringify(message);
      for (const client of clients) {
        try {
          client.send(payload);
        } catch {
          clients.delete(client);
        }
      }
    },
    close: () => {
      for (const client of clients) {
        try {
          client.close();
        } catch {
          // 무시
        }
      }
      clients.clear();
      server.stop();
    },
  };
}

/**
 * HMR 클라이언트 스크립트 생성
 * 브라우저에서 실행되어 HMR 서버와 연결
 */
export function generateHMRClientScript(port: number): string {
  const hmrPort = port + 1;

  return `
(function() {
  const HMR_PORT = ${hmrPort};
  let ws = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;
  const reconnectDelay = 1000;

  function connect() {
    try {
      ws = new WebSocket('ws://localhost:' + HMR_PORT);

      ws.onopen = function() {
        console.log('[Mandu HMR] Connected');
        reconnectAttempts = 0;
      };

      ws.onmessage = function(event) {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (e) {
          console.error('[Mandu HMR] Invalid message:', e);
        }
      };

      ws.onclose = function() {
        console.log('[Mandu HMR] Disconnected');
        scheduleReconnect();
      };

      ws.onerror = function(error) {
        console.error('[Mandu HMR] Error:', error);
      };
    } catch (error) {
      console.error('[Mandu HMR] Connection failed:', error);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      console.log('[Mandu HMR] Reconnecting... (' + reconnectAttempts + '/' + maxReconnectAttempts + ')');
      setTimeout(connect, reconnectDelay * reconnectAttempts);
    }
  }

  function handleMessage(message) {
    switch (message.type) {
      case 'connected':
        console.log('[Mandu HMR] Ready');
        break;

      case 'reload':
        console.log('[Mandu HMR] Full reload requested');
        location.reload();
        break;

      case 'island-update':
        const routeId = message.data?.routeId;
        console.log('[Mandu HMR] Island updated:', routeId);

        // 현재 페이지의 island인지 확인
        const island = document.querySelector('[data-mandu-island="' + routeId + '"]');
        if (island) {
          console.log('[Mandu HMR] Reloading page for island update');
          location.reload();
        }
        break;

      case 'error':
        console.error('[Mandu HMR] Build error:', message.data?.message);
        showErrorOverlay(message.data?.message);
        break;

      case 'pong':
        // 연결 확인
        break;
    }
  }

  function showErrorOverlay(message) {
    // 기존 오버레이 제거
    const existing = document.getElementById('mandu-hmr-error');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mandu-hmr-error';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);color:#ff6b6b;font-family:monospace;padding:40px;z-index:99999;overflow:auto;';
    overlay.innerHTML = '<h2 style="color:#ff6b6b;margin:0 0 20px;">🔥 Build Error</h2><pre style="white-space:pre-wrap;word-break:break-all;">' + (message || 'Unknown error') + '</pre><button onclick="this.parentElement.remove()" style="position:fixed;top:20px;right:20px;background:#333;color:#fff;border:none;padding:10px 20px;cursor:pointer;">Close</button>';
    document.body.appendChild(overlay);
  }

  // 페이지 로드 시 연결
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }

  // 페이지 이탈 시 정리
  window.addEventListener('beforeunload', function() {
    if (ws) ws.close();
  });

  // Ping 전송 (연결 유지)
  setInterval(function() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
})();
`;
}
