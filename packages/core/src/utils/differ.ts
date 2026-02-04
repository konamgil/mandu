/**
 * Mandu 설정 Diff 유틸리티 📊
 *
 * ont-run의 differ 기법을 참고하여 구현
 * @see DNA/ont-run/src/lockfile/differ.ts
 *
 * 특징:
 * - 설정 객체 간 변경사항 감지
 * - 민감 정보 자동 마스킹 (redact)
 * - 콘솔 친화적 시각화
 */

// ANSI 색상 코드 (외부 의존성 없음)
const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

const pc = {
  cyan: (s: string) => `${ansi.cyan}${s}${ansi.reset}`,
  green: (s: string) => `${ansi.green}${s}${ansi.reset}`,
  red: (s: string) => `${ansi.red}${s}${ansi.reset}`,
  yellow: (s: string) => `${ansi.yellow}${s}${ansi.reset}`,
  bold: (s: string) => `${ansi.bold}${s}${ansi.reset}`,
  dim: (s: string) => `${ansi.dim}${s}${ansi.reset}`,
};

// ============================================
// 타입 정의
// ============================================

export interface ConfigDiff {
  /** 변경사항 존재 여부 */
  hasChanges: boolean;
  /** 비교 시각 */
  timestamp: string;

  /** MCP 서버 변경 */
  mcpServers: {
    added: string[];
    removed: string[];
    modified: Array<{
      name: string;
      changes: Record<string, { old: unknown; new: unknown }>;
    }>;
  };

  /** 프로젝트 설정 변경 */
  projectConfig: {
    added: string[];
    removed: string[];
    modified: Array<{
      key: string;
      old: unknown;
      new: unknown;
    }>;
  };
}

export interface DiffFormatOptions {
  /** 색상 사용 여부 (기본값: true) */
  color?: boolean;
  /** 상세 출력 (기본값: false) */
  verbose?: boolean;
  /** 마스킹할 키 목록 */
  redactKeys?: string[];
  /** 비밀 정보 출력 허용 (기본값: false) */
  showSecrets?: boolean;
}

/** 기본 민감 키 목록 */
const DEFAULT_REDACT_KEYS = [
  "token",
  "secret",
  "key",
  "password",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "private_key",
  "credential",
];

// ============================================
// Diff 계산
// ============================================

/**
 * 두 설정 객체 비교
 *
 * @example
 * ```typescript
 * const oldConfig = { port: 3000, mcpServers: { a: { url: "..." } } };
 * const newConfig = { port: 3001, mcpServers: { b: { url: "..." } } };
 * const diff = diffConfig(oldConfig, newConfig);
 * ```
 */
export function diffConfig(
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>
): ConfigDiff {
  const timestamp = new Date().toISOString();

  // MCP 서버 비교
  const oldMcp = (oldConfig.mcpServers ?? {}) as Record<string, unknown>;
  const newMcp = (newConfig.mcpServers ?? {}) as Record<string, unknown>;
  const mcpDiff = diffObjects(oldMcp, newMcp, "mcpServers");

  // 프로젝트 설정 비교 (mcpServers 제외)
  const { mcpServers: _o, ...oldRest } = oldConfig;
  const { mcpServers: _n, ...newRest } = newConfig;
  const projectDiff = diffFlatConfig(oldRest, newRest);

  const hasChanges =
    mcpDiff.added.length > 0 ||
    mcpDiff.removed.length > 0 ||
    mcpDiff.modified.length > 0 ||
    projectDiff.added.length > 0 ||
    projectDiff.removed.length > 0 ||
    projectDiff.modified.length > 0;

  return {
    hasChanges,
    timestamp,
    mcpServers: mcpDiff,
    projectConfig: projectDiff,
  };
}

/**
 * 객체 간 diff (MCP 서버 등 중첩 객체용)
 */
