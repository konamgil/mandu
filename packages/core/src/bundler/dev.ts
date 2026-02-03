/**
 * Mandu Dev Bundler 🔥
 * 개발 모드 번들링 + HMR (Hot Module Replacement)
 */

import type { RoutesManifest, RouteSpec } from "../spec/schema";
import { buildClientBundles } from "./build";
import type { BundleResult } from "./types";
import { PORTS, TIMEOUTS } from "../constants";
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
  /**
   * 추가 watch 디렉토리 (공통 컴포넌트 등)
   * 상대 경로 또는 절대 경로 모두 지원
   * 기본값: ["src/components", "components", "src/shared", "shared", "src/lib", "lib", "src/hooks", "hooks", "src/utils", "utils"]
   */
  watchDirs?: string[];
  /**
   * 기본 watch 디렉토리 비활성화
   * true로 설정하면 watchDirs만 감시
   */
  disableDefaultWatchDirs?: boolean;
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

// 기본 공통 컴포넌트 디렉토리 목록
const DEFAULT_COMMON_DIRS = [
  "src/components",
  "components",
  "src/shared",
  "shared",
  "src/lib",
  "lib",
  "src/hooks",
  "hooks",
  "src/utils",
  "utils",
  // Islands & Client 디렉토리
  "src/client",
  "client",
  "src/islands",
  "islands",
  "apps/web",
];

/**
 * 개발 모드 번들러 시작
 * 파일 변경 감시 및 자동 재빌드
 */
