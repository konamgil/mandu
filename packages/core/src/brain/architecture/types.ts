/**
 * Brain v0.2 - Architecture Guard Types
 *
 * 프로젝트 아키텍처 규칙 정의 및 검증을 위한 타입
 */

/**
 * 폴더 역할 정의
 */
export interface FolderRule {
  /** 폴더 경로 패턴 (glob) */
  pattern: string;
  /** 폴더 설명/역할 */
  description: string;
  /** 허용되는 파일 패턴 */
  allowedFiles?: string[];
  /** 금지되는 파일 패턴 */
  forbiddenFiles?: string[];
  /** 이 폴더에서 허용되는 export */
  allowedExports?: string[];
  /** 수정 금지 여부 */
  readonly?: boolean;
}

/**
 * Import 규칙 정의
 */
export interface ImportRule {
  /** 적용 대상 파일 패턴 (glob) */
  source: string;
  /** 허용되는 import 패턴 */
  allow?: string[];
  /** 금지되는 import 패턴 */
  forbid?: string[];
  /** 규칙 설명 */
  reason?: string;
}

/**
 * 레이어 의존성 규칙
 */
export interface LayerRule {
  /** 레이어 이름 */
  name: string;
  /** 레이어에 속하는 폴더 패턴 */
  folders: string[];
  /** 의존 가능한 레이어 */
  canDependOn: string[];
  /** 의존 불가 레이어 */
  cannotDependOn?: string[];
}

/**
 * 네이밍 규칙
 */
export interface NamingRule {
  /** 적용 대상 폴더 패턴 */
  folder: string;
  /** 파일명 패턴 (정규식) */
  filePattern: string;
  /** 규칙 설명 */
  description: string;
  /** 예시 */
  examples?: string[];
}

/**
 * 아키텍처 설정
 */
export interface ArchitectureConfig {
  /** 폴더 규칙 */
  folders?: Record<string, FolderRule | string>;
  /** Import 규칙 */
  imports?: ImportRule[];
  /** 레이어 규칙 */
  layers?: LayerRule[];
  /** 네이밍 규칙 */
  naming?: NamingRule[];
  /** 커스텀 규칙 */
  custom?: CustomRule[];
}

/**
 * 커스텀 규칙
 */
export interface CustomRule {
  /** 규칙 ID */
  id: string;
  /** 규칙 설명 */
  description: string;
  /** 파일 패턴 */
  pattern: string;
  /** 검증 조건 (코드에 포함되어야 하는 패턴) */
  mustContain?: string[];
  /** 금지 조건 (코드에 포함되면 안 되는 패턴) */
  mustNotContain?: string[];
}

/**
 * 아키텍처 위반
 */
export interface ArchitectureViolation {
  /** 규칙 ID */
  ruleId: string;
  /** 규칙 타입 */
  ruleType: "folder" | "import" | "layer" | "naming" | "custom";
  /** 위반 파일 경로 */
  file: string;
  /** 위반 메시지 */
  message: string;
  /** 수정 제안 */
  suggestion?: string;
  /** 심각도 */
  severity: "error" | "warning" | "info";
  /** 위반 라인 (해당시) */
  line?: number;
}

/**
 * 위치 검증 요청
 */
export interface CheckLocationRequest {
  /** 검사할 파일 경로 */
  path: string;
  /** 파일 내용 (선택) */
  content?: string;
  /** 파일 타입 */
  fileType?: "ts" | "tsx" | "js" | "jsx" | "json" | "other";
}

/**
 * 위치 검증 결과
 */
export interface CheckLocationResult {
  /** 허용 여부 */
  allowed: boolean;
  /** 위반 목록 */
  violations: ArchitectureViolation[];
  /** LLM 제안 (활성화시) */
  suggestion?: string;
  /** 권장 경로 */
  recommendedPath?: string;
}

/**
 * Import 검증 요청
 */
export interface CheckImportRequest {
  /** 소스 파일 경로 */
  sourceFile: string;
  /** 검사할 import 문 */
  imports: string[];
}

/**
 * Import 검증 결과
 */
export interface CheckImportResult {
  /** 모든 import 허용 여부 */
  allowed: boolean;
  /** 위반된 import 목록 */
  violations: Array<{
    import: string;
    reason: string;
    suggestion?: string;
  }>;
}

/**
 * 프로젝트 구조 정보
 */
export interface ProjectStructure {
  /** 루트 디렉토리 */
  rootDir: string;
  /** 폴더 트리 */
  folders: FolderInfo[];
  /** 아키텍처 설정 */
  config: ArchitectureConfig;
  /** 인덱싱 시간 */
  indexedAt: string;
}

/**
 * 폴더 정보
 */
export interface FolderInfo {
  /** 경로 */
  path: string;
  /** 역할 설명 */
  description?: string;
  /** 파일 수 */
  fileCount: number;
  /** 하위 폴더 */
  children?: FolderInfo[];
}
