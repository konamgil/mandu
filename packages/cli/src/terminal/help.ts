/**
 * DNA-015: Semantic Help System
 *
 * 시맨틱 도움말 포맷팅
 * - 예제 기반 도움말
 * - 테마 적용 출력
 * - 섹션별 구조화
 */

import { theme, colorize, isRich } from "./theme.js";

/**
 * 도움말 예제 타입
 * [명령어, 설명]
 */
export type HelpExample = readonly [command: string, description: string];

/**
 * 명령어 옵션 정의
 */
export interface HelpOption {
  /** 플래그 (예: "--port", "-p, --port") */
  flags: string;
  /** 설명 */
  description: string;
  /** 기본값 */
  default?: string;
  /** 필수 여부 */
  required?: boolean;
}

/**
 * 서브커맨드 정의
 */
export interface HelpSubcommand {
  /** 서브커맨드 이름 */
  name: string;
  /** 설명 */
  description: string;
  /** 별칭 */
  aliases?: string[];
}

/**
 * 도움말 섹션
 */
export interface HelpSection {
  /** 섹션 제목 */
  title: string;
  /** 섹션 내용 */
  content: string;
}

/**
 * 도움말 정의
 */
export interface HelpDefinition {
  /** 명령어 이름 */
  name: string;
  /** 짧은 설명 */
  description: string;
  /** 사용법 */
  usage?: string;
  /** 옵션 목록 */
  options?: HelpOption[];
  /** 서브커맨드 목록 */
  subcommands?: HelpSubcommand[];
  /** 예제 목록 */
  examples?: HelpExample[];
  /** 추가 섹션 */
  sections?: HelpSection[];
  /** 참조 링크 */
  seeAlso?: string[];
}

/**
 * 예제 포맷팅
 *
 * @example
 * ```ts
 * formatHelpExample("mandu dev", "Start development server");
 * // "  mandu dev"
 * // "    Start development server"
 * ```
 */
export function formatHelpExample(command: string, description: string): string {
  const rich = isRich();
  const cmd = rich ? theme.accent(command) : command;
  const desc = rich ? theme.muted(description) : description;

  return `  ${cmd}\n    ${desc}`;
}

/**
 * 예제 그룹 포맷팅
 *
 * @example
 * ```ts
 * formatHelpExampleGroup("Examples:", [
 *   ["mandu dev", "Start development server"],
 *   ["mandu build --prod", "Build for production"],
 * ]);
 * ```
 */
export function formatHelpExampleGroup(
  label: string,
  examples: ReadonlyArray<HelpExample>
): string {
  const rich = isRich();
  const heading = rich ? theme.heading(label) : label;
  const formatted = examples
    .map(([cmd, desc]) => formatHelpExample(cmd, desc))
    .join("\n\n");

  return `${heading}\n${formatted}`;
}

/**
 * 옵션 포맷팅
 */
export function formatHelpOption(option: HelpOption): string {
  const rich = isRich();
  const flags = rich ? theme.option(option.flags) : option.flags;

  let desc = option.description;
  if (option.default) {
    desc += rich
      ? ` ${theme.muted(`(default: ${option.default})`)}`
      : ` (default: ${option.default})`;
  }
  if (option.required) {
    desc += rich ? ` ${theme.warn("[required]")}` : " [required]";
  }

  // 플래그와 설명 정렬
  const padding = Math.max(0, 24 - option.flags.length);
  return `  ${flags}${" ".repeat(padding)}${desc}`;
}

/**
 * 서브커맨드 포맷팅
 */
export function formatHelpSubcommand(subcommand: HelpSubcommand): string {
  const rich = isRich();
  let name = subcommand.name;

  if (subcommand.aliases && subcommand.aliases.length > 0) {
    name += `, ${subcommand.aliases.join(", ")}`;
  }

  const cmd = rich ? theme.command(name) : name;
  const desc = rich ? subcommand.description : subcommand.description;

  const padding = Math.max(0, 20 - name.length);
  return `  ${cmd}${" ".repeat(padding)}${desc}`;
}

/**
 * 섹션 제목 포맷팅
 */
export function formatSectionTitle(title: string): string {
  const rich = isRich();
  return rich ? theme.heading(title) : title;
}