function diffObjects(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  _context: string
): ConfigDiff["mcpServers"] {
  const oldKeys = new Set(Object.keys(oldObj));
  const newKeys = new Set(Object.keys(newObj));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: Array<{ name: string; changes: Record<string, { old: unknown; new: unknown }> }> = [];

  // 추가된 키
  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      added.push(key);
    }
  }

  // 삭제된 키
  for (const key of oldKeys) {
    if (!newKeys.has(key)) {
      removed.push(key);
    }
  }

  // 수정된 키
  for (const key of oldKeys) {
    if (newKeys.has(key)) {
      const changes = findChanges(
        oldObj[key] as Record<string, unknown>,
        newObj[key] as Record<string, unknown>
      );
      if (Object.keys(changes).length > 0) {
        modified.push({ name: key, changes });
      }
    }
  }

  return { added, removed, modified };
}

/**
 * 플랫 설정 비교 (최상위 키-값)
 */
function diffFlatConfig(
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>
): ConfigDiff["projectConfig"] {
  const oldKeys = new Set(Object.keys(oldConfig));
  const newKeys = new Set(Object.keys(newConfig));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: Array<{ key: string; old: unknown; new: unknown }> = [];

  // 추가된 키
  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      added.push(key);
    }
  }

  // 삭제된 키
  for (const key of oldKeys) {
    if (!newKeys.has(key)) {
      removed.push(key);
    }
  }

  // 수정된 키
  for (const key of oldKeys) {
    if (newKeys.has(key)) {
      if (!deepEqual(oldConfig[key], newConfig[key])) {
        modified.push({
          key,
          old: oldConfig[key],
          new: newConfig[key],
        });
      }
    }
  }

  return { added, removed, modified };
}

/**
 * 두 객체 간 변경된 필드 찾기
 */
function findChanges(
  oldObj: Record<string, unknown> | undefined,
  newObj: Record<string, unknown> | undefined
): Record<string, { old: unknown; new: unknown }> {
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  if (!oldObj || !newObj) {
    return changes;
  }

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (!deepEqual(oldVal, newVal)) {
      changes[key] = { old: oldVal, new: newVal };
    }
  }

  return changes;
}

/**
 * 깊은 비교
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, i) => deepEqual(val, b[i]));
    }

    if (Array.isArray(a) || Array.isArray(b)) return false;

    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) =>
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
    );
  }

  return false;
}

// ============================================
// Diff 포맷팅
// ============================================

/**
 * Diff를 문자열로 포맷
 */
