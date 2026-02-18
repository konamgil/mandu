/**
 * FS Routes Module
 *
 * 파일 시스템 기반 라우팅 시스템
 *
 * @module router
 *
 * @example
 * ```typescript
 * import { scanRoutes, generateManifest, watchFSRoutes } from "@mandujs/core/router";
 *
 * // 간편 스캔
 * const result = await scanRoutes("/path/to/project");
 * console.log(result.routes);
 *
 * // 매니페스트 생성
 * const { manifest } = await generateManifest("/path/to/project", {
 *   outputPath: ".mandu/manifest.json"
 * });
 *
 * // 감시 모드
 * const watcher = await watchFSRoutes("/path/to/project", {
 *   onChange: (result) => console.log("Routes updated!")
 * });
 * ```
 */

// Types
export type {
  // Segment types
  SegmentType,
  RouteSegment,

  // File types
  ScannedFileType,
  ScannedFile,

  // Route config
  FSRouteConfig,

  // Scanner config
  FSScannerConfig,

  // Results
  ScanResult,
  ScanError,
  ScanStats,
} from "./fs-types";

export { DEFAULT_SCANNER_CONFIG, FILE_PATTERNS, SEGMENT_PATTERNS } from "./fs-types";

// Pattern utilities
export {
  parseSegment,
  parseSegments,
  segmentsToPattern,
  pathToPattern,
  detectFileType,
  isPrivateFolder,
  isGroupFolder,
  generateRouteId,
  calculateRoutePriority,
  sortRoutesByPriority,
  validateSegments,
  patternsConflict,
} from "./fs-patterns";

// Scanner
export { FSScanner, createFSScanner, scanRoutes } from "./fs-scanner";

// Generator
export type { FSGenerateResult, GenerateOptions, RouteChangeCallback, FSRoutesWatcher } from "./fs-routes";

export {
  fsRouteToRouteSpec,
  scanResultToManifest,
  resolveAutoLinks,
  generateManifest,
  watchFSRoutes,
  formatRoutesForCLI,
} from "./fs-routes";
