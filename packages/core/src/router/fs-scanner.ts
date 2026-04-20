/**
 * FS Routes Scanner
 *
 * 파일 시스템을 스캔하여 라우트 파일을 탐지
 *
 * @module router/fs-scanner
 */

import { stat } from "fs/promises";
import { join, relative, basename, extname } from "path";
import type {
  ScannedFile,
  FSScannerConfig,
  ScanResult,
  ScanError,
  ScanStats,
  FSRouteConfig,
} from "./fs-types";
import { DEFAULT_SCANNER_CONFIG } from "./fs-types";
import {
  parseSegments,
  segmentsToPattern,
  detectFileType,
  detectMetadataFileKind,
  isPrivateFolder,
  generateRouteId,
  validateSegments,
  sortRoutesByPriority,
  getPatternShape,
} from "./fs-patterns";
import { mark, measure } from "../perf";
import { METADATA_ROUTES } from "../routes/types";

// ═══════════════════════════════════════════════════════════════════════════
// Scanner Class
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FS Routes 스캐너
 *
 * @example
 * const scanner = new FSScanner({ routesDir: "app" });
 * const result = await scanner.scan("/path/to/project");
 */
export class FSScanner {
  private config: FSScannerConfig;
  private excludeMatchers: RegExp[];

  constructor(config: Partial<FSScannerConfig> = {}) {
    this.config = { ...DEFAULT_SCANNER_CONFIG, ...config };
    this.excludeMatchers = this.config.exclude.map(globToRegExp);
  }

  /**
   * 디렉토리 스캔 수행
   *
   * @param rootDir 프로젝트 루트 디렉토리
   * @returns 스캔 결과
   */
  async scan(rootDir: string): Promise<ScanResult> {
    mark("router:scan");
    const startTime = Date.now();
    const routesDir = join(rootDir, this.config.routesDir);

    const files: ScannedFile[] = [];
    const errors: ScanError[] = [];

    // 라우트 디렉토리 존재 확인
    try {
      const dirStat = await stat(routesDir);
      if (!dirStat.isDirectory()) {
        errors.push({
          type: "file_read_error",
          message: `${this.config.routesDir} is not a directory`,
          filePath: routesDir,
        });
        return this.createEmptyResult(errors, Date.now() - startTime);
      }
    } catch {
      // 디렉토리가 없으면 빈 결과 반환 (에러 아님)
      return this.createEmptyResult([], Date.now() - startTime);
    }

    // Bun.Glob 기반 스캔
    await this.scanWithGlob(rootDir, routesDir, files, errors);

    // 라우트 설정 생성
    const { routes, routeErrors } = await this.createRouteConfigs(files, rootDir);
    errors.push(...routeErrors);

    // 통계 계산
    const stats = this.calculateStats(files, routes, Date.now() - startTime);

    measure("router:scan", "router:scan");
    return {
      files,
      routes: sortRoutesByPriority(routes),
      errors,
      stats,
    };
  }

