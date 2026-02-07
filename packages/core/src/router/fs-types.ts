/**
 * FS Routes Types
 *
 * 파일 시스템 기반 라우팅 타입 정의
 *
 * @module router/fs-types
 */

import type { RouteKind, HydrationConfig, HttpMethod } from "../spec/schema";

// ═══════════════════════════════════════════════════════════════════════════
// Segment Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 라우트 세그먼트 타입
 */
export type SegmentType =
  | "static" // 정적 세그먼트 (예: "blog")
  | "dynamic" // 동적 세그먼트 (예: "[slug]")
  | "catchAll" // Catch-all 세그먼트 (예: "[...path]")
  | "optionalCatchAll" // Optional catch-all (예: "[[...path]]")
  | "group"; // 라우트 그룹 (예: "(marketing)")

/**
 * 파싱된 라우트 세그먼트
 */
export interface RouteSegment {
  /** 원본 세그먼트 이름 */
  raw: string;

  /** 세그먼트 타입 */
  type: SegmentType;

  /** 파라미터 이름 (동적 세그먼트의 경우) */
  paramName?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// File Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 스캔된 파일 타입
 */
export type ScannedFileType =
  | "page" // page.tsx - 페이지 컴포넌트
  | "layout" // layout.tsx - 레이아웃
  | "route" // route.ts - API 핸들러
  | "loading" // loading.tsx - 로딩 UI
  | "error" // error.tsx - 에러 UI
  | "not-found" // not-found.tsx - 404 UI
  | "island"; // *.island.tsx - Island 컴포넌트

/**
 * 스캔된 파일 정보
 */
export interface ScannedFile {
  /** 절대 경로 */
  absolutePath: string;

  /** 라우트 루트 기준 상대 경로 */
  relativePath: string;

  /** 파일 타입 */
  type: ScannedFileType;

  /** 파싱된 경로 세그먼트 */
  segments: RouteSegment[];

  /** 파일 확장자 */
  extension: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Route Config Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FS Routes에서 생성된 라우트 설정
 */
export interface FSRouteConfig {
  /** 라우트 ID (자동 생성) */
  id: string;

  /** 파싱된 경로 세그먼트 */
  segments: RouteSegment[];

  /** URL 패턴 (예: "/blog/:slug") */
  pattern: string;

  /** 라우트 종류 */
  kind: RouteKind;

  /** HTTP 메서드 (API 라우트용) */
  methods?: HttpMethod[];

  /** 페이지 컴포넌트 모듈 경로 */
  componentModule?: string;

  /** API 핸들러 모듈 경로 */
  module: string;

  /** Island 컴포넌트 모듈 경로 */
  clientModule?: string;

  /** 적용할 레이아웃 체인 */
  layoutChain: string[];

  /** 로딩 UI 모듈 경로 */
  loadingModule?: string;

  /** 에러 UI 모듈 경로 */
  errorModule?: string;

  /** Hydration 설정 */
  hydration?: HydrationConfig;

  /** 원본 파일 경로 */
  sourceFile: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scanner Config Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FS Routes 스캐너 설정
 */
export interface FSScannerConfig {
  /** 라우트 루트 디렉토리 (기본: "app") */
  routesDir: string;

  /** 지원 확장자 (기본: [".tsx", ".ts", ".jsx", ".js"]) */
  extensions: string[];

  /** 제외 패턴 (glob) */
  exclude: string[];

  /** Island 파일 접미사 (기본: ".island") */
  islandSuffix: string;

  /** 레거시 매니페스트 경로 (병합용) */
  legacyManifestPath?: string;

  /** 레거시 매니페스트와 병합 여부 */
  mergeWithLegacy: boolean;
}

/**
 * 기본 스캐너 설정
 */
export const DEFAULT_SCANNER_CONFIG: FSScannerConfig = {
  routesDir: "app",
  extensions: [".tsx", ".ts", ".jsx", ".js"],
  exclude: [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/_*/**", // 비공개 폴더
    "**/node_modules/**",
  ],
  islandSuffix: ".island",
  legacyManifestPath: "spec/routes.manifest.json",
  mergeWithLegacy: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// Scan Result Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 디렉토리 스캔 결과
 */
export interface ScanResult {
  /** 스캔된 파일 목록 */
  files: ScannedFile[];

  /** 생성된 라우트 설정 */
  routes: FSRouteConfig[];

  /** 에러 목록 */
  errors: ScanError[];

  /** 스캔 통계 */
  stats: ScanStats;
}

/**
 * 스캔 에러
 */
export interface ScanError {
  /** 에러 타입 */
  type: "invalid_segment" | "duplicate_route" | "file_read_error" | "pattern_conflict";

  /** 에러 메시지 */
  message: string;

  /** 관련 파일 경로 */
  filePath?: string;

  /** 충돌하는 파일 경로 (duplicate_route의 경우) */
  conflictsWith?: string;
}

/**
 * 스캔 통계
 */
export interface ScanStats {
  /** 총 스캔 파일 수 */
  totalFiles: number;

  /** 페이지 수 */
  pageCount: number;

  /** API 라우트 수 */
  apiCount: number;

  /** 레이아웃 수 */
  layoutCount: number;

  /** Island 수 */
  islandCount: number;

  /** 스캔 소요 시간 (ms) */
  scanTime: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pattern Constants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 파일명 패턴
 */
export const FILE_PATTERNS = {
  /** 페이지 파일 */
  page: /^page\.(tsx?|jsx?)$/,

  /** 레이아웃 파일 */
  layout: /^layout\.(tsx?|jsx?)$/,

  /** API 라우트 파일 */
  route: /^route\.(ts|js)$/,

  /** 로딩 UI 파일 */
  loading: /^loading\.(tsx?|jsx?)$/,

  /** 에러 UI 파일 */
  error: /^error\.(tsx?|jsx?)$/,

  /** 404 파일 */
  notFound: /^not-found\.(tsx?|jsx?)$/,

  /** Island 파일 */
  island: /\.island\.(tsx?|jsx?)$/,
} as const;

/**
 * 세그먼트 패턴
 */
export const SEGMENT_PATTERNS = {
  /** 동적 세그먼트: [param] */
  dynamic: /^\[([^\[\]\.]+)\]$/,

  /** Catch-all: [...param] */
  catchAll: /^\[\.\.\.([^\[\]]+)\]$/,

  /** Optional catch-all: [[...param]] */
  optionalCatchAll: /^\[\[\.\.\.([^\[\]]+)\]\]$/,

  /** 라우트 그룹: (name) */
  group: /^\(([^()]+)\)$/,

  /** 비공개 폴더: _name */
  private: /^_/,
} as const;
