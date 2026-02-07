/**
 * Content Layer Type Definitions
 *
 * Astro Content Layer에서 영감받은 빌드 타임 콘텐츠 로딩 시스템
 * 다양한 소스(파일, API, DB)에서 콘텐츠를 로드하고 Zod 스키마로 검증
 */

import type { z, ZodSchema } from "zod";

// ============================================================================
// Core Types
// ============================================================================

/**
 * 렌더링된 콘텐츠 (Markdown → HTML)
 */
export interface RenderedContent {
  /** 렌더링된 HTML */
  html: string;
  /** 추출된 헤딩 목록 */
  headings?: ContentHeading[];
  /** 렌더링 메타데이터 */
  metadata?: Record<string, unknown>;
}

/**
 * 콘텐츠 헤딩 정보
 */
export interface ContentHeading {
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  slug: string;
  text: string;
}

/**
 * 데이터 엔트리 - DataStore에 저장되는 단위
 */
export interface DataEntry<T = Record<string, unknown>> {
  /** 고유 식별자 */
  id: string;
  /** 검증된 데이터 */
  data: T;
  /** 원본 파일 경로 (파일 기반 로더) */
  filePath?: string;
  /** 본문 콘텐츠 (Markdown 등) */
  body?: string;
  /** 변경 감지용 다이제스트 */
  digest?: string;
  /** 렌더링된 콘텐츠 */
  rendered?: RenderedContent;
}

/**
 * 컬렉션 정의
 */
export interface CollectionConfig<T = unknown> {
  /** 콘텐츠 로더 */
  loader: Loader;
  /** Zod 스키마 (검증용) */
  schema?: ZodSchema<T>;
}

/**
 * Content 설정 파일 타입 (content.config.ts)
 */
export interface ContentConfig {
  collections: Record<string, CollectionConfig>;
}

// ============================================================================
// Loader Types
// ============================================================================

/**
 * 로더 인터페이스 - 콘텐츠 소스 정의
 */
export interface Loader {
  /** 로더 이름 */
  name: string;
  /** 콘텐츠 로드 함수 */
  load: (context: LoaderContext) => Promise<void>;
  /** 스키마 (로더 내부 기본값) */
  schema?: ZodSchema | (() => ZodSchema | Promise<ZodSchema>);
}

/**
 * 로더 컨텍스트 - load() 함수에 전달
 */
export interface LoaderContext {
  /** 컬렉션 이름 */
  collection: string;
  /** 데이터 저장소 */
  store: DataStore;
  /** 메타 저장소 (동기화 토큰 등) */
  meta: MetaStore;
  /** 로거 */
  logger: ContentLogger;
  /** Mandu 설정 */
  config: ManduContentConfig;
  /** 데이터 파싱 및 검증 */
  parseData: <T>(options: ParseDataOptions<T>) => Promise<T>;
  /** 다이제스트 생성 */
  generateDigest: (data: unknown) => string;
  /** Markdown 렌더링 (선택) */
  renderMarkdown?: (content: string) => Promise<RenderedContent>;
  /** 파일 감시자 (dev 모드) */
  watcher?: ContentWatcher;
}

/**
 * parseData 옵션
 */
export interface ParseDataOptions<T> {
  /** 엔트리 ID */
  id: string;
  /** 원본 데이터 */
  data: unknown;
  /** 파일 경로 (있으면) */
  filePath?: string;
}

// ============================================================================
// Store Interfaces
// ============================================================================

/**
 * 데이터 저장소 인터페이스
 */
export interface DataStore {
  /** 엔트리 조회 */
  get<T = Record<string, unknown>>(id: string): DataEntry<T> | undefined;
  /** 엔트리 저장 (변경 시 true 반환) */
  set<T = Record<string, unknown>>(entry: DataEntry<T>): boolean;
  /** 엔트리 삭제 */
  delete(id: string): void;
  /** 전체 삭제 */
  clear(): void;
  /** 모든 엔트리 조회 */
  entries<T = Record<string, unknown>>(): Array<[string, DataEntry<T>]>;
  /** 엔트리 존재 여부 */
  has(id: string): boolean;
  /** 엔트리 개수 */
  size(): number;
  /** ID 목록 */
  keys(): string[];
  /** 값 목록 */
  values<T = Record<string, unknown>>(): Array<DataEntry<T>>;
}

/**
 * 메타 저장소 인터페이스 (동기화 토큰, 커서 등)
 */
export interface MetaStore {
  /** 메타 값 조회 */
  get(key: string): string | undefined;
  /** 메타 값 저장 */
  set(key: string, value: string): void;
  /** 메타 값 존재 여부 */
  has(key: string): boolean;
  /** 메타 값 삭제 */
  delete(key: string): void;
  /** 전체 삭제 */
  clear(): void;
  /** 모든 엔트리 */
  entries(): Array<[string, string]>;
}

// ============================================================================
// Logger & Watcher
// ============================================================================

/**
 * 콘텐츠 로거
 */
export interface ContentLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/**
 * 콘텐츠 파일 감시자 (dev 모드)
 */
export interface ContentWatcher {
  /** 파일 감시 추가 */
  add(paths: string | string[]): void;
  /** 파일 감시 제거 */
  remove(paths: string | string[]): void;
  /** 변경 이벤트 핸들러 */
  on(event: "change" | "add" | "unlink", handler: (path: string) => void): void;
  /** 감시 중지 */
  close(): Promise<void>;
}

// ============================================================================
// Config Types
// ============================================================================

/**
 * Mandu Content 설정
 */
export interface ManduContentConfig {
  /** 프로젝트 루트 */
  root: string;
  /** 콘텐츠 디렉토리 */
  contentDir?: string;
  /** 출력 디렉토리 */
  outDir?: string;
  /** 개발 모드 */
  isDev?: boolean;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * 콘텐츠 에러 기본 클래스
 */
export class ContentError extends Error {
  constructor(
    message: string,
    public code: string,
    public collection?: string,
    public entryId?: string
  ) {
    super(message);
    this.name = "ContentError";
  }
}

/**
 * 로더 에러
 */
export class LoaderError extends ContentError {
  constructor(message: string, collection?: string) {
    super(message, "LOADER_ERROR", collection);
    this.name = "LoaderError";
  }
}

/**
 * 파싱 에러
 */
export class ParseError extends ContentError {
  constructor(message: string, collection?: string, entryId?: string) {
    super(message, "PARSE_ERROR", collection, entryId);
    this.name = "ParseError";
  }
}

/**
 * 검증 에러
 */
export class ValidationError extends ContentError {
  constructor(
    message: string,
    public zodError: z.ZodError,
    collection?: string,
    entryId?: string
  ) {
    super(message, "VALIDATION_ERROR", collection, entryId);
    this.name = "ValidationError";
  }
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * 컬렉션의 데이터 타입 추론
 */
export type InferEntryData<T extends CollectionConfig> = T["schema"] extends ZodSchema<infer U>
  ? U
  : Record<string, unknown>;

/**
 * 컬렉션 엔트리 타입 (schema 포함)
 */
export type CollectionEntry<T extends CollectionConfig> = DataEntry<InferEntryData<T>>;
