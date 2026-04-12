/**
 * Mandu Prerender Engine
 * 빌드 타임에 정적 HTML 생성 (SSG)
 */

import path from "path";
import fs from "fs/promises";
import type { RoutesManifest } from "../spec/schema";

// ========== Types ==========

export interface PrerenderOptions {
  /** 프로젝트 루트 */
  rootDir: string;
  /** 출력 디렉토리 (기본: ".mandu/static") */
  outDir?: string;
  /** 프리렌더할 추가 경로 목록 */
  routes?: string[];
  /** 링크 크롤링으로 자동 발견 (기본: false) */
  crawl?: boolean;
}

export interface PrerenderResult {
  /** 생성된 페이지 수 */
  generated: number;
  /** 생성된 경로별 정보 */
  pages: PrerenderPageResult[];
  /** 에러 목록 */
  errors: string[];
}

export interface PrerenderPageResult {
  path: string;
  size: number;
  duration: number;
}

// ========== Implementation ==========

/**
 * 정적 라우트를 HTML로 프리렌더링
 *
 * @example
 * ```typescript
 * const result = await prerenderRoutes(manifest, fetchHandler, {
 *   rootDir: process.cwd(),
 *   routes: ["/about", "/blog/hello-world"],
 * });
 * ```
 */
export async function prerenderRoutes(
  manifest: RoutesManifest,
  fetchHandler: (req: Request) => Promise<Response>,
  options: PrerenderOptions
): Promise<PrerenderResult> {
  const { rootDir, outDir = ".mandu/static", crawl = false } = options;
  const outputDir = path.isAbsolute(outDir) ? outDir : path.join(rootDir, outDir);

  await fs.mkdir(outputDir, { recursive: true });

  const pages: PrerenderPageResult[] = [];
  const errors: string[] = [];
  const renderedPaths = new Set<string>();

  // 1. 명시적으로 지정된 경로 수집
  const pathsToRender = new Set<string>(options.routes ?? []);

  // 2. 매니페스트에서 정적 페이지 라우트 수집 (동적 파라미터 없는 것)
  for (const route of manifest.routes) {
    if (route.kind === "page" && !route.pattern.includes(":")) {
      pathsToRender.add(route.pattern);
    }
  }

  // 3. 동적 라우트의 generateStaticParams 수집
  for (const route of manifest.routes) {
    if (route.kind === "page" && route.pattern.includes(":")) {
      try {
        const modulePath = path.join(rootDir, route.module).replace(/\\/g, "/");
        const mod = await import(modulePath);
        if (typeof mod.generateStaticParams === "function") {
          const paramSets = await mod.generateStaticParams();
          if (Array.isArray(paramSets)) {
            for (const params of paramSets) {
              const resolvedPath = resolvePattern(route.pattern, params);
              pathsToRender.add(resolvedPath);
            }
          } else if (paramSets) {
            console.warn(`[Mandu Prerender] generateStaticParams() for ${route.pattern} returned non-array. Expected an array of param objects.`);
          }
        }
      } catch {
        // generateStaticParams 없으면 스킵
      }
    }
  }

  // 4. 각 경로를 렌더링
  for (const pathname of pathsToRender) {
    if (renderedPaths.has(pathname)) continue;
    renderedPaths.add(pathname);

    const start = Date.now();
    try {
      const request = new Request(`http://localhost${pathname}`);
      const response = await fetchHandler(request);

      if (!response.ok) {
        errors.push(`[${pathname}] HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();
      const filePath = getOutputPath(outputDir, pathname);

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, html, "utf-8");

      const duration = Date.now() - start;
      pages.push({ path: pathname, size: html.length, duration });

      // 5. 크롤링: 생성된 HTML에서 내부 링크 추출
      if (crawl) {
        const links = extractInternalLinks(html, pathname);
        for (const link of links) {
          if (!renderedPaths.has(link) && !pathsToRender.has(link)) {
            pathsToRender.add(link);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`[${pathname}] ${message}`);
    }
  }

  return { generated: pages.length, pages, errors };
}

// ========== Helpers ==========

/**
 * 라우트 패턴에 파라미터를 대입하여 실제 경로 생성
 */
function resolvePattern(pattern: string, params: Record<string, string>): string {
  let result = pattern;
  for (const [key, value] of Object.entries(params)) {
    // catch-all (:param*) / optional catch-all (:param*?) 지원
    const paramRegex = new RegExp(`:${key}\\*\\??`);
    if (paramRegex.test(result)) {
      // catch-all: 각 세그먼트를 개별 인코딩 (슬래시 보존)
      const encoded = value.split("/").map(encodeURIComponent).join("/");
      result = result.replace(paramRegex, encoded);
    } else {
      result = result.replace(`:${key}`, encodeURIComponent(value));
    }
  }
  return result;
}

/**
 * 출력 파일 경로 생성
 * /about → .mandu/static/about/index.html
 * / → .mandu/static/index.html
 */
function getOutputPath(outDir: string, pathname: string): string {
  const trimmed = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  if (trimmed === "/") return path.join(outDir, "index.html");
  // /blog/post → .mandu/static/blog/post/index.html (clean URL)
  return path.join(outDir, trimmed, "index.html");
}

/**
 * HTML에서 내부 링크 추출 (크롤링용)
 */
function extractInternalLinks(html: string, currentPath: string): string[] {
  const links: string[] = [];
  const hrefRegex = /href=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    // 내부 링크만 (절대 경로이면서 프로토콜 없는 것)
    if (href.startsWith("/") && !href.startsWith("//")) {
      // 쿼리스트링/해시 제거
      const cleanPath = href.split("?")[0].split("#")[0];
      // 정적 파일 제외
      if (!cleanPath.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)) {
        links.push(cleanPath);
      }
    }
  }

  return [...new Set(links)];
}
