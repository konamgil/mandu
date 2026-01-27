/**
 * Slot Content Validator
 * 슬롯 파일 내용을 작성 전에 검증하고 문제를 식별합니다.
 */

export interface SlotValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  line?: number;
  suggestion: string;
  autoFixable: boolean;
}

export interface SlotValidationResult {
  valid: boolean;
  issues: SlotValidationIssue[];
}

// 금지된 import 모듈들
const FORBIDDEN_IMPORTS = [
  "fs",
  "child_process",
  "cluster",
  "worker_threads",
  "node:fs",
  "node:child_process",
  "node:cluster",
  "node:worker_threads",
];

// 필수 패턴들
const REQUIRED_PATTERNS = {
  manduImport: /import\s+.*\bMandu\b.*from\s+['"]@mandujs\/core['"]/,
  fillingPattern: /Mandu\s*\.\s*filling\s*\(\s*\)/,
  defaultExport: /export\s+default\b/,
};

/**
 * 슬롯 내용을 검증합니다.
 */
export function validateSlotContent(content: string): SlotValidationResult {
  const issues: SlotValidationIssue[] = [];
  const lines = content.split("\n");

  // 1. 금지된 import 검사
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const forbidden of FORBIDDEN_IMPORTS) {
      // import 문에서 금지된 모듈 체크
      const importPattern = new RegExp(
        `import\\s+.*from\\s+['"]${forbidden.replace("/", "\\/")}['"]`
      );
      const requirePattern = new RegExp(
        `require\\s*\\(\\s*['"]${forbidden.replace("/", "\\/")}['"]\\s*\\)`
      );

      if (importPattern.test(line) || requirePattern.test(line)) {
        issues.push({
          code: "FORBIDDEN_IMPORT",
          severity: "error",
          message: `금지된 모듈 import: '${forbidden}'`,
          line: i + 1,
          suggestion: `'${forbidden}' 대신 Bun의 안전한 API 또는 adapter를 사용하세요`,
          autoFixable: true,
        });
      }
    }
  }

  // 2. Mandu import 검사
  if (!REQUIRED_PATTERNS.manduImport.test(content)) {
    issues.push({
      code: "MISSING_MANDU_IMPORT",
      severity: "error",
      message: "Mandu import가 없습니다",
      suggestion: "import { Mandu } from '@mandujs/core' 추가 필요",
      autoFixable: true,
    });
  }

  // 3. Mandu.filling() 패턴 검사
  if (!REQUIRED_PATTERNS.fillingPattern.test(content)) {
    issues.push({
      code: "MISSING_FILLING_PATTERN",
      severity: "error",
      message: "Mandu.filling() 패턴이 없습니다",
      suggestion: "슬롯은 Mandu.filling()으로 시작해야 합니다",
      autoFixable: false,
    });
  }

  // 4. default export 검사
  if (!REQUIRED_PATTERNS.defaultExport.test(content)) {
    issues.push({
      code: "MISSING_DEFAULT_EXPORT",
      severity: "error",
      message: "default export가 없습니다",
      suggestion: "export default Mandu.filling()... 형태로 작성하세요",
      autoFixable: true,
    });
  }

  // 5. 기본 문법 검사 (간단한 체크)
  const syntaxIssues = checkBasicSyntax(content, lines);
  issues.push(...syntaxIssues);

  // 6. HTTP 메서드 핸들러 검사
  const methodIssues = checkHttpMethods(content);
  issues.push(...methodIssues);

  return {
    valid: issues.filter((i) => i.severity === "error").length === 0,
    issues,
  };
}

/**
 * 기본 문법 검사
 */
function checkBasicSyntax(
  content: string,
  lines: string[]
): SlotValidationIssue[] {
  const issues: SlotValidationIssue[] = [];

  // 괄호 균형 체크
  const brackets = { "(": 0, "{": 0, "[": 0 };
  const bracketPairs: Record<string, keyof typeof brackets> = {
    ")": "(",
    "}": "{",
    "]": "[",
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 문자열 내부는 스킵 (간단한 처리)
    const withoutStrings = line
      .replace(/"[^"]*"/g, "")
      .replace(/'[^']*'/g, "")
      .replace(/`[^`]*`/g, "");

    for (const char of withoutStrings) {
      if (char in brackets) {
        brackets[char as keyof typeof brackets]++;
      } else if (char in bracketPairs) {
        brackets[bracketPairs[char]]--;
      }
    }
  }

  if (brackets["("] !== 0) {
    issues.push({
      code: "UNBALANCED_PARENTHESES",
      severity: "error",
      message: `괄호 불균형: ${brackets["("] > 0 ? "닫는" : "여는"} 괄호 부족`,
      suggestion: "괄호 쌍을 확인하세요",
      autoFixable: false,
    });
  }

  if (brackets["{"] !== 0) {
    issues.push({
      code: "UNBALANCED_BRACES",
      severity: "error",
      message: `중괄호 불균형: ${brackets["{"] > 0 ? "닫는" : "여는"} 중괄호 부족`,
      suggestion: "중괄호 쌍을 확인하세요",
      autoFixable: false,
    });
  }

  if (brackets["["] !== 0) {
    issues.push({
      code: "UNBALANCED_BRACKETS",
      severity: "error",
      message: `대괄호 불균형: ${brackets["["] > 0 ? "닫는" : "여는"} 대괄호 부족`,
      suggestion: "대괄호 쌍을 확인하세요",
      autoFixable: false,
    });
  }

  return issues;
}

/**
 * HTTP 메서드 핸들러 검사
 */
function checkHttpMethods(content: string): SlotValidationIssue[] {
  const issues: SlotValidationIssue[] = [];

  // .get(), .post() 등의 핸들러가 있는지 확인
  const methodPattern = /\.(get|post|put|patch|delete|options|head)\s*\(/gi;
  const hasMethod = methodPattern.test(content);

  if (!hasMethod) {
    issues.push({
      code: "NO_HTTP_HANDLER",
      severity: "warning",
      message: "HTTP 메서드 핸들러가 없습니다",
      suggestion:
        ".get(ctx => ...), .post(ctx => ...) 등의 핸들러를 추가하세요",
      autoFixable: false,
    });
  }

  // ctx.ok(), ctx.json() 등 응답 패턴 확인
  const responsePattern = /ctx\s*\.\s*(ok|json|created|noContent|error|html)\s*\(/;
  if (hasMethod && !responsePattern.test(content)) {
    issues.push({
      code: "NO_RESPONSE_PATTERN",
      severity: "warning",
      message: "응답 패턴이 없습니다",
      suggestion:
        "핸들러에서 ctx.ok(), ctx.json() 등으로 응답을 반환하세요",
      autoFixable: false,
    });
  }

  return issues;
}

/**
 * 에러 요약 생성
 */
export function summarizeValidationIssues(
  issues: SlotValidationIssue[]
): string {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const parts: string[] = [];

  if (errors.length > 0) {
    parts.push(`${errors.length}개 에러`);
  }
  if (warnings.length > 0) {
    parts.push(`${warnings.length}개 경고`);
  }

  return parts.join(", ") || "문제 없음";
}
