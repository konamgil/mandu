/**
 * DNA-001: Plugin Adapter Pattern - Core Types
 *
 * 플러그인 시스템의 핵심 인터페이스 정의
 * - 타입 안전한 플러그인 등록
 * - 설정 스키마 검증
 * - 라이프사이클 훅
 */

import type { z, ZodSchema } from "zod";

/**
 * 플러그인 카테고리
 */
export type PluginCategory =
  | "guard-preset"    // Guard 아키텍처 프리셋
  | "build"           // 빌드 플러그인 (analyzer, minifier)
  | "logger"          // 로깅 전송
  | "mcp-tool"        // MCP 도구 확장
  | "middleware"      // 글로벌 미들웨어
  | "custom";         // 사용자 정의

/**
 * 플러그인 메타데이터
 */
export interface PluginMeta {
  /** 고유 ID (예: "guard-preset-fsd", "build-analyzer") */
  id: string;

  /** 표시 이름 */
  name: string;

  /** 설명 */
  description?: string;

  /** 버전 (semver) */
  version: string;

  /** 카테고리 */
  category: PluginCategory;

  /** 작성자 */
  author?: string;

  /** 저장소 URL */
  repository?: string;

  /** 태그 (검색용) */
  tags?: string[];
}

/**
 * 플러그인 API - 플러그인이 프레임워크와 상호작용하는 인터페이스
 */
export interface PluginApi {
  /**
   * Guard 프리셋 등록
   */
  registerGuardPreset: (preset: GuardPresetPlugin) => void;

  /**
   * 빌드 플러그인 등록
   */
  registerBuildPlugin: (plugin: BuildPlugin) => void;

  /**
   * 로거 전송 등록
   */
  registerLoggerTransport: (transport: LoggerTransportPlugin) => void;

  /**
   * MCP 도구 등록
   */
  registerMcpTool: (tool: McpToolPlugin) => void;

  /**
   * 미들웨어 등록
   */
  registerMiddleware: (middleware: MiddlewarePlugin) => void;

  /**
   * 설정 가져오기
   */
  getConfig: <T>(key: string) => T | undefined;

  /**
   * 로거
   */
  logger: {
    debug: (msg: string, data?: unknown) => void;
    info: (msg: string, data?: unknown) => void;
    warn: (msg: string, data?: unknown) => void;
    error: (msg: string, data?: unknown) => void;
  };
}

/**
 * 플러그인 라이프사이클 훅
 */
export interface PluginHooks {
  /**
   * 플러그인 로드 시 (설정 검증 후)
   */
  onLoad?: () => void | Promise<void>;

  /**
   * 플러그인 언로드 시
   */
  onUnload?: () => void | Promise<void>;

  /**
   * 서버 시작 시
   */
  onServerStart?: () => void | Promise<void>;

  /**
   * 서버 종료 시
   */
  onServerStop?: () => void | Promise<void>;
}

/**
 * 기본 플러그인 인터페이스
 */
export interface Plugin<TConfig = unknown> extends PluginHooks {
  /** 플러그인 메타데이터 */
  meta: PluginMeta;

  /** 설정 스키마 (Zod) */
  configSchema?: ZodSchema<TConfig>;

  /**
   * 플러그인 등록 함수
   * @param api - 플러그인 API
   * @param config - 검증된 설정
   */
  register: (api: PluginApi, config: TConfig) => void | Promise<void>;
}

// ============================================================================
// 카테고리별 플러그인 타입
// ============================================================================

/**
 * Guard 프리셋 플러그인
 */
export interface GuardPresetPlugin {
  /** 프리셋 ID (예: "fsd", "clean", "hexagonal") */
  id: string;

  /** 표시 이름 */
  name: string;

  /** 설명 */
  description?: string;

  /**
   * 프리셋 규칙 정의
   * @returns 규칙 배열
   */
  getRules: () => GuardRule[];

  /**
   * 레이어 정의 (있는 경우)
   */
  getLayers?: () => LayerDefinition[];
}

/**
 * Guard 규칙
 */
export interface GuardRule {
  id: string;
  name: string;
  description?: string;
  severity: "error" | "warn" | "off";
  check: (context: GuardRuleContext) => GuardViolation[];
}

/**
 * Guard 규칙 실행 컨텍스트
 */
export interface GuardRuleContext {
  filePath: string;
  sourceCode: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  projectRoot: string;
}

/**
 * Import 정보
 */
export interface ImportInfo {
  source: string;
  specifiers: string[];
  isTypeOnly: boolean;
  line: number;
}

/**
 * Export 정보
 */
export interface ExportInfo {
  name: string;
  isDefault: boolean;
  isTypeOnly: boolean;
  line: number;
}

/**
 * Guard 위반
 */
export interface GuardViolation {
  ruleId: string;
  message: string;
  severity: "error" | "warn";
  filePath: string;
  line?: number;
  column?: number;
  fix?: {
    description: string;
    replacement?: string;
  };
}

/**
 * 레이어 정의
 */
export interface LayerDefinition {
  name: string;
  pattern: string | RegExp;
  allowedDependencies: string[];
}

/**
 * 빌드 플러그인
 */
export interface BuildPlugin {
  /** 플러그인 ID */
  id: string;

  /** 표시 이름 */
  name: string;

  /**
   * 빌드 전 훅
   */
  onBuildStart?: (context: BuildContext) => void | Promise<void>;

  /**
   * 번들 처리
   */
  transform?: (code: string, id: string) => string | null | Promise<string | null>;

  /**
   * 빌드 후 훅
   */
  onBuildEnd?: (context: BuildContext, result: BuildResult) => void | Promise<void>;
}

/**
 * 빌드 컨텍스트
 */
export interface BuildContext {
  outDir: string;
  minify: boolean;
  sourcemap: boolean;
  mode: "development" | "production";
}

/**
 * 빌드 결과
 */
export interface BuildResult {
  success: boolean;
  outputFiles: string[];
  errors?: string[];
  stats?: {
    duration: number;
    totalSize: number;
  };
}

/**
 * 로거 전송 플러그인
 */
export interface LoggerTransportPlugin {
  /** 전송 ID */
  id: string;

  /** 표시 이름 */
  name: string;

  /**
   * 로그 전송
   */
  send: (entry: LogEntry) => void | Promise<void>;

  /**
   * 배치 전송 (옵션)
   */
  sendBatch?: (entries: LogEntry[]) => void | Promise<void>;

  /**
   * 종료 시 플러시
   */
  flush?: () => void | Promise<void>;
}

/**
 * 로그 항목
 */
export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: Date;
  data?: unknown;
  context?: Record<string, unknown>;
}

/**
 * MCP 도구 플러그인
 */
export interface McpToolPlugin {
  /** 도구 이름 */
  name: string;

  /** 설명 */
  description: string;

  /**
   * 입력 스키마 (JSON Schema)
   */
  inputSchema: Record<string, unknown>;

  /**
   * 도구 실행
   */
  execute: (input: unknown) => unknown | Promise<unknown>;
}

/**
 * 미들웨어 플러그인
 */
export interface MiddlewarePlugin {
  /** 미들웨어 ID */
  id: string;

  /** 표시 이름 */
  name: string;

  /** 실행 순서 (낮을수록 먼저) */
  order?: number;

  /**
   * 미들웨어 함수
   */
  handler: (
    request: Request,
    next: () => Promise<Response>
  ) => Response | Promise<Response>;
}