  /**
   * Bun.Glob 기반 스캔
   */
  private async scanWithGlob(
    rootDir: string,
    routesRoot: string,
    files: ScannedFile[],
    errors: ScanError[]
  ): Promise<void> {
    const routesDirPattern = this.config.routesDir.replace(/\\/g, "/").replace(/\/+$/, "");
    const extensions = this.config.extensions
      .map((ext) => ext.replace(/^\./, ""))
      .filter(Boolean)
      .join(",");

    if (!routesDirPattern || !extensions) {
      return;
    }

    const pattern = `${routesDirPattern}/**/*.{${extensions}}`;
    const glob = new Bun.Glob(pattern);
    const foundFiles: string[] = [];

    try {
      for await (const filePath of glob.scan({ cwd: rootDir, absolute: true })) {
        foundFiles.push(filePath);
      }
    } catch (error) {
      errors.push({
        type: "file_read_error",
        message: `Failed to scan directory: ${error instanceof Error ? error.message : String(error)}`,
        filePath: routesRoot,
      });
      return;
    }

    foundFiles.sort((a, b) => a.localeCompare(b));

    for (const fullPath of foundFiles) {
      const relativePath = relative(routesRoot, fullPath).replace(/\\/g, "/");
      if (relativePath.startsWith("..")) {
        continue;
      }

      if (this.isExcluded(relativePath, false)) {
        continue;
      }

      if (this.hasPrivateSegment(relativePath)) {
        continue;
      }

      const pathSegments = relativePath.split("/");
      if (pathSegments.includes("node_modules")) {
        continue;
      }

      const fileName = basename(fullPath);
      const ext = extname(fileName);
      if (!this.config.extensions.includes(ext)) {
        continue;
      }

      const fileType = detectFileType(fileName, this.config.islandSuffix);
      if (!fileType) {
        continue;
      }

      // Issue #206: metadata routes (sitemap/robots/llms.txt/manifest)
      // must sit at the routesDir root — a nested
      // `app/foo/sitemap.ts` would be ambiguous (group-scoped
      // sitemap? route under /foo?) so we report it as an error
      // instead of silently serving /sitemap.xml from the wrong file.
      if (fileType === "metadata") {
        if (relativePath.includes("/")) {
          errors.push({
            type: "invalid_segment",
            message:
              `Metadata routes must sit directly under "${this.config.routesDir}/". ` +
              `Found "${relativePath}" — move it to "${this.config.routesDir}/${fileName}".`,
            filePath: fullPath,
          });
          continue;
        }
        const metadataKind = detectMetadataFileKind(fileName);
        if (!metadataKind) {
          // Defensive: detectFileType returned "metadata" but the
          // narrower helper can't identify which one. Only reachable
          // if the two detection paths drift.
          continue;
        }
        files.push({
          absolutePath: fullPath,
          relativePath,
          type: fileType,
          segments: [],
          extension: ext,
          metadataKind,
        });
        continue;
      }

      const segments = parseSegments(relativePath);
      const validation = validateSegments(segments);
      if (!validation.valid) {
        errors.push({
          type: "invalid_segment",
          message: validation.error!,
          filePath: fullPath,
        });
        continue;
      }

      files.push({
        absolutePath: fullPath,
        relativePath,
        type: fileType,
        segments,
        extension: ext,
      });
    }
  }

