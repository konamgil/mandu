/**
 * Semantic Slots - 의미론적 슬롯 검증 시스템
 *
 * 슬롯에 목적과 제약을 명시하여 AI가 그 범위 내에서만 구현하도록 유도
 *
 * @module guard/semantic-slots
 *
 * @example
 * ```typescript
 * import { validateSlotConstraints, type SlotConstraints } from "@mandujs/core/guard";
 *
 * const constraints: SlotConstraints = {
 *   maxLines: 50,
 *   maxCyclomaticComplexity: 10,
 *   requiredPatterns: ["input-validation", "error-handling"],
 *   forbiddenPatterns: ["direct-db-write"],
 *   allowedImports: ["server/domain/*", "shared/utils/*"],
 * };
 *
 * const result = await validateSlotConstraints(filePath, constraints);
 * ```
 */

import { readFile } from "fs/promises";
import { join, relative, normalize } from "path";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 슬롯 제약 조건
 */
export interface SlotConstraints {
  /** 최대 코드 라인 수 */
  maxLines?: number;

  /** 최대 순환 복잡도 (Cyclomatic Complexity) */
  maxCyclomaticComplexity?: number;

  /** 필수 패턴 (구현에 포함되어야 함) */
  requiredPatterns?: SlotPattern[];

  /** 금지 패턴 (구현에 포함되면 안 됨) */
  forbiddenPatterns?: SlotPattern[];

  /** 허용된 import 경로 (glob 패턴) */
  allowedImports?: string[];

  /** 금지된 import 경로 (glob 패턴) */
  forbiddenImports?: string[];

  /** 허용된 함수/메서드 호출 */
  allowedCalls?: string[];

  /** 금지된 함수/메서드 호출 */
  forbiddenCalls?: string[];

  /** 커스텀 검증 규칙 */
  customRules?: CustomRule[];
}

/**
 * 슬롯 패턴 (문자열 또는 정규식)
 */
export type SlotPattern =
  | "input-validation"
  | "error-handling"
  | "pagination"
  | "authentication"
  | "authorization"
  | "logging"
  | "caching"
  | "direct-db-write"
  | "external-api-call"
  | "sensitive-data-log"
  | "hardcoded-secret"
  | string;

/**
 * 커스텀 검증 규칙
 */
export interface CustomRule {
  /** 규칙 이름 */
  name: string;
  /** 검증 정규식 */
  pattern: string;
  /** 이 패턴이 있어야 하는지(required) 없어야 하는지(forbidden) */
  type: "required" | "forbidden";
  /** 위반 시 메시지 */
  message: string;
}

/**
 * 슬롯 메타데이터 (Filling API에서 선언)
 */
export interface SlotMetadata {
  /** 슬롯 목적 설명 */
  purpose?: string;

  /** 상세 설명 */
  description?: string;

  /** 제약 조건 */
  constraints?: SlotConstraints;

  /** 소유자/담당자 */
  owner?: string;

  /** 태그 */
  tags?: string[];
}

/**
 * 제약 조건 위반
 */
export interface ConstraintViolation {
  /** 위반 유형 */
  type:
    | "max-lines-exceeded"
    | "max-complexity-exceeded"
    | "missing-required-pattern"
    | "forbidden-pattern-found"
    | "forbidden-import"
    | "forbidden-call"
    | "custom-rule-violation";

  /** 위반 메시지 */
  message: string;

  /** 심각도 */
  severity: "error" | "warn";

  /** 위반 위치 (라인 번호) */
  line?: number;

  /** 관련 코드 조각 */
  code?: string;

  /** 수정 제안 */
  suggestion?: string;
}

/**
 * 슬롯 검증 결과
 */
export interface SemanticSlotValidationResult {
  /** 유효 여부 */
  valid: boolean;

  /** 파일 경로 */
  filePath: string;

  /** 슬롯 메타데이터 */
  metadata?: SlotMetadata;

  /** 위반 목록 */
  violations: ConstraintViolation[];

  /** 분석 통계 */
  stats: {
    lines: number;
    cyclomaticComplexity: number;
    importCount: number;
  };

