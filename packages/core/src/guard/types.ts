/**
 * Mandu Guard Types
 *
 * 실시간 아키텍처 감시 시스템 타입 정의
 *
 * @module guard/types
 */

// ═══════════════════════════════════════════════════════════════════════════
// Configuration Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 프리셋 이름
 */
export type GuardPreset =
  | "fsd"        // Feature-Sliced Design
  | "clean"      // Clean Architecture
  | "hexagonal"  // Hexagonal Architecture
  | "atomic"     // Atomic Design
  | "mandu";     // Mandu 권장 (FSD + Clean 조합)

/**
 * 심각도 레벨
 */
export type Severity = "error" | "warn" | "info";

/**
 * 심각도 설정
 */
export interface SeverityConfig {
  /** 레이어 위반 */
  layerViolation?: Severity;
  /** 순환 의존 */
  circularDependency?: Severity;
  /** 깊은 중첩 */
  deepNesting?: Severity;
  /** 같은 레이어 내 슬라이스 간 의존 */
  crossSliceDependency?: Severity;
}

/**
 * FS Routes Guard 설정
 */
export interface FSRoutesGuardConfig {
  /** page.tsx에서 다른 page import 금지 */
  noPageToPage?: boolean;
  /** page.tsx가 import 가능한 레이어 */
  pageCanImport?: string[];
  /** layout.tsx가 import 가능한 레이어 */
  layoutCanImport?: string[];
}

/**
 * Guard 설정
 */
export interface GuardConfig {
  /** 프리셋 이름 */
  preset?: GuardPreset;

  /** 실시간 감시 여부 (기본값: true) */
  realtime?: boolean;

  /** 감시 대상 디렉토리 (기본값: "src") */
  srcDir?: string;

  /** 제외 패턴 (glob) */
  exclude?: string[];

  /** 무시할 import 패턴 */
  ignoreImports?: string[];

  /** 커스텀 레이어 정의 */
  layers?: LayerDefinition[];

  /** 프리셋 오버라이드 */
  override?: {
    layers?: Record<string, Partial<LayerDefinition>>;
  };

  /** 심각도 설정 */
  severity?: SeverityConfig;

  /** FS Routes 통합 */
  fsRoutes?: FSRoutesGuardConfig;

  /** 실시간 출력 형식 */
  realtimeOutput?: "console" | "agent" | "json";

  /** 캐시 사용 여부 (기본값: true) */
  cache?: boolean;

  /** 증분 분석 (기본값: true) */
  incremental?: boolean;

  /** 디바운스 시간 (ms, 기본값: 100) */
  debounceMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 레이어 정의
 */
export interface LayerDefinition {
  /** 레이어 이름 */
  name: string;

  /** 파일 패턴 (glob) */
  pattern: string;

  /** import 가능한 레이어 목록 */
  canImport: string[];

  /** 레이어 설명 */
  description?: string;
}

/**
 * 해석된 레이어 규칙
 */
export interface LayerRule {
  /** 소스 레이어 */
  from: string;
  /** 타겟 레이어 */
  to: string;
  /** 허용 여부 */
  allowed: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Analysis Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Import 정보
 */
export interface ImportInfo {
  /** import 문 전체 */
  statement: string;
  /** import 경로 */
  path: string;
  /** 라인 번호 */
  line: number;
  /** 컬럼 번호 */
  column: number;
  /** import 유형 */
  type: "static" | "dynamic" | "require";
  /** named imports */
  namedImports?: string[];
  /** default import */
  defaultImport?: string;
}

/**
 * 파일 분석 결과
 */
export interface FileAnalysis {
  /** 파일 경로 */
  filePath: string;
  /** 분석 기준 루트 디렉토리 */
  rootDir?: string;
  /** 파일이 속한 레이어 */
  layer: string | null;
  /** 슬라이스 이름 (FSD의 경우) */
  slice?: string;
  /** import 목록 */
  imports: ImportInfo[];
  /** 분석 시간 */
  analyzedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Violation Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 위반 유형
 */
export type ViolationType =
  | "layer-violation"      // 레이어 의존 위반
  | "circular-dependency"  // 순환 의존
  | "cross-slice"          // 같은 레이어 내 슬라이스 간 의존
  | "deep-nesting";        // 깊은 중첩 import

/**
 * 아키텍처 위반
 */
export interface Violation {
  /** 위반 유형 */
  type: ViolationType;

  /** 위반 파일 경로 */
  filePath: string;

  /** 라인 번호 */
  line: number;

  /** 컬럼 번호 */
  column: number;

  /** 위반 import 문 */
  importStatement: string;

  /** import 경로 */
  importPath: string;

  /** 소스 레이어 */
  fromLayer: string;

  /** 타겟 레이어 */
  toLayer: string;

  /** 규칙 이름 */
  ruleName: string;

  /** 규칙 설명 */
  ruleDescription: string;

  /** 심각도 */
  severity: Severity;

  /** 허용된 레이어 목록 */
  allowedLayers: string[];

  /** 해결 제안 */
  suggestions: string[];
}

/**
 * 위반 리포트
 */
export interface ViolationReport {
  /** 총 위반 수 */
  totalViolations: number;

  /** 심각도별 카운트 */
  bySeverity: Record<Severity, number>;

  /** 타입별 카운트 */
  byType: Record<ViolationType, number>;

  /** 위반 목록 */
  violations: Violation[];

  /** 분석된 파일 수 */
  filesAnalyzed: number;

  /** 분석 시간 (ms) */
  analysisTime: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Watcher Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Guard Watcher 이벤트
 */
export type WatcherEvent = "add" | "change" | "unlink";

/**
 * Guard Watcher 콜백
 */
export type WatcherCallback = (event: WatcherEvent, filePath: string) => void;

/**
 * Guard Watcher 인터페이스
 */
export interface GuardWatcher {
  /** 감시 시작 */
  start(): void;
  /** 감시 중지 */
  close(): void;
  /** 전체 검사 */
  scanAll(): Promise<ViolationReport>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Preset Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 프리셋 정의
 */
export interface PresetDefinition {
  /** 프리셋 이름 */
  name: GuardPreset;
  /** 설명 */
  description: string;
  /** 레이어 정의 */
  layers: LayerDefinition[];
  /** 레이어 계층 구조 (상위 → 하위) */
  hierarchy: string[];
  /** 기본 심각도 설정 */
  defaultSeverity?: SeverityConfig;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 기본 Guard 설정
 */
export const DEFAULT_GUARD_CONFIG: Required<Omit<GuardConfig, "preset" | "layers" | "override" | "fsRoutes">> = {
  realtime: true,
  srcDir: "src",
  exclude: [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/*.stories.tsx",
    "**/node_modules/**",
  ],
  ignoreImports: [],
  severity: {
    layerViolation: "error",
    circularDependency: "warn",
    deepNesting: "info",
    crossSliceDependency: "warn",
  },
  realtimeOutput: "console",
  cache: true,
  incremental: true,
  debounceMs: 100,
};

/**
 * 감시 대상 파일 확장자
 */
export const WATCH_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
