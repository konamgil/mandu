/**
 * Slot Content Validator
 * 슬롯 파일 내용을 작성 전에 검증하고 문제를 식별합니다.
 *
 * 검증 항목:
 * 1. 필수 import/export 패턴
 * 2. Mandu.filling() 사용 여부
 * 3. export default Mandu.filling() 형태 검증
 * 4. 핸들러 반환 타입 검증 (ctx.ok(), ctx.json() 등)
 * 5. 금지된 모듈 import 검사
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

// Slot에서 직접 import를 피해야 하는 모듈
const DISCOURAGED_SLOT_IMPORTS = ["zod"];

// 필수 패턴들 (더 엄격한 검사)
const REQUIRED_PATTERNS = {
  manduImport: /import\s+.*\bMandu\b.*from\s+['"]@mandujs\/core['"]/,
  fillingPattern: /Mandu\s*\.\s*filling\s*\(\s*\)/,
  defaultExport: /export\s+default\b/,
  // export default Mandu.filling() 또는 export default 변수명
  exportDefaultFilling: /export\s+default\s+(Mandu\s*\.\s*filling\s*\(\s*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)/,
};

/**
 * 주석을 제거한 코드 반환
 * 한줄 주석(//)과 블록 주석 제거
 */
function stripComments(content: string): string {
  // 문자열 내부는 보존하면서 주석만 제거
  let result = "";
  let i = 0;
  let inString: string | null = null;
  let inComment: "line" | "block" | null = null;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    // 문자열 처리
    if (!inComment) {
      if (!inString && (char === '"' || char === "'" || char === "`")) {
        inString = char;
        result += char;
        i++;
        continue;
      }
      if (inString && char === inString && content[i - 1] !== "\\") {
        inString = null;
        result += char;
        i++;
        continue;
      }
      if (inString) {
        result += char;
        i++;
        continue;
      }
    }

    // 주석 시작 감지
    if (!inString && !inComment) {
      if (char === "/" && nextChar === "/") {
        inComment = "line";
        i += 2;
        continue;
      }
      if (char === "/" && nextChar === "*") {
        inComment = "block";
        i += 2;
        continue;
      }
    }

    // 주석 종료 감지
    if (inComment === "line" && char === "\n") {
      inComment = null;
      result += char; // 줄바꿈은 유지
      i++;
      continue;
    }
    if (inComment === "block" && char === "*" && nextChar === "/") {
      inComment = null;
      i += 2;
      continue;
    }

    // 주석 내부면 스킵
    if (inComment) {
      i++;
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

// 올바른 응답 패턴 (ctx 메서드 호출)
const VALID_RESPONSE_PATTERNS = [
  /return\s+ctx\s*\.\s*(ok|json|created|noContent|notFound|badRequest|error|html|redirect|stream)\s*\(/,
  /return\s+new\s+Response\s*\(/,
  /return\s+Response\s*\.\s*(json|redirect)\s*\(/,
];

// 잘못된 반환 패턴 (일반 객체 직접 반환)
const INVALID_RETURN_PATTERNS = [
  /return\s+\{\s*[^}]*\}\s*;?\s*$/m,  // return { ... }; (Response가 아닌 객체)
];

/**
 * 슬롯 내용을 검증합니다.
 */
export function validateSlotContent(content: string): SlotValidationResult {
  const issues: SlotValidationIssue[] = [];
  const lines = content.split("\n");

  // 주석 제거된 코드 (export default 등 패턴 검사용)
  const codeWithoutComments = stripComments(content);

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

    for (const discouraged of DISCOURAGED_SLOT_IMPORTS) {
      const importPattern = new RegExp(
        `import\\s+.*from\\s+['"]${discouraged}['"]`
      );
      const requirePattern = new RegExp(
        `require\\s*\\(\\s*['"]${discouraged}['"]\\s*\\)`
      );

      if (importPattern.test(line) || requirePattern.test(line)) {
        issues.push({
          code: "ZOD_DIRECT_IMPORT",
          severity: "error",
          message: `Slot에서 '${discouraged}' 직접 import 금지`,
          line: i + 1,
          suggestion: "계약은 spec/contracts/*.contract.ts에 정의하고 ctx.input()으로 검증하세요",
          autoFixable: false,
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

  // 4. default export 검사 (강화됨) - 주석 제거된 코드에서 검사
  const hasDefaultExport = REQUIRED_PATTERNS.defaultExport.test(codeWithoutComments);
  const hasExportDefaultFilling = REQUIRED_PATTERNS.exportDefaultFilling.test(codeWithoutComments);

  if (!hasDefaultExport) {
    // Mandu.filling()이 있는데 export default가 없는 경우 - 변수에 할당만 함
    const fillingVarMatch = codeWithoutComments.match(/(?:const|let|var)\s+(\w+)\s*=\s*Mandu\s*\.\s*filling\s*\(\s*\)/);
    if (fillingVarMatch) {
      const varName = fillingVarMatch[1];
      issues.push({
        code: "MISSING_DEFAULT_EXPORT",
        severity: "error",
        message: `default export가 없습니다. '${varName}'가 export 되지 않았습니다`,
        suggestion: `'export default ${varName};' 를 파일 끝에 추가하거나, 'export default Mandu.filling()...' 형태로 작성하세요`,
        autoFixable: true,
      });
    } else {
      issues.push({
        code: "MISSING_DEFAULT_EXPORT",
        severity: "error",
        message: "default export가 없습니다",
        suggestion: "export default Mandu.filling()... 형태로 작성하세요",
        autoFixable: true,
      });
    }
  } else if (hasDefaultExport && REQUIRED_PATTERNS.fillingPattern.test(codeWithoutComments) && !hasExportDefaultFilling) {
    // export default는 있지만 Mandu.filling()을 export하지 않는 경우
    issues.push({
      code: "INVALID_DEFAULT_EXPORT",
      severity: "warning",
      message: "export default가 Mandu.filling()을 직접 export하지 않습니다",
      suggestion: "export default Mandu.filling()... 형태로 작성하거나, 변수명을 export default로 내보내세요",
      autoFixable: false,
    });
  }

  // 5. 기본 문법 검사 (간단한 체크) - 주석 제거된 코드로 검사
  const syntaxIssues = checkBasicSyntax(codeWithoutComments, codeWithoutComments.split("\n"));
  issues.push(...syntaxIssues);

  // 6. HTTP 메서드 핸들러 검사 (강화됨)
  const methodIssues = checkHttpMethods(content, lines);
  issues.push(...methodIssues);

  // 7. 핸들러 반환 타입 검사 (신규)
  const returnIssues = checkHandlerReturns(content, lines);
  issues.push(...returnIssues);

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
function checkHttpMethods(content: string, lines: string[]): SlotValidationIssue[] {
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
  const responsePattern = /ctx\s*\.\s*(ok|json|created|noContent|notFound|badRequest|error|html|redirect|stream)\s*\(/;
  if (hasMethod && !responsePattern.test(content)) {
    issues.push({
      code: "NO_RESPONSE_PATTERN",
      severity: "error",  // 에러로 승격 (warning → error)
      message: "ctx 응답 메서드가 없습니다 (ctx.ok(), ctx.json() 등)",
      suggestion:
        "핸들러에서 ctx.ok(), ctx.json(), ctx.created() 등으로 응답을 반환하세요. 일반 객체 { ... }를 직접 반환하면 안 됩니다.",
      autoFixable: false,
    });
  }

  return issues;
}

/**
 * 핸들러 반환 타입 검사 (신규)
 * 핸들러가 올바른 Response 객체를 반환하는지 검사
 */
function checkHandlerReturns(content: string, lines: string[]): SlotValidationIssue[] {
  const issues: SlotValidationIssue[] = [];

  // 핸들러 내부에서 일반 객체를 직접 반환하는 패턴 감지
  // 예: return { data: [], status: "ok" };
  const handlerBlockPattern = /\.(get|post|put|patch|delete)\s*\(\s*(?:async\s*)?\(?(?:ctx)?\)?\s*=>\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/gs;

  let match;
  while ((match = handlerBlockPattern.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const handlerBody = match[2];

    // 핸들러 본문에서 return 문 찾기
    const returnStatements = handlerBody.match(/return\s+[^;]+;?/g) || [];

    for (const returnStmt of returnStatements) {
      // ctx.* 또는 new Response 또는 Response.* 패턴 확인
      const isValidReturn =
        /return\s+ctx\s*\./.test(returnStmt) ||
        /return\s+new\s+Response/.test(returnStmt) ||
        /return\s+Response\s*\./.test(returnStmt);

      // 일반 객체 직접 반환 감지: return { ... }
      const isObjectReturn = /return\s+\{/.test(returnStmt) && !isValidReturn;

      // 문자열 직접 반환 감지: return "string" 또는 return 'string'
      const isStringReturn = /return\s+['"`]/.test(returnStmt) && !isValidReturn;

      // throw 문자열 감지 (Error 객체가 아닌 문자열)
      const throwStringPattern = /throw\s+['"`][^'"`]+['"`]/;

      if (isObjectReturn) {
        // return 문이 있는 라인 번호 찾기
        const lineNum = findLineNumber(lines, returnStmt.trim().substring(0, 30));
        issues.push({
          code: "INVALID_HANDLER_RETURN",
          severity: "error",
          message: `${method} 핸들러가 일반 객체를 직접 반환합니다`,
          line: lineNum,
          suggestion: "return { ... } 대신 return ctx.ok({ ... }) 또는 return ctx.json({ ... }) 을 사용하세요",
          autoFixable: false,
        });
      }

      if (isStringReturn) {
        const lineNum = findLineNumber(lines, returnStmt.trim().substring(0, 30));
        issues.push({
          code: "INVALID_HANDLER_RETURN",
          severity: "error",
          message: `${method} 핸들러가 문자열을 직접 반환합니다`,
          line: lineNum,
          suggestion: "return 'text' 대신 return ctx.html('text') 또는 return ctx.ok({ message: 'text' }) 를 사용하세요",
          autoFixable: false,
        });
      }
    }

    // throw 문자열 검사
    if (/throw\s+['"`][^'"`]+['"`]/.test(handlerBody)) {
      const lineNum = findLineNumber(lines, "throw");
      issues.push({
        code: "INVALID_THROW_PATTERN",
        severity: "warning",
        message: `${method} 핸들러에서 문자열을 직접 throw합니다`,
        line: lineNum,
        suggestion: "throw 'message' 대신 throw new Error('message') 를 사용하세요",
        autoFixable: false,
      });
    }
  }

  return issues;
}

/**
 * 특정 텍스트가 있는 라인 번호 찾기
 */
function findLineNumber(lines: string[], searchText: string): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchText)) {
      return i + 1;
    }
  }
  return undefined;
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