/**
 * 전체 도움말 렌더링
 */
export function renderHelp(def: HelpDefinition): string {
  const lines: string[] = [];
  const rich = isRich();

  // 헤더
  const name = rich ? theme.accent(def.name) : def.name;
  lines.push(`${name} - ${def.description}`);
  lines.push("");

  // 사용법
  if (def.usage) {
    lines.push(formatSectionTitle("Usage:"));
    lines.push(`  ${def.usage}`);
    lines.push("");
  }

  // 서브커맨드
  if (def.subcommands && def.subcommands.length > 0) {
    lines.push(formatSectionTitle("Commands:"));
    for (const sub of def.subcommands) {
      lines.push(formatHelpSubcommand(sub));
    }
    lines.push("");
  }

  // 옵션
  if (def.options && def.options.length > 0) {
    lines.push(formatSectionTitle("Options:"));
    for (const opt of def.options) {
      lines.push(formatHelpOption(opt));
    }
    lines.push("");
  }

  // 예제
  if (def.examples && def.examples.length > 0) {
    lines.push(formatHelpExampleGroup("Examples:", def.examples));
    lines.push("");
  }

  // 추가 섹션
  if (def.sections) {
    for (const section of def.sections) {
      lines.push(formatSectionTitle(section.title));
      lines.push(section.content);
      lines.push("");
    }
  }

  // 참조
  if (def.seeAlso && def.seeAlso.length > 0) {
    lines.push(formatSectionTitle("See Also:"));
    for (const ref of def.seeAlso) {
      lines.push(`  ${ref}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Mandu CLI 기본 도움말 정의
 */
export const MANDU_HELP: HelpDefinition = {
  name: "mandu",
  description: "Agent-Native Web Framework",
  usage: "mandu <command> [options]",
  subcommands: [
    { name: "init", description: "Create a new Mandu project" },
    { name: "dev", description: "Start development server with HMR" },
    { name: "build", description: "Build for production" },
    { name: "start", description: "Start production server" },
    { name: "guard", description: "Check architecture violations", aliases: ["g"] },
    { name: "routes", description: "Manage file-system routes" },
    { name: "openapi", description: "Generate OpenAPI spec" },
    { name: "brain", description: "Setup local AI with Ollama" },
  ],
  options: [
    { flags: "--version, -v", description: "Show version number" },
    { flags: "--help, -h", description: "Show help" },
    { flags: "--json", description: "Output in JSON format" },
    { flags: "--no-color", description: "Disable colored output" },
    { flags: "--verbose", description: "Enable verbose logging" },
  ],
  examples: [
    ["mandu init my-app", "Create a new project"],
    ["mandu dev --port 4000", "Start dev server on port 4000"],
    ["mandu build --prod", "Build for production"],
    ["mandu guard --fix", "Check and auto-fix violations"],
  ],
  sections: [
    {
      title: "Environment Variables:",
      content: `  MANDU_OUTPUT    Output format (json|pretty|plain)
  NO_COLOR        Disable colors (set to any value)
  FORCE_COLOR     Force colors even in non-TTY`,
    },
  ],
  seeAlso: [
    "https://mandujs.com/docs",
    "https://github.com/mandujs/mandu",
  ],
};

/**
 * 명령어별 도움말 렌더링
 */
export function renderCommandHelp(
  commandName: string,
  def: Partial<HelpDefinition>
): string {
  return renderHelp({
    name: `mandu ${commandName}`,
    description: def.description ?? "",
    ...def,
  });
}

/**
 * 간단한 사용법 힌트
 */
export function formatUsageHint(command: string, hint: string): string {
  const rich = isRich();
  const cmd = rich ? theme.accent(command) : command;
  const tip = rich ? theme.muted(hint) : hint;
  return `${tip}\n  ${cmd}`;
}

/**
 * 에러 후 도움말 힌트
 */
export function formatErrorHint(errorMessage: string, helpCommand: string): string {
  const rich = isRich();
  const error = rich ? theme.error(errorMessage) : errorMessage;
  const help = rich ? theme.muted(`Run '${helpCommand}' for more information.`) : `Run '${helpCommand}' for more information.`;
  return `${error}\n\n${help}`;
}
