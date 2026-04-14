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

/**
 * #184: 공통 디렉토리 변경 시 사용하는 sentinel.
 * `onSSRChange`에 특정 파일 경로 대신 이 상수를 전달하면 "전체 SSR 레지스트리 invalidate" 의미.
 */
export const SSR_CHANGE_WILDCARD = "*";

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
   * SSR 파일 변경 콜백 (page.tsx, layout.tsx 등)
   * 클라이언트 번들 리빌드 없이 서버 핸들러 재등록이 필요한 경우 호출.
   * `SSR_CHANGE_WILDCARD` ("*")를 받으면 전체 레지스트리 invalidate 의미 (#184).
   * Promise 반환 시 await 되므로 레지스트리 clear가 완료된 후 HMR reload broadcast 가능.
   */
  onSSRChange?: (filePath: string) => void | Promise<void>;
  /**
   * API route 파일 변경 콜백 (route.ts 등)
   * API 핸들러 재등록이 필요한 경우 호출
   */
  onAPIChange?: (filePath: string) => void | Promise<void>;
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

/**
 * #180: 파일 경로 비교를 위한 정규화.
 * - 절대 경로로 변환 (path.resolve)
 * - 백슬래시 → 포워드슬래시
 * - Windows에서는 case-insensitive 매칭 (소문자화)
 *
 * 동적 라우트 폴더(`[lang]` 등) 변경 감지가 누락되던 문제는 watcher가 보고하는
 * `path.join(dir, filename)`과 `serverModuleSet` 등록 시의 `path.resolve(rootDir, ...)`
 * 가 드라이브 문자 대소문자/슬래시 표기 차이로 어긋나서 발생했음.
 */
function normalizeFsPath(p: string): string {
  const resolved = path.resolve(p).replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
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
    onSSRChange,
    onAPIChange,
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
  const serverModuleSet = new Set<string>(); // SSR 모듈 (page.tsx, layout.tsx)
  const apiModuleSet = new Set<string>(); // API 모듈 (route.ts)
  const watchDirs = new Set<string>();
  const commonWatchDirs = new Set<string>(); // 공통 디렉토리 (전체 재빌드 트리거)

  for (const route of manifest.routes) {
    if (route.clientModule) {
      const absPath = path.resolve(rootDir, route.clientModule);
      const normalizedPath = normalizeFsPath(absPath);
      clientModuleToRoute.set(normalizedPath, route.id);

      // Also register *.client.tsx/ts files in the same directory (#140)
      // e.g. if clientModule is app/page.island.tsx, also map app/page.client.tsx → same routeId
      const dir = path.dirname(absPath);
      const baseStem = path.basename(absPath).replace(/\.(island|client)\.(tsx?|jsx?)$/, "");
      for (const ext of [".client.tsx", ".client.ts", ".client.jsx", ".client.js"]) {
        const clientPath = normalizeFsPath(path.join(dir, baseStem + ext));
        if (clientPath !== normalizedPath) {
          clientModuleToRoute.set(clientPath, route.id);
        }
      }

      // 감시할 디렉토리 추가
      watchDirs.add(dir);
    }

    // SSR 모듈 등록 (page.tsx, layout.tsx) — #151
    if (route.componentModule) {
      const absPath = path.resolve(rootDir, route.componentModule);
      serverModuleSet.add(normalizeFsPath(absPath));
      watchDirs.add(path.dirname(absPath));
    }
    if (route.layoutChain) {
      for (const layoutPath of route.layoutChain) {
        const absPath = path.resolve(rootDir, layoutPath);
        serverModuleSet.add(normalizeFsPath(absPath));
        watchDirs.add(path.dirname(absPath));
      }
    }

    // Track API route modules for hot-reload
    if (route.kind === "api" && route.module) {
      const absPath = path.resolve(rootDir, route.module);
      apiModuleSet.add(normalizeFsPath(absPath));
      watchDirs.add(path.dirname(absPath));
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
  // 동시 빌드 방지 (#121): 빌드 중에 변경 발생 시 다음 빌드 대기
  let isBuilding = false;
  let pendingBuildFile: string | null = null;

  // 파일이 공통 디렉토리에 있는지 확인
  const isInCommonDir = (filePath: string): boolean => {
    const normalizedFile = normalizeFsPath(filePath);
    for (const commonDir of commonWatchDirs) {
      const normalizedCommon = normalizeFsPath(commonDir);
      if (normalizedFile.startsWith(normalizedCommon + "/")) {
        return true;
      }
    }
    return false;
  };

  const handleFileChange = async (changedFile: string) => {
    // 동시 빌드 방지 (#121): 빌드 중이면 대기 큐에 저장
    if (isBuilding) {
      pendingBuildFile = changedFile;
      return;
    }

    isBuilding = true;
    try {
      await _doBuild(changedFile);
    } finally {
      isBuilding = false;
      // 빌드 중 대기 중인 파일이 있으면 즉시 처리
      if (pendingBuildFile) {
        const next = pendingBuildFile;
        pendingBuildFile = null;
        // Catch errors to prevent unhandled promise rejection from killing the watcher (#10)
        try {
          await handleFileChange(next);
        } catch (retryError) {
          console.error(`❌ Retry build error:`, retryError instanceof Error ? retryError.message : String(retryError));
          console.log(`   ⏳ Waiting for next file change to retry...`);
        }
      }
    }
  };

  const _doBuild = async (changedFile: string) => {
    const normalizedPath = normalizeFsPath(changedFile);

    // 공통 컴포넌트 디렉토리 변경 → Island만 재빌드 + SSR 레지스트리 invalidate (#184, #185)
    if (isInCommonDir(changedFile)) {
      console.log(`\n🔄 Common file changed: ${path.basename(changedFile)}`);
      console.log(`   Rebuilding islands (framework bundles skipped)...`);
      const startTime = performance.now();

      try {
        // #185: framework 번들 (runtime/router/vendor/devtools) 스킵 — 사용자 코드 변경 시 불필요
        const result = await buildClientBundles(manifest, rootDir, {
          minify: false,
          sourcemap: true,
          skipFrameworkBundles: true,
        });

        const buildTime = performance.now() - startTime;

        // #184: common dir 변경은 SSR 모듈 캐시 invalidation이 필요 — wildcard 시그널
        // 주의: Bun의 transitive ESM 캐시는 프로세스 레벨이라 이 시그널만으로는
        //      `src/shared/**`을 transitive하게 import하는 SSR 모듈까지 완전히 갱신되지 않음.
        //      진짜 해결은 subprocess/worker 기반 SSR eval이 필요 (follow-up 이슈).
        if (onSSRChange) {
          try {
            await Promise.resolve(onSSRChange(SSR_CHANGE_WILDCARD));
          } catch (ssrError) {
            console.warn(`⚠️  SSR invalidation failed:`, ssrError instanceof Error ? ssrError.message : ssrError);
          }
        }

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
        console.log(`   ⏳ Waiting for next file change to retry...`);
        onError?.(err, "*");
      }
      return;
    }

    // clientModule 매핑에서 routeId 찾기
    let routeId = clientModuleToRoute.get(normalizedPath);

    // Fallback for *.client.tsx/ts: find route whose clientModule is in the same directory (#140)
    // basename matching (e.g. "page" !== "index") is unreliable — use directory-based matching instead
    if (!routeId && (changedFile.endsWith(".client.ts") || changedFile.endsWith(".client.tsx"))) {
      const changedDir = normalizeFsPath(path.dirname(path.resolve(rootDir, changedFile)));
      const matchedRoute = manifest.routes.find((r) => {
        if (!r.clientModule) return false;
        const routeDir = normalizeFsPath(path.dirname(path.resolve(rootDir, r.clientModule)));
        return routeDir === changedDir;
      });
      if (matchedRoute) {
        routeId = matchedRoute.id;
      }
    }

    if (!routeId) {
      // SSR 모듈 변경 감지 (page.tsx, layout.tsx) — #151
      if (onSSRChange && serverModuleSet.has(normalizedPath)) {
        console.log(`\n🔄 SSR file changed: ${path.basename(changedFile)}`);
        onSSRChange(normalizedPath);
        return;
      }
      // API 모듈 변경 감지 (route.ts)
      if (onAPIChange && apiModuleSet.has(normalizedPath)) {
        console.log(`\n🔄 API route changed: ${path.basename(changedFile)}`);
        onAPIChange(normalizedPath);
      }
      return;
    }

    const route = manifest.routes.find((r) => r.id === routeId);
    if (!route || !route.clientModule) return;

    console.log(`\n🔄 Rebuilding island: ${routeId}`);
    const startTime = performance.now();

    try {
      // 단일 island만 재빌드 (Runtime/Router/Vendor 스킵, #122)
      const result = await buildClientBundles(manifest, rootDir, {
        minify: false,
        sourcemap: true,
        targetRouteIds: [routeId],
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
        console.log(`   ⏳ Previous bundle preserved. Waiting for next file change to retry...`);
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
      console.log(`   ⏳ Previous bundle preserved. Waiting for next file change to retry...`);
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
        .map(d => (path.relative(rootDir, d) || ".").replace(/\\/g, "/"))
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
  /** 재시작 핸들러 등록 */
  setRestartHandler: (handler: () => Promise<void>) => void;
}

export interface HMRMessage {
  type:
    | "connected"
    | "reload"
    | "island-update"
    | "layout-update"
    | "css-update"
    | "error"
    | "ping"
    | "guard-violation"
    | "kitchen:file-change"
    | "kitchen:guard-decision";
  data?: {
    routeId?: string;
    layoutPath?: string;
    cssPath?: string;
    message?: string;
    timestamp?: number;
    file?: string;
    violations?: Array<{ line: number; message: string }>;
    changeType?: "add" | "change" | "delete";
    action?: "approve" | "reject";
    ruleId?: string;
  };
}

/**
 * HMR WebSocket 서버 생성
 */
export function createHMRServer(port: number): HMRServer {
  const clients = new Set<{ send: (data: string) => void; close: () => void }>();
  const hmrPort = port + PORTS.HMR_OFFSET;
  let restartHandler: (() => Promise<void>) | null = null;

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": `http://localhost:${port}`,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  const server = Bun.serve({
    port: hmrPort,
    async fetch(req, server) {
      const url = new URL(req.url);

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // POST /restart → 재시작 핸들러 호출
      if (req.method === "POST" && url.pathname === "/restart") {
        if (!restartHandler) {
          return new Response(
            JSON.stringify({ error: "No restart handler registered" }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        try {
          console.log("🔄 Full restart requested from DevTools");
          await restartHandler();
          return new Response(
            JSON.stringify({ status: "restarted" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("❌ Restart failed:", message);
          return new Response(
            JSON.stringify({ error: message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

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
          headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    setRestartHandler: (handler: () => Promise<void>) => {
      restartHandler = handler;
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
  window.__MANDU_HMR_PORT__ = ${hmrPort};
  const HMR_PORT = ${hmrPort};
  let ws = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = ${TIMEOUTS.HMR_MAX_RECONNECT};
  const reconnectDelay = ${TIMEOUTS.HMR_RECONNECT_DELAY};
  const staleIslands = new Set();

  function connect() {
    try {
      ws = new WebSocket('ws://' + window.location.hostname + ':' + HMR_PORT);

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
      var delay = Math.min(reconnectDelay * Math.pow(2, reconnectAttempts - 1), 30000);
      console.log('[Mandu HMR] Reconnecting in ' + delay + 'ms (' + reconnectAttempts + '/' + maxReconnectAttempts + ')');
      setTimeout(connect, delay);
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
        staleIslands.add(routeId);

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

      case 'css-update':
        console.log('[Mandu HMR] CSS updated');
        // CSS 핫 리로드 (페이지 새로고침 없이 스타일시트만 교체)
        var targetCssPath = message.data?.cssPath || '/.mandu/client/globals.css';
        var links = document.querySelectorAll('link[rel="stylesheet"]');
        links.forEach(function(link) {
          var href = link.getAttribute('href') || '';
          var baseHref = href.split('?')[0];
          // 정확한 경로 매칭 우선, fallback으로 기존 패턴 매칭
          if (baseHref === targetCssPath || href.includes('globals.css') || href.includes('.mandu/client')) {
            link.setAttribute('href', baseHref + '?t=' + Date.now());
          }
        });
        break;

      case 'error':
        console.error('[Mandu HMR] Build error:', message.data?.message);
        showErrorOverlay(message.data?.message);
        break;

      case 'guard-violation':
        console.warn('[Mandu HMR] Guard violation:', message.data?.file);
        if (window.__MANDU_DEVTOOLS_HOOK__) {
          window.__MANDU_DEVTOOLS_HOOK__.emit({
            type: 'guard:violation',
            timestamp: Date.now(),
            data: message.data
          });
        }
        break;

      case 'kitchen:file-change':
        if (window.__MANDU_DEVTOOLS_HOOK__) {
          window.__MANDU_DEVTOOLS_HOOK__.emit({
            type: 'kitchen:file-change',
            timestamp: Date.now(),
            data: message.data
          });
        }
        break;

      case 'kitchen:guard-decision':
        if (window.__MANDU_DEVTOOLS_HOOK__) {
          window.__MANDU_DEVTOOLS_HOOK__.emit({
            type: 'kitchen:guard-decision',
            timestamp: Date.now(),
            data: message.data
          });
        }
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
    const h2 = document.createElement('h2');
    h2.style.cssText = 'color:#ff6b6b;margin:0 0 20px;';
    h2.textContent = '🔥 Build Error';
    const pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;';
    pre.textContent = message || 'Unknown error';
    const btn = document.createElement('button');
    btn.style.cssText = 'position:fixed;top:20px;right:20px;background:#333;color:#fff;border:none;padding:10px 20px;cursor:pointer;';
    btn.textContent = 'Close';
    btn.onclick = function() { overlay.remove(); };
    overlay.appendChild(h2);
    overlay.appendChild(pre);
    overlay.appendChild(btn);
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

  // 페이지 이동 시 stale island 감지 후 리로드 (#115)
  function checkStaleIslandsOnNavigation() {
    if (staleIslands.size === 0) return;
    for (const id of staleIslands) {
      if (document.querySelector('[data-mandu-island="' + id + '"]')) {
        console.log('[Mandu HMR] Stale island detected after navigation, reloading...');
        location.reload();
        return;
      }
    }
  }
  window.addEventListener('popstate', checkStaleIslandsOnNavigation);
  window.addEventListener('pageshow', function(e) {
    if (e.persisted) checkStaleIslandsOnNavigation();
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