  /**
   * 스캔된 파일에서 라우트 설정 생성
   */
  private async createRouteConfigs(
    files: ScannedFile[],
    rootDir: string
  ): Promise<{ routes: FSRouteConfig[]; routeErrors: ScanError[] }> {
    const routes: FSRouteConfig[] = [];
    const routeErrors: ScanError[] = [];

    // 패턴별 라우트 매핑 (중복/충돌 감지용)
    const patternMap = new Map<string, FSRouteConfig>();
    const shapeMap = new Map<string, FSRouteConfig>();

    // 파일 맵 수집 (single pass)
    const layoutMap = new Map<string, ScannedFile>();
    const loadingMap = new Map<string, ScannedFile>();
    const errorMap = new Map<string, ScannedFile>();
    const notFoundMap = new Map<string, ScannedFile>();
    const islandMap = new Map<string, ScannedFile[]>();
    const routeFiles: ScannedFile[] = [];
    const metadataFiles: ScannedFile[] = [];

    for (const file of files) {
      const dirPath = this.getDirPath(file.relativePath);

      switch (file.type) {
        case "layout":
          layoutMap.set(dirPath, file);
          break;
        case "loading":
          loadingMap.set(dirPath, file);
          break;
        case "error":
          errorMap.set(dirPath, file);
          break;
        case "not-found":
          notFoundMap.set(dirPath, file);
          break;
        case "island": {
          const existing = islandMap.get(dirPath);
          if (existing) {
            existing.push(file);
          } else {
            islandMap.set(dirPath, [file]);
          }
          break;
        }
        case "page":
        case "route":
          routeFiles.push(file);
          break;
        case "metadata":
          metadataFiles.push(file);
          break;
        default:
          break;
      }
    }

    // Issue #206: emit metadata-route entries first so the normal
    // page/route loop below can surface "duplicate pattern" errors if
    // a user ever creates e.g. `app/sitemap.xml/page.tsx` alongside
    // `app/sitemap.ts` (both map to /sitemap.xml).
    for (const file of metadataFiles) {
      if (!file.metadataKind) continue;
      const meta = METADATA_ROUTES[file.metadataKind];
      const pattern = meta.pattern;
      const routeId = `metadata-${file.metadataKind}`;
      const modulePath = join(this.config.routesDir, file.relativePath).replace(/\\/g, "/");

      const existing = patternMap.get(pattern);
      if (existing) {
        routeErrors.push({
          type: "duplicate_route",
          message: `Duplicate route pattern "${pattern}" — metadata route "${file.relativePath}" conflicts with "${existing.sourceFile}"`,
          filePath: file.absolutePath,
          conflictsWith: existing.sourceFile,
        });
        continue;
      }

      const route: FSRouteConfig = {
        id: routeId,
        segments: [],
        pattern,
        kind: "metadata",
        module: modulePath,
        layoutChain: [],
        sourceFile: file.absolutePath,
        metadataKind: file.metadataKind,
        contentType: meta.contentType,
      };

      routes.push(route);
      patternMap.set(pattern, route);
      shapeMap.set(pattern, route);
    }

    // 페이지 및 API 라우트 처리
    for (const file of routeFiles) {
      const pattern = segmentsToPattern(file.segments);
      const patternShape = getPatternShape(pattern);
      const routeId = generateRouteId(file.relativePath);
      const modulePath = join(this.config.routesDir, file.relativePath).replace(/\\/g, "/");

      // 중복 패턴 체크
      const existingRoute = patternMap.get(pattern);
      if (existingRoute) {
        routeErrors.push({
          type: "duplicate_route",
          message: `Duplicate route pattern "${pattern}"`,
          filePath: file.absolutePath,
          conflictsWith: existingRoute.sourceFile,
        });
        continue;
      }

      // 패턴 충돌 체크 (파라미터 이름만 다른 경우 등)
      const conflictingRoute = shapeMap.get(patternShape);
      if (conflictingRoute) {
        routeErrors.push({
          type: "pattern_conflict",
          message: `Route pattern "${pattern}" conflicts with "${conflictingRoute.pattern}"`,
          filePath: file.absolutePath,
          conflictsWith: conflictingRoute.sourceFile,
        });
        continue;
      }

      // 레이아웃 체인 구성
      const layoutChain = this.resolveLayoutChain(file.segments, layoutMap);

      // Island 파일 찾기 (같은 디렉토리)
      const dirPath = this.getDirPath(file.relativePath);
      const islands = islandMap.get(dirPath);

      // clientModule 결정: island 파일 또는 "use client"가 있는 page 자체
      let clientModule: string | undefined;
      let pageFileContent: string | null = null;

      if (file.type === "page") {
        try {
          pageFileContent = await Bun.file(file.absolutePath).text();
        } catch {
          pageFileContent = null;
        }
      }

      if (islands?.[0]) {
        // 우선순위: 명시적 island 파일
        clientModule = join(this.config.routesDir, islands[0].relativePath).replace(/\\/g, "/");

        // SSR shell + island placeholder 패턴은 hydration mismatch 위험이 매우 높으므로 에러로 처리
        if (pageFileContent && this.hasHydrationShellMismatchRisk(pageFileContent, islands[0].relativePath)) {
          routeErrors.push({
            type: "hydration_shell_mismatch_risk",
            message:
              `Hydration mismatch risk detected in \"${file.relativePath}\": ` +
              `page.tsx renders an SSR shell while hydration is delegated to \"${islands[0].relativePath}\". ` +
              `Use a single render tree for first paint (e.g. route entry directly exports island component).`,
            filePath: file.absolutePath,
            conflictsWith: islands[0].absolutePath,
          });
        }
      } else if (file.type === "page" && pageFileContent) {
        // page 파일 자체에서 "use client" 확인
        const hasUseClient = /^\s*["']use client["']/m.test(pageFileContent);
        if (hasUseClient) {
          clientModule = modulePath;
        }
      }

      // 로딩/에러/404 모듈 찾기 — nearest-ancestor resolution.
      // Phase 18.β: `not-found.tsx` joins `loading.tsx`/`error.tsx` in
      // walking up the segment tree so a deeply nested route inherits
      // its parent's 404 UI unless it declares its own.
      const loadingModule = this.findClosestSpecialFile(file.segments, loadingMap);
      const errorModule = this.findClosestSpecialFile(file.segments, errorMap);
      const notFoundModule = this.findClosestSpecialFile(file.segments, notFoundMap);

      const route: FSRouteConfig = {
        id: routeId,
        segments: file.segments,
        pattern,
        kind: file.type === "page" ? "page" : "api",
        module: modulePath,
        componentModule: file.type === "page" ? modulePath : undefined,
        clientModule,
        layoutChain,
        loadingModule,
        errorModule,
        notFoundModule,
        sourceFile: file.absolutePath,
      };

      // API 라우트의 경우 methods 추가 (기본값)
      if (file.type === "route") {
        route.methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
      }

      routes.push(route);
      patternMap.set(pattern, route);
      shapeMap.set(patternShape, route);
    }

    return { routes, routeErrors };
  }

  private hasHydrationShellMismatchRisk(pageContent: string, _islandRelativePath: string): boolean {
    // import문에서 island 모듈의 변수명을 직접 파싱
    const importMatch = pageContent.match(
      /import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["'][^"']*\.island(?:\.(?:tsx?|jsx?))?["']/
    );

    if (!importMatch) {
      return false;
    }

    const islandVarName = importMatch[1];

    // 대표적인 anti-pattern:
    // import X from "./page.island" + {typeof X !== 'undefined' && null}
    return new RegExp(
      `typeof\\s+${islandVarName}\\s*!==\\s*["']undefined["']\\s*&&\\s*null`
    ).test(pageContent);
  }

  /**
   * 레이아웃 체인 해결
   */
  private resolveLayoutChain(
    segments: ScannedFile["segments"],
    layoutMap: Map<string, ScannedFile>
  ): string[] {
    const chain: string[] = [];

    // 루트 레이아웃
    const rootLayout = layoutMap.get(".");
    if (rootLayout) {
      chain.push(join(this.config.routesDir, rootLayout.relativePath).replace(/\\/g, "/"));
    }

    // 중첩 레이아웃
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment.raw}` : segment.raw;
      const layout = layoutMap.get(currentPath);
      if (layout) {
        chain.push(join(this.config.routesDir, layout.relativePath).replace(/\\/g, "/"));
      }
    }

    return chain;
  }

  /**
   * 가장 가까운 특수 파일 찾기
   */
  private findClosestSpecialFile(
    segments: ScannedFile["segments"],
    fileMap: Map<string, ScannedFile>
  ): string | undefined {
    // 현재 경로부터 루트까지 역순 탐색
    let currentPath = segments.map((s) => s.raw).join("/");

    while (currentPath) {
      const file = fileMap.get(currentPath);
      if (file) {
        return join(this.config.routesDir, file.relativePath).replace(/\\/g, "/");
      }
      // 상위 디렉토리로
      const lastSlash = currentPath.lastIndexOf("/");
      currentPath = lastSlash > 0 ? currentPath.slice(0, lastSlash) : "";
    }

    // 루트 체크
    const rootFile = fileMap.get(".");
    return rootFile ? join(this.config.routesDir, rootFile.relativePath).replace(/\\/g, "/") : undefined;
  }

  /**
   * 상대 경로에서 디렉토리 경로 추출 (루트는 ".")
   */
  private getDirPath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === -1 ? "." : normalized.slice(0, lastSlash);
  }

  /**
   * 경로에 비공개 폴더가 포함되어 있는지 확인
   */
  private hasPrivateSegment(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, "/");
    const segments = normalized.split("/").slice(0, -1);
    return segments.some((segment) => isPrivateFolder(segment));
  }

  /**
   * 제외 패턴 적용 여부
   */
  private isExcluded(relativePath: string, isDir: boolean): boolean {
    if (this.excludeMatchers.length === 0) return false;

    const normalized = relativePath.replace(/\\/g, "/");
    const candidates = isDir
      ? [normalized, normalized.endsWith("/") ? normalized : `${normalized}/`]
      : [normalized];

    return this.excludeMatchers.some((matcher) => candidates.some((path) => matcher.test(path)));
  }

  /**
   * 빈 결과 생성
   */
  private createEmptyResult(errors: ScanError[], scanTime: number): ScanResult {
    return {
      files: [],
      routes: [],
      errors,
      stats: {
        totalFiles: 0,
        pageCount: 0,
        apiCount: 0,
        layoutCount: 0,
        islandCount: 0,
        metadataCount: 0,
        scanTime,
      },
    };
  }

  /**
   * 통계 계산
   */
  private calculateStats(
    files: ScannedFile[],
    routes: FSRouteConfig[],
    scanTime: number
  ): ScanStats {
    return {
      totalFiles: files.length,
      pageCount: routes.filter((r) => r.kind === "page").length,
      apiCount: routes.filter((r) => r.kind === "api").length,
      layoutCount: files.filter((f) => f.type === "layout").length,
      islandCount: files.filter((f) => f.type === "island").length,
      metadataCount: routes.filter((r) => r.kind === "metadata").length,
      scanTime,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Glob Utilities
// ═══════════════════════════════════════════════════════════════════════════

function globToRegExp(glob: string): RegExp {
  let regex = "^";
  let i = 0;

  while (i < glob.length) {
    const char = glob[i];

    if (char === "*") {
      const nextChar = glob[i + 1];
      const nextNextChar = glob[i + 2];
      if (nextChar === "*" && nextNextChar === "/") {
        // "**/" -> match any path prefix (including empty)
        regex += "(?:.*/)?";
        i += 2;
      } else if (nextChar === "*") {
        // "**" -> match any path (including "/")
        while (glob[i + 1] === "*") i++;
        regex += ".*";
      } else {
        // "*" -> match within a segment
        regex += "[^/]*";
      }
    } else if (char === "?") {
      regex += "[^/]";
    } else {
      regex += escapeRegex(char);
    }

    i++;
  }

  regex += "$";
  return new RegExp(regex);
}

function escapeRegex(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 18.μ — i18n path-prefix route synthesis
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for {@link synthesizeLocaleRoutes}. Mirrors the relevant subset
 * of `I18nDefinition` so callers don't need to pull the whole
 * `@mandujs/core/i18n` surface into pure-router code paths.
 */
export interface LocaleSynthesisOptions {
  /** Allow-list of locale codes to materialize. */
  locales: readonly string[];
  /** Default locale — its routes stay unprefixed (Next.js parity). */
  defaultLocale: string;
}

/**
 * Phase 18.μ — synthesize per-locale route variants at manifest-build
 * time. Given a set of scanned routes, produces `locales.length` copies
 * for every `page` / `api` route with a locale prefix baked into
 * `id` + `pattern`. The default locale's routes are emitted unprefixed
 * (so legacy links keep working and SEO stays intact).
 *
 * The synthesis is pure: it re-uses existing `FSRouteConfig` objects as
 * source of truth, producing *new* objects with:
 *
 *   - `pattern`    : `/en/blog/:slug`
 *   - `id`         : `en::<original-id>`
 *   - `module`     : unchanged (same loader on disk)
 *   - everything else: shallow-copied
 *
 * Metadata routes (sitemap/robots/llms-txt/manifest) are NOT duplicated —
 * they always sit at site root regardless of locale (same SEO rule as
 * Next.js).
 *
 * The caller is responsible for passing the output through
 * {@link sortRoutesByPriority} before writing the manifest.
 *
 * @example
 * ```ts
 * const scan = await scanRoutes(rootDir);
 * const prefixed = synthesizeLocaleRoutes(scan.routes, {
 *   locales: ["en", "ko"],
 *   defaultLocale: "en",
 * });
 * // scan.routes   : [/, /blog, /blog/:slug]
 * // prefixed      : [/, /blog, /blog/:slug, /ko, /ko/blog, /ko/blog/:slug]
 * ```
 */
export function synthesizeLocaleRoutes(
  routes: FSRouteConfig[],
  options: LocaleSynthesisOptions
): FSRouteConfig[] {
  const { locales, defaultLocale } = options;
  if (!Array.isArray(locales) || locales.length === 0) return [...routes];
  if (!locales.includes(defaultLocale)) {
    throw new Error(
      `[router] synthesizeLocaleRoutes: defaultLocale "${defaultLocale}" not in locales [${locales.join(", ")}]`
    );
  }

  const out: FSRouteConfig[] = [];
  for (const route of routes) {
    // Metadata routes live at site root; never prefix them.
    if (route.kind === "metadata") {
      out.push(route);
      continue;
    }

    // Default locale: unprefixed copy preserved verbatim (legacy +
    // SEO neutral).
    out.push(route);

    for (const locale of locales) {
      if (locale === defaultLocale) continue;
      const prefixed = prefixRouteWithLocale(route, locale);
      out.push(prefixed);
    }
  }
  return out;
}

function prefixRouteWithLocale(route: FSRouteConfig, locale: string): FSRouteConfig {
  const prefixedPattern = route.pattern === "/"
    ? `/${locale}`
    : `/${locale}${route.pattern.startsWith("/") ? route.pattern : `/${route.pattern}`}`;

  return {
    ...route,
    id: `${locale}::${route.id}`,
    pattern: prefixedPattern,
    // `segments` is used for priority calculation + layout resolution;
    // prepending a static locale segment keeps priority sensible and
    // avoids collisions with real `[param]` segments.
    segments: [
      { raw: locale, type: "static" },
      ...route.segments,
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory Function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 스캐너 생성 팩토리 함수
 */
export function createFSScanner(config: Partial<FSScannerConfig> = {}): FSScanner {
  return new FSScanner(config);
}

/**
 * 간편 스캔 함수
 */
export async function scanRoutes(
  rootDir: string,
  config: Partial<FSScannerConfig> = {}
): Promise<ScanResult> {
  const scanner = createFSScanner(config);
  return scanner.scan(rootDir);
}