  /** 제안 사항 */
  suggestions: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Pattern Definitions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 기본 패턴 정의
 */
const PATTERN_DEFINITIONS: Record<string, { regex: RegExp; description: string }> = {
  // 필수 패턴들
  "input-validation": {
    regex: /\.(parse|safeParse|validate|check)\s*\(|z\.(object|string|number|array)\(|yup\.|joi\./,
    description: "Input validation using Zod, Yup, Joi, or similar",
  },
  "error-handling": {
    regex: /try\s*\{[\s\S]*?catch|\.catch\s*\(|throw\s+new\s+\w*Error/,
    description: "Error handling with try-catch or .catch()",
  },
  "pagination": {
    regex: /page|limit|offset|cursor|skip|take/i,
    description: "Pagination parameters handling",
  },
  "authentication": {
    regex: /auth|token|session|jwt|bearer/i,
    description: "Authentication check",
  },
  "authorization": {
    regex: /role|permission|access|can|allow|deny/i,
    description: "Authorization/permission check",
  },
  "logging": {
    regex: /console\.(log|info|warn|error)|logger\.|log\(/,
    description: "Logging statements",
  },
  "caching": {
    regex: /cache|redis|memcached|ttl/i,
    description: "Caching logic",
  },

  // 금지 패턴들
  "direct-db-write": {
    regex: /\.(insert|update|delete|remove|save)\s*\(|INSERT\s+INTO|UPDATE\s+.*SET|DELETE\s+FROM/i,
    description: "Direct database write operation",
  },
  "external-api-call": {
    regex: /fetch\s*\(|axios\.|http\.(get|post|put|delete)|\.request\s*\(/,
    description: "External API call",
  },
  "sensitive-data-log": {
    regex: /console\.(log|info)\s*\([^)]*(?:password|secret|token|key|credential)/i,
    description: "Logging sensitive data",
  },
  "hardcoded-secret": {
    regex: /(?:password|secret|api_?key|token)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    description: "Hardcoded secret or credential",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Analysis Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 코드 라인 수 계산 (빈 줄, 주석 제외)
 */
export function countCodeLines(content: string): number {
  const lines = content.split("\n");
  let count = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 블록 주석 시작
    if (trimmed.includes("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
      continue;
    }

    // 블록 주석 끝
    if (inBlockComment) {
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    // 빈 줄 또는 한 줄 주석
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("*")) {
      continue;
    }

    count++;
  }

  return count;
}

/**
 * 순환 복잡도 계산 (간단한 근사치)
 * 분기문 개수 + 1
 */
export function calculateCyclomaticComplexity(content: string): number {
  // 분기문 패턴들
  const branchPatterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bwhile\s*\(/g,
    /\bfor\s*\(/g,
    /\bcase\s+[^:]+:/g,
    /\bcatch\s*\(/g,
    /\?\s*[^:]+\s*:/g, // 삼항 연산자
    /&&/g,
    /\|\|/g,
  ];

  let complexity = 1; // 기본 경로

  for (const pattern of branchPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

/**
 * import 문 추출
 */
export function extractImports(content: string): string[] {
  const imports: string[] = [];

  // ES6 import
  const esImports = content.matchAll(/import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g);
  for (const match of esImports) {
    imports.push(match[1]);
  }

  // CommonJS require
  const cjsImports = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const match of cjsImports) {
    imports.push(match[1]);
  }

  // Dynamic import
  const dynamicImports = content.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const match of dynamicImports) {
    imports.push(match[1]);
  }

  return imports;
}

/**
 * 함수 호출 추출
 */
export function extractFunctionCalls(content: string): string[] {
  const calls: string[] = [];

  // 메서드 호출: obj.method() 또는 method()
  const callMatches = content.matchAll(/(?:(\w+)\.)?(\w+)\s*\(/g);
  for (const match of callMatches) {
    if (match[1]) {
      calls.push(`${match[1]}.${match[2]}`);
    } else {
      calls.push(match[2]);
    }
  }

  return [...new Set(calls)]; // 중복 제거
}

/**
 * 패턴 존재 여부 확인
 */
export function checkPattern(content: string, pattern: SlotPattern): boolean {
  const definition = PATTERN_DEFINITIONS[pattern];
  if (definition) {
    return definition.regex.test(content);
  }

  // 문자열 또는 정규식으로 처리
  if (pattern.startsWith("/") && pattern.endsWith("/")) {
    const regexPattern = pattern.slice(1, -1);
    const result = safeRegexTest(regexPattern, content);
    // 에러 발생 시 문자열 검색으로 폴백
    if (!result.success) {
      return content.includes(pattern);
    }
    return result.matched;
  }

  return content.includes(pattern);
}

/**
 * glob 패턴 매칭 (간단한 구현)
 */
function matchGlob(path: string, pattern: string): boolean {
  // * → [^/]*, ** → .*
  const regexPattern = pattern
    .replace(/\*\*/g, "<<<DOUBLE_STAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<DOUBLE_STAR>>>/g, ".*");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(path);
}

// ═══════════════════════════════════════════════════════════════════════════
// ReDoS Protection
// ═══════════════════════════════════════════════════════════════════════════

/** ReDoS 공격 방지를 위한 최대 패턴 길이 */
const MAX_PATTERN_LENGTH = 200;

/** ReDoS 공격 방지를 위한 최대 콘텐츠 길이 (커스텀 규칙용) */
const MAX_CONTENT_LENGTH_FOR_CUSTOM_REGEX = 100_000;

/**
 * 위험한 정규식 패턴 감지
 * 중첩된 quantifier, 과도한 그룹 등 ReDoS 취약점 유발 패턴 탐지
 */
function isUnsafeRegexPattern(pattern: string): boolean {
  // 패턴 길이 제한
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return true;
  }

  // 위험한 패턴들 (중첩 quantifier, 백트래킹 유발)
  const dangerousPatterns = [
    /\([^)]*[+*][^)]*\)[+*]/, // (a+)+ 또는 (a*)*
    /\([^)]*\|[^)]*\)[+*]/, // (a|b)+ with alternatives
    /\.[+*]\.[+*]/, // .+.+ 또는 .*.*
    /\(\?\:[^)]+\)[+*]{2,}/, // (?:...){n}+ 과도한 반복
  ];

  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * 안전한 정규식 테스트 실행
 * @returns 매칭 결과 또는 에러 시 false
 */
function safeRegexTest(
  pattern: string,
  content: string,
  maxContentLength = MAX_CONTENT_LENGTH_FOR_CUSTOM_REGEX
): { success: boolean; matched: boolean; error?: string } {
  // 패턴 안전성 검사
  if (isUnsafeRegexPattern(pattern)) {
    return {
      success: false,
      matched: false,
      error: `Pattern may cause ReDoS: ${pattern.substring(0, 50)}...`,
    };
  }

  // 콘텐츠 길이 제한 (ReDoS 방지)
  const safeContent =
    content.length > maxContentLength ? content.substring(0, maxContentLength) : content;

  try {
    const regex = new RegExp(pattern);
    const matched = regex.test(safeContent);
    return { success: true, matched };
  } catch {
    return {
      success: false,
      matched: false,
      error: `Invalid regex pattern: ${pattern.substring(0, 50)}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 슬롯 제약 조건 검증
 */
export async function validateSlotConstraints(
  filePath: string,
  constraints: SlotConstraints,
  rootDir?: string
): Promise<SemanticSlotValidationResult> {
  const violations: ConstraintViolation[] = [];
  const suggestions: string[] = [];

  // 파일 읽기
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return {
      valid: false,
      filePath,
      violations: [
        {
          type: "custom-rule-violation",
          message: `Cannot read file: ${filePath}`,
          severity: "error",
        },
      ],
      stats: { lines: 0, cyclomaticComplexity: 0, importCount: 0 },
      suggestions: [],
    };
  }

  // 통계 계산
  const lines = countCodeLines(content);
  const cyclomaticComplexity = calculateCyclomaticComplexity(content);
  const imports = extractImports(content);
  const calls = extractFunctionCalls(content);

  // 1. 최대 라인 수 검증
  if (constraints.maxLines && lines > constraints.maxLines) {
    violations.push({
      type: "max-lines-exceeded",
      message: `Code has ${lines} lines, exceeds limit of ${constraints.maxLines}`,
      severity: "warn",
      suggestion: "Consider splitting into smaller functions or extracting logic to separate modules",
    });
  }

  // 2. 최대 복잡도 검증
  if (constraints.maxCyclomaticComplexity && cyclomaticComplexity > constraints.maxCyclomaticComplexity) {
    violations.push({
      type: "max-complexity-exceeded",
      message: `Cyclomatic complexity is ${cyclomaticComplexity}, exceeds limit of ${constraints.maxCyclomaticComplexity}`,
      severity: "warn",
      suggestion: "Reduce branching logic, extract helper functions, or use early returns",
    });
  }

  // 3. 필수 패턴 검증
  if (constraints.requiredPatterns) {
    for (const pattern of constraints.requiredPatterns) {
      if (!checkPattern(content, pattern)) {
        const def = PATTERN_DEFINITIONS[pattern];
        violations.push({
          type: "missing-required-pattern",
          message: `Missing required pattern: ${pattern}${def ? ` (${def.description})` : ""}`,
          severity: "error",
          suggestion: `Add ${pattern} to the implementation`,
        });
      }
    }
  }

  // 4. 금지 패턴 검증
  if (constraints.forbiddenPatterns) {
    for (const pattern of constraints.forbiddenPatterns) {
      if (checkPattern(content, pattern)) {
        const def = PATTERN_DEFINITIONS[pattern];
        violations.push({
          type: "forbidden-pattern-found",
          message: `Forbidden pattern found: ${pattern}${def ? ` (${def.description})` : ""}`,
          severity: "error",
          suggestion: `Remove ${pattern} from the implementation or move to appropriate layer`,
        });
      }
    }
  }

  // 5. import 검증
  if (constraints.allowedImports || constraints.forbiddenImports) {
    for (const importPath of imports) {
      // 금지된 import 확인
      if (constraints.forbiddenImports) {
        for (const forbidden of constraints.forbiddenImports) {
          if (matchGlob(importPath, forbidden)) {
            violations.push({
              type: "forbidden-import",
              message: `Forbidden import: ${importPath} (matches ${forbidden})`,
              severity: "error",
              suggestion: `Remove this import or use an allowed alternative`,
            });
          }
        }
      }

      // 허용된 import 확인 (allowedImports가 있으면 그 외는 모두 금지)
      if (constraints.allowedImports && constraints.allowedImports.length > 0) {
        // 외부 패키지 (node_modules)는 기본 허용
        const isExternalPackage = !importPath.startsWith(".") && !importPath.startsWith("@/") && !importPath.startsWith("~/");
        if (!isExternalPackage) {
          const isAllowed = constraints.allowedImports.some((allowed) => matchGlob(importPath, allowed));
          if (!isAllowed) {
            violations.push({
              type: "forbidden-import",
              message: `Import not in allowed list: ${importPath}`,
              severity: "warn",
              suggestion: `Only these imports are allowed: ${constraints.allowedImports.join(", ")}`,
            });
          }
        }
      }
    }
  }

  // 6. 함수 호출 검증
  if (constraints.forbiddenCalls) {
    for (const call of calls) {
      for (const forbidden of constraints.forbiddenCalls) {
        if (call === forbidden || call.endsWith(`.${forbidden}`)) {
          violations.push({
            type: "forbidden-call",
            message: `Forbidden function call: ${call}`,
            severity: "error",
            suggestion: `Remove or replace this function call`,
          });
        }
      }
    }
  }

  // 7. 커스텀 규칙 검증 (ReDoS 방어 적용)
  if (constraints.customRules) {
    for (const rule of constraints.customRules) {
      const result = safeRegexTest(rule.pattern, content);

      // 정규식 에러 시 경고만 추가하고 건너뜀
      if (!result.success) {
        violations.push({
          type: "custom-rule-violation",
          message: `Unable to apply rule: ${result.error}`,
          severity: "warn",
        });
        continue;
      }

      if (rule.type === "required" && !result.matched) {
        violations.push({
          type: "custom-rule-violation",
          message: rule.message,
          severity: "error",
        });
      }

      if (rule.type === "forbidden" && result.matched) {
        violations.push({
          type: "custom-rule-violation",
          message: rule.message,
          severity: "error",
        });
      }
    }
  }

  // 제안 생성
  if (violations.length === 0) {
    suggestions.push("✅ All constraints satisfied");
  } else {
    const errorCount = violations.filter((v) => v.severity === "error").length;
    const warnCount = violations.filter((v) => v.severity === "warn").length;

    if (errorCount > 0) {
      suggestions.push(`Fix ${errorCount} error(s) before proceeding`);
    }
    if (warnCount > 0) {
      suggestions.push(`Consider addressing ${warnCount} warning(s) for better code quality`);
    }
  }

  return {
    valid: violations.filter((v) => v.severity === "error").length === 0,
    filePath,
    violations,
    stats: {
      lines,
      cyclomaticComplexity,
      importCount: imports.length,
    },
    suggestions,
  };
}

/**
 * 슬롯 메타데이터에서 제약 조건 추출 (파일 파싱)
 */
export async function extractSlotMetadata(filePath: string): Promise<SlotMetadata | null> {
  try {
    const content = await readFile(filePath, "utf-8");

    // .purpose() 호출 찾기
    const purposeMatch = content.match(/\.purpose\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    const purpose = purposeMatch?.[1];

    // .description() 호출 찾기
    const descMatch = content.match(/\.description\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    const description = descMatch?.[1];

    // .constraints() 호출 찾기
    // Note: 이 파서는 간단한 객체만 지원합니다.
    // 복잡한 constraints는 런타임에 getSemanticMetadata()로 조회하세요.
    const constraintsMatch = content.match(/\.constraints\s*\(\s*(\{[\s\S]*?\})\s*\)/);
    let constraints: SlotConstraints | undefined;
    if (constraintsMatch) {
      try {
        // 간단한 객체 리터럴 파싱 - 키-값 쌍을 개별 추출
        const objStr = constraintsMatch[1];
        const result: Record<string, unknown> = {};

        // 숫자 값 추출 (maxLines: 50 등)
        const numberMatches = objStr.matchAll(/(\w+)\s*:\s*(\d+)/g);
        for (const match of numberMatches) {
          result[match[1]] = parseInt(match[2], 10);
        }

        // 문자열 배열 추출 (requiredPatterns: ["a", "b"] 등)
        const arrayMatches = objStr.matchAll(/(\w+)\s*:\s*\[([\s\S]*?)\]/g);
        for (const match of arrayMatches) {
          const items = match[2].match(/['"`]([^'"`]+)['"`]/g);
          if (items) {
            result[match[1]] = items.map((s) => s.slice(1, -1));
          }
        }

        if (Object.keys(result).length > 0) {
          constraints = result as SlotConstraints;
        }
      } catch {
        // 파싱 실패 시 무시 - 런타임에 getSemanticMetadata() 사용 권장
      }
    }

    if (!purpose && !description && !constraints) {
      return null;
    }

    return {
      purpose,
      description,
      constraints,
    };
  } catch {
    return null;
  }
}

/**
 * 슬롯 목록 검증
 */
export async function validateSlots(
  slotFiles: string[],
  defaultConstraints?: SlotConstraints
): Promise<{
  totalSlots: number;
  validSlots: number;
  invalidSlots: number;
  results: SemanticSlotValidationResult[];
}> {
  const results: SemanticSlotValidationResult[] = [];

  for (const filePath of slotFiles) {
    // 파일에서 메타데이터 추출 시도
    const metadata = await extractSlotMetadata(filePath);
    const constraints = metadata?.constraints || defaultConstraints;

    if (constraints) {
      const result = await validateSlotConstraints(filePath, constraints);
      result.metadata = metadata || undefined;
      results.push(result);
    } else {
      // 제약 조건 없으면 기본 검증만
      results.push({
        valid: true,
        filePath,
        violations: [],
        stats: { lines: 0, cyclomaticComplexity: 0, importCount: 0 },
        suggestions: ["No constraints defined for this slot"],
      });
    }
  }

  const validSlots = results.filter((r) => r.valid).length;

  return {
    totalSlots: slotFiles.length,
    validSlots,
    invalidSlots: slotFiles.length - validSlots,
    results,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Constraints
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 기본 슬롯 제약 조건
 */
export const DEFAULT_SLOT_CONSTRAINTS: SlotConstraints = {
  maxLines: 100,
  maxCyclomaticComplexity: 15,
  forbiddenPatterns: ["hardcoded-secret", "sensitive-data-log"],
};

/**
 * API 슬롯용 권장 제약 조건
 */
export const API_SLOT_CONSTRAINTS: SlotConstraints = {
  maxLines: 80,
  maxCyclomaticComplexity: 12,
  requiredPatterns: ["input-validation", "error-handling"],
  forbiddenPatterns: ["hardcoded-secret", "sensitive-data-log"],
};

/**
 * 읽기 전용 API 슬롯용 제약 조건
 */
export const READONLY_SLOT_CONSTRAINTS: SlotConstraints = {
  maxLines: 50,
  maxCyclomaticComplexity: 10,
  requiredPatterns: ["error-handling"],
  forbiddenPatterns: ["direct-db-write", "hardcoded-secret"],
};