export async function startDevBundler(options: DevBundlerOptions): Promise<DevBundler> {
  const {
    rootDir,
    manifest,
    onRebuild,
    onError,
    watchDirs: customWatchDirs = [],
    disableDefaultWatchDirs = false,
  } = options;

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

  // clientModule 경로에서 routeId 매핑 생성
  const clientModuleToRoute = new Map<string, string>();
  const watchDirs = new Set<string>();
  const commonWatchDirs = new Set<string>(); // 공통 디렉토리 (전체 재빌드 트리거)

  for (const route of manifest.routes) {
    if (route.clientModule) {
      const absPath = path.resolve(rootDir, route.clientModule);
      const normalizedPath = absPath.replace(/\\/g, "/");
      clientModuleToRoute.set(normalizedPath, route.id);

      // 감시할 디렉토리 추가
      const dir = path.dirname(absPath);
      watchDirs.add(dir);
    }
  }

  // spec/slots 디렉토리도 추가
  const slotsDir = path.join(rootDir, "spec", "slots");
  try {
    await fs.promises.access(slotsDir);
    watchDirs.add(slotsDir);
  } catch {
    // slots 디렉토리 없으면 무시
  }

  // 공통 컴포넌트 디렉토리 추가 (기본 + 커스텀)
  const commonDirsToCheck = disableDefaultWatchDirs
    ? customWatchDirs
    : [...DEFAULT_COMMON_DIRS, ...customWatchDirs];

  const addCommonDir = async (dir: string): Promise<void> => {
    const absPath = path.isAbsolute(dir) ? dir : path.join(rootDir, dir);
    try {
      const stat = await fs.promises.stat(absPath);
      const watchPath = stat.isDirectory() ? absPath : path.dirname(absPath);
      await fs.promises.access(watchPath);
      commonWatchDirs.add(watchPath);
      watchDirs.add(watchPath);
    } catch {
      // 디렉토리 없으면 무시
    }
  };

  for (const dir of commonDirsToCheck) {
    await addCommonDir(dir);
  }

  // 파일 감시 설정
  const watchers: fs.FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // 파일이 공통 디렉토리에 있는지 확인
  const isInCommonDir = (filePath: string): boolean => {
    const normalizedFile = path.resolve(filePath).replace(/\\/g, "/");
    for (const commonDir of commonWatchDirs) {
      const normalizedCommon = path.resolve(commonDir).replace(/\\/g, "/");
      if (normalizedFile.startsWith(normalizedCommon + "/")) {
        return true;
      }
    }
    return false;
  };

  const handleFileChange = async (changedFile: string) => {
    const normalizedPath = changedFile.replace(/\\/g, "/");

    // 공통 컴포넌트 디렉토리 변경 → 전체 재빌드
    if (isInCommonDir(changedFile)) {
      console.log(`\n🔄 Common file changed: ${path.basename(changedFile)}`);
      console.log(`   Rebuilding all islands...`);
      const startTime = performance.now();

      try {
        const result = await buildClientBundles(manifest, rootDir, {
          minify: false,
          sourcemap: true,
        });

        const buildTime = performance.now() - startTime;

        if (result.success) {
          console.log(`✅ Rebuilt ${result.stats.bundleCount} islands in ${buildTime.toFixed(0)}ms`);
          onRebuild?.({
            routeId: "*", // 전체 재빌드 표시
            success: true,
            buildTime,
          });
        } else {
          console.error(`❌ Build failed:`, result.errors);
          onRebuild?.({
            routeId: "*",
            success: false,
            buildTime,
            error: result.errors.join(", "),
          });
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(`❌ Build error:`, err.message);
        onError?.(err, "*");
      }
      return;
    }

    // clientModule 매핑에서 routeId 찾기
    let routeId = clientModuleToRoute.get(normalizedPath);

    // .client.ts 또는 .client.tsx 파일인 경우 파일명에서 routeId 추출
    if (!routeId) {
      let basename: string | null = null;

      if (changedFile.endsWith(".client.ts")) {
        basename = path.basename(changedFile, ".client.ts");
      } else if (changedFile.endsWith(".client.tsx")) {
        basename = path.basename(changedFile, ".client.tsx");
      }

      if (basename) {
        const route = manifest.routes.find((r) => r.id === basename);
        if (route) {
          routeId = route.id;
        }
      }
    }

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
  };

  // 각 디렉토리에 watcher 설정
  for (const dir of watchDirs) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, async (event, filename) => {
        if (!filename) return;

        // TypeScript/TSX 파일만 감시
        if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) return;

        const fullPath = path.join(dir, filename);

        // Debounce - 연속 변경 무시
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => handleFileChange(fullPath), TIMEOUTS.WATCHER_DEBOUNCE);
      });

      watchers.push(watcher);
    } catch {
      console.warn(`⚠️  Cannot watch directory: ${dir}`);
    }
  }

  if (watchers.length > 0) {
    console.log(`👀 Watching ${watchers.length} directories for changes...`);
    if (commonWatchDirs.size > 0) {
      const commonDirNames = Array.from(commonWatchDirs)
        .map(d => path.relative(rootDir, d) || ".")
        .join(", ");
      console.log(`📦 Common dirs (full rebuild): ${commonDirNames}`);
    }
  }

  return {
    initialBuild,
    close: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      for (const watcher of watchers) {
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
  type: "connected" | "reload" | "island-update" | "layout-update" | "error" | "ping";
  data?: {
    routeId?: string;
    layoutPath?: string;
    message?: string;
    timestamp?: number;
  };
}

/**
 * HMR WebSocket 서버 생성
 */
export function createHMRServer(port: number): HMRServer {
  const clients = new Set<any>();
  const hmrPort = port + PORTS.HMR_OFFSET;

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
  const hmrPort = port + PORTS.HMR_OFFSET;

  return `
(function() {
  const HMR_PORT = ${hmrPort};
  let ws = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = ${TIMEOUTS.HMR_MAX_RECONNECT};
  const reconnectDelay = ${TIMEOUTS.HMR_RECONNECT_DELAY};

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

      case 'layout-update':
        const layoutPath = message.data?.layoutPath;
        console.log('[Mandu HMR] Layout updated:', layoutPath);
        // Layout 변경은 항상 전체 리로드
        location.reload();
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