export function formatConfigDiff(
  diff: ConfigDiff,
  options: DiffFormatOptions = {}
): string {
  const {
    color = true,
    verbose = false,
    redactKeys = DEFAULT_REDACT_KEYS,
    showSecrets = false,
  } = options;

  const c = color ? pc : noColor;
  const lines: string[] = [];

  // 헤더
  lines.push(c.cyan("╭─────────────────────────────────────────────────╮"));
  lines.push(c.cyan("│") + "  " + c.bold("mandu.config 변경 감지") + "                        " + c.cyan("│"));
  lines.push(c.cyan("├─────────────────────────────────────────────────┤"));

  if (!diff.hasChanges) {
    lines.push(c.cyan("│") + "  " + c.green("✓ 변경사항 없음") + "                               " + c.cyan("│"));
    lines.push(c.cyan("╰─────────────────────────────────────────────────╯"));
    return lines.join("\n");
  }

  lines.push(c.cyan("│") + "                                                 " + c.cyan("│"));

  // MCP 서버 변경
  if (
    diff.mcpServers.added.length > 0 ||
    diff.mcpServers.removed.length > 0 ||
    diff.mcpServers.modified.length > 0
  ) {
    lines.push(c.cyan("│") + "  " + c.bold("MCP 서버:") + "                                     " + c.cyan("│"));

    for (const name of diff.mcpServers.added) {
      lines.push(c.cyan("│") + "    " + c.green(`+ ${name}`) + " (추가됨)" + padding(30 - name.length) + c.cyan("│"));
    }

    for (const name of diff.mcpServers.removed) {
      lines.push(c.cyan("│") + "    " + c.red(`- ${name}`) + " (삭제됨)" + padding(30 - name.length) + c.cyan("│"));
    }

    for (const mod of diff.mcpServers.modified) {
      lines.push(c.cyan("│") + "    " + c.yellow(`~ ${mod.name}`) + " (수정됨)" + padding(30 - mod.name.length) + c.cyan("│"));

      if (verbose) {
        for (const [key, val] of Object.entries(mod.changes)) {
          const oldStr = redactValue(key, val.old, redactKeys, showSecrets);
          const newStr = redactValue(key, val.new, redactKeys, showSecrets);
          lines.push(c.cyan("│") + `      ${c.dim(key)}: ${c.red(oldStr)} → ${c.green(newStr)}` + padding(15) + c.cyan("│"));
        }
      }
    }

    lines.push(c.cyan("│") + "                                                 " + c.cyan("│"));
  }

  // 프로젝트 설정 변경
  if (
    diff.projectConfig.added.length > 0 ||
    diff.projectConfig.removed.length > 0 ||
    diff.projectConfig.modified.length > 0
  ) {
    lines.push(c.cyan("│") + "  " + c.bold("프로젝트 설정:") + "                                " + c.cyan("│"));

    for (const key of diff.projectConfig.added) {
      lines.push(c.cyan("│") + "    " + c.green(`+ ${key}`) + " (추가됨)" + padding(30 - key.length) + c.cyan("│"));
    }

    for (const key of diff.projectConfig.removed) {
      lines.push(c.cyan("│") + "    " + c.red(`- ${key}`) + " (삭제됨)" + padding(30 - key.length) + c.cyan("│"));
    }

    for (const mod of diff.projectConfig.modified) {
      const oldStr = redactValue(mod.key, mod.old, redactKeys, showSecrets);
      const newStr = redactValue(mod.key, mod.new, redactKeys, showSecrets);
      lines.push(c.cyan("│") + "    " + c.yellow(`~ ${mod.key}:`) + ` ${c.red(oldStr)} → ${c.green(newStr)}` + padding(10) + c.cyan("│"));
    }

    lines.push(c.cyan("│") + "                                                 " + c.cyan("│"));
  }

  lines.push(c.cyan("╰─────────────────────────────────────────────────╯"));

  return lines.join("\n");
}

/**
 * Diff를 콘솔에 출력
 */
export function printConfigDiff(
  diff: ConfigDiff,
  options: DiffFormatOptions = {}
): void {
  console.log(formatConfigDiff(diff, options));
}

// ============================================
// 유틸리티
// ============================================

/**
 * 민감 정보 마스킹
 */
function redactValue(
  key: string,
  value: unknown,
  redactKeys: string[],
  showSecrets: boolean
): string {
  const strValue = typeof value === "object" ? JSON.stringify(value) : String(value);

  if (showSecrets) {
    return strValue;
  }

  const lowerKey = key.toLowerCase();
  const shouldRedact = redactKeys.some((rk) => lowerKey.includes(rk.toLowerCase()));

  if (shouldRedact) {
    return "***";
  }

  return strValue;
}

/**
 * 패딩 생성 (고정 폭 출력용)
 */
function padding(n: number): string {
  return " ".repeat(Math.max(0, n));
}

/**
 * 색상 없는 출력용 더미 함수들
 */
const noColor = {
  cyan: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  bold: (s: string) => s,
  dim: (s: string) => s,
};

// ============================================
// 요약 함수
// ============================================

/**
 * Diff 요약 정보
 */
export function summarizeDiff(diff: ConfigDiff): string {
  if (!diff.hasChanges) {
    return "변경사항 없음";
  }

  const parts: string[] = [];

  const mcpTotal =
    diff.mcpServers.added.length +
    diff.mcpServers.removed.length +
    diff.mcpServers.modified.length;

  const configTotal =
    diff.projectConfig.added.length +
    diff.projectConfig.removed.length +
    diff.projectConfig.modified.length;

  if (mcpTotal > 0) {
    parts.push(`MCP 서버: ${mcpTotal}개 변경`);
  }

  if (configTotal > 0) {
    parts.push(`설정: ${configTotal}개 변경`);
  }

  return parts.join(", ");
}

/**
 * 변경사항이 있는지 빠르게 확인
 */
export function hasConfigChanges(
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>
): boolean {
  return diffConfig(oldConfig, newConfig).hasChanges;
}
