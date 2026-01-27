/**
 * Slot Content Corrector
 * 슬롯 파일의 자동 수정 가능한 문제를 해결합니다.
 */

import type { SlotValidationIssue } from "./validator";

export interface CorrectionResult {
  corrected: boolean;
  content: string;
  appliedFixes: AppliedFix[];
  remainingIssues: SlotValidationIssue[];
}

export interface AppliedFix {
  code: string;
  description: string;
  before?: string;
  after?: string;
}

// 금지된 import를 대체할 안전한 패턴
const SAFE_ALTERNATIVES: Record<string, string> = {
  fs: "// Use Bun.file() or Bun.write() instead of fs",
  "node:fs": "// Use Bun.file() or Bun.write() instead of fs",
  child_process: "// Use Bun.spawn() or Bun.spawnSync() instead",
  "node:child_process": "// Use Bun.spawn() or Bun.spawnSync() instead",
  cluster: "// Clustering should be handled at the infrastructure level",
  "node:cluster": "// Clustering should be handled at the infrastructure level",
  worker_threads: "// Use Bun workers or external job queues",
  "node:worker_threads": "// Use Bun workers or external job queues",
};

/**
 * 슬롯 내용을 자동 수정합니다.
 */
export function correctSlotContent(
  content: string,
  issues: SlotValidationIssue[]
): CorrectionResult {
  let correctedContent = content;
  const appliedFixes: AppliedFix[] = [];
  const remainingIssues: SlotValidationIssue[] = [];

  for (const issue of issues) {
    if (!issue.autoFixable) {
      remainingIssues.push(issue);
      continue;
    }

    const result = applyFix(correctedContent, issue);
    if (result.fixed) {
      correctedContent = result.content;
      appliedFixes.push({
        code: issue.code,
        description: issue.message,
        before: result.before,
        after: result.after,
      });
    } else {
      remainingIssues.push(issue);
    }
  }

  return {
    corrected: appliedFixes.length > 0,
    content: correctedContent,
    appliedFixes,
    remainingIssues,
  };
}

interface FixResult {
  fixed: boolean;
  content: string;
  before?: string;
  after?: string;
}

function applyFix(content: string, issue: SlotValidationIssue): FixResult {
  switch (issue.code) {
    case "FORBIDDEN_IMPORT":
      return fixForbiddenImport(content, issue);

    case "MISSING_MANDU_IMPORT":
      return fixMissingManduImport(content);

    case "MISSING_DEFAULT_EXPORT":
      return fixMissingDefaultExport(content);

    default:
      return { fixed: false, content };
  }
}

/**
 * 금지된 import를 제거하고 주석으로 대체
 */
function fixForbiddenImport(
  content: string,
  issue: SlotValidationIssue
): FixResult {
  const lines = content.split("\n");

  if (!issue.line) {
    return { fixed: false, content };
  }

  const lineIndex = issue.line - 1;
  const originalLine = lines[lineIndex];

  // 어떤 금지된 모듈인지 찾기
  let forbiddenModule = "";
  for (const [module, alternative] of Object.entries(SAFE_ALTERNATIVES)) {
    if (originalLine.includes(`'${module}'`) || originalLine.includes(`"${module}"`)) {
      forbiddenModule = module;
      break;
    }
  }

  if (!forbiddenModule) {
    return { fixed: false, content };
  }

  // import 문을 주석으로 대체
  const alternative = SAFE_ALTERNATIVES[forbiddenModule];
  lines[lineIndex] = `// REMOVED: ${originalLine.trim()}\n${alternative}`;

  return {
    fixed: true,
    content: lines.join("\n"),
    before: originalLine,
    after: lines[lineIndex],
  };
}

/**
 * Mandu import 추가
 */
function fixMissingManduImport(content: string): FixResult {
  const manduImport = `import { Mandu } from "@mandujs/core";\n`;

  // 이미 다른 import가 있는지 확인
  const hasImports = /^import\s+/m.test(content);

  let newContent: string;
  if (hasImports) {
    // 첫 번째 import 앞에 추가
    newContent = content.replace(/^(import\s+)/m, `${manduImport}$1`);
  } else {
    // 파일 맨 앞에 추가
    newContent = manduImport + content;
  }

  return {
    fixed: true,
    content: newContent,
    before: "(없음)",
    after: manduImport.trim(),
  };
}

/**
 * default export 추가
 */
function fixMissingDefaultExport(content: string): FixResult {
  // Mandu.filling()이 있는지 확인
  const fillingMatch = content.match(/Mandu\s*\.\s*filling\s*\(\s*\)/);

  if (!fillingMatch) {
    // filling 패턴이 없으면 수정 불가
    return { fixed: false, content };
  }

  // export default가 없는 Mandu.filling() 찾기
  // 예: const handler = Mandu.filling()... -> export default Mandu.filling()...
  const patterns = [
    // const/let/var handler = Mandu.filling()
    /^(\s*)(const|let|var)\s+\w+\s*=\s*(Mandu\s*\.\s*filling\s*\(\s*\))/m,
    // 단독 Mandu.filling()
    /^(\s*)(Mandu\s*\.\s*filling\s*\(\s*\))/m,
  ];

  for (const pattern of patterns) {
    if (pattern.test(content)) {
      const newContent = content.replace(pattern, "$1export default $3");
      return {
        fixed: true,
        content: newContent,
        before: content.match(pattern)?.[0],
        after: newContent.match(/export default Mandu\.filling\(\)/)?.[0],
      };
    }
  }

  // 파일 끝에 export default 추가 시도
  if (content.includes("Mandu.filling()") && !content.includes("export default")) {
    // 마지막 세미콜론 또는 중괄호 뒤에 추가
    const lastLine = content.trimEnd();
    if (!lastLine.endsWith(";") && !lastLine.endsWith("}")) {
      return { fixed: false, content };
    }
  }

  return { fixed: false, content };
}

/**
 * 여러 번의 수정 시도 (Self-correction loop)
 */
export async function runSlotCorrection(
  content: string,
  validateFn: (content: string) => { valid: boolean; issues: SlotValidationIssue[] },
  maxRetries: number = 3
): Promise<{
  success: boolean;
  finalContent: string;
  attempts: number;
  allFixes: AppliedFix[];
  remainingIssues: SlotValidationIssue[];
}> {
  let currentContent = content;
  let attempts = 0;
  const allFixes: AppliedFix[] = [];

  while (attempts < maxRetries) {
    attempts++;

    // 1. 검증
    const validation = validateFn(currentContent);

    if (validation.valid) {
      return {
        success: true,
        finalContent: currentContent,
        attempts,
        allFixes,
        remainingIssues: [],
      };
    }

    // 2. 자동 수정 가능한 문제가 있는지 확인
    const autoFixable = validation.issues.filter((i) => i.autoFixable);
    if (autoFixable.length === 0) {
      // 자동 수정 불가능한 문제만 남음
      return {
        success: false,
        finalContent: currentContent,
        attempts,
        allFixes,
        remainingIssues: validation.issues,
      };
    }

    // 3. 수정 적용
    const correction = correctSlotContent(currentContent, validation.issues);
    allFixes.push(...correction.appliedFixes);

    if (!correction.corrected) {
      // 수정이 적용되지 않음
      return {
        success: false,
        finalContent: currentContent,
        attempts,
        allFixes,
        remainingIssues: validation.issues,
      };
    }

    currentContent = correction.content;
  }

  // maxRetries 도달
  const finalValidation = validateFn(currentContent);
  return {
    success: finalValidation.valid,
    finalContent: currentContent,
    attempts,
    allFixes,
    remainingIssues: finalValidation.issues,
  };
}
