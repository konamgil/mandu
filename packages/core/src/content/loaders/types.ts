/**
 * Loader Types - 로더 공통 인터페이스
 *
 * 모든 로더가 구현해야 하는 인터페이스와 유틸리티 타입
 */

import type { ZodSchema } from "zod";
import type { LoaderContext, DataEntry, RenderedContent } from "../types";

/**
 * 로더 인터페이스
 */
export interface Loader {
  /** 로더 이름 (디버깅용) */
  name: string;
  /** 콘텐츠 로드 함수 */
  load: (context: LoaderContext) => Promise<void>;
  /** 기본 스키마 (컬렉션 설정보다 우선순위 낮음) */
  schema?: ZodSchema | (() => ZodSchema | Promise<ZodSchema>);
}

/**
 * File Loader 옵션
 */
export interface FileLoaderOptions {
  /** 파일 경로 (프로젝트 루트 기준) */
  path: string;
  /** 파서 타입 (자동 감지됨) */
  parser?: "json" | "yaml" | "toml";
}

/**
 * Glob Loader 옵션
 */
export interface GlobLoaderOptions {
  /** Glob 패턴 */
  pattern: string | string[];
  /** 기본 디렉토리 */
  base?: string;
  /** ID 생성 함수 */
  generateId?: (params: { filePath: string; base: string }) => string;
}

/**
 * API Loader 옵션
 */
export interface ApiLoaderOptions {
  /** API URL */
  url: string | (() => string | Promise<string>);
  /** HTTP 메서드 */
  method?: "GET" | "POST";
  /** 요청 헤더 */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** 요청 바디 (POST) */
  body?: unknown | (() => unknown | Promise<unknown>);
  /** 응답 변환 */
  transform?: (response: unknown) => unknown[] | Promise<unknown[]>;
  /** 캐시 TTL (초) */
  cacheTTL?: number;
  /** 페이지네이션 설정 */
  pagination?: PaginationConfig;
}

/**
 * 페이지네이션 설정
 */
export interface PaginationConfig {
  /** 다음 페이지 URL 추출 */
  getNextUrl?: (response: unknown, currentUrl: string) => string | null;
  /** 총 페이지 수 추출 */
  getTotalPages?: (response: unknown) => number;
  /** 페이지 크기 */
  pageSize?: number;
}

/**
 * Markdown 프론트매터 파싱 결과
 */
export interface ParsedMarkdown {
  /** 프론트매터 데이터 */
  data: Record<string, unknown>;
  /** Markdown 본문 */
  body: string;
  /** 원본 프론트매터 문자열 */
  rawFrontmatter?: string;
}

/**
 * 로더 결과 엔트리 (store.set 전)
 */
export interface LoaderEntry<T = Record<string, unknown>> {
  /** 고유 ID */
  id: string;
  /** 데이터 */
  data: T;
  /** 파일 경로 (파일 기반) */
  filePath?: string;
  /** 본문 (Markdown 등) */
  body?: string;
  /** 다이제스트 */
  digest?: string;
  /** 렌더링된 콘텐츠 */
  rendered?: RenderedContent;
}

/**
 * 로더 팩토리 함수 타입
 */
export type LoaderFactory<TOptions> = (options: TOptions) => Loader;

/**
 * 지원 파일 확장자별 파서
 */
export const FILE_PARSERS = {
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
} as const;

/**
 * Markdown 파일 확장자
 */
export const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx", ".markdown"]);

/**
 * 파일 확장자로 파서 타입 추론
 */
export function inferParser(filePath: string): "json" | "yaml" | "toml" | "markdown" | null {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return "markdown";
  }

  return FILE_PARSERS[ext as keyof typeof FILE_PARSERS] ?? null;
}
