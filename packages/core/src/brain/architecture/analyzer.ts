/**
 * Brain v0.2 - Architecture Analyzer
 *
 * 프로젝트 아키텍처 규칙을 분석하고 위반을 감지
 */

import type {
  ArchitectureConfig,
  ArchitectureViolation,
  CheckLocationRequest,
  CheckLocationResult,
  CheckImportRequest,
  CheckImportResult,
  ProjectStructure,
  FolderInfo,
  FolderRule,
  ImportRule,
} from "./types";
import { getBrain } from "../brain";
import path from "path";
import fs from "fs/promises";

/**
 * Mandu 기본 아키텍처 규칙
 */
export const DEFAULT_ARCHITECTURE_CONFIG: ArchitectureConfig = {
  folders: {
    "spec/": {
      pattern: "spec/**",
      description: "스펙 정의 전용. 구현 코드 금지",
      allowedFiles: ["*.ts", "*.json"],
      readonly: false,
    },
    "spec/slots/": {
      pattern: "spec/slots/**",
      description: "Slot 파일 전용",
      allowedFiles: ["*.slot.ts", "*.client.ts"],
    },
    "spec/contracts/": {
      pattern: "spec/contracts/**",
      description: "Contract 파일 전용",
      allowedFiles: ["*.contract.ts"],
    },
    "generated/": {
      pattern: "**/generated/**",
      description: "자동 생성 파일. 직접 수정 금지",
      readonly: true,
    },
    "apps/server/": {
      pattern: "apps/server/**",
      description: "백엔드 로직",
      allowedFiles: ["*.ts"],
    },
    "apps/web/": {
      pattern: "apps/web/**",
      description: "프론트엔드 컴포넌트",
      allowedFiles: ["*.ts", "*.tsx"],
    },
  },
  imports: [
    {
      source: "apps/web/**",
      forbid: ["fs", "child_process", "path", "crypto"],
      reason: "프론트엔드에서 Node.js 내장 모듈 사용 금지",
    },
    {
      source: "**/generated/**",
      forbid: ["fs", "child_process"],
      reason: "Generated 파일에서 시스템 모듈 사용 금지",
    },
    {
      source: "spec/**",
      forbid: ["react", "react-dom"],
      reason: "Spec 파일에서 React 사용 금지",
    },
  ],
  layers: [
    {
      name: "spec",
      folders: ["spec/**"],
      canDependOn: [],
    },
    {
      name: "generated",
      folders: ["**/generated/**"],
      canDependOn: ["spec"],
    },
    {
      name: "app",
      folders: ["apps/**"],
      canDependOn: ["spec", "generated"],
    },
  ],
  naming: [
    {
      folder: "spec/slots/",
      filePattern: "^[a-z][a-z0-9-]*\\.(slot|client)\\.ts$",
      description: "Slot 파일은 kebab-case.slot.ts 또는 kebab-case.client.ts",
      examples: ["users-list.slot.ts", "counter.client.ts"],
    },
    {
      folder: "spec/contracts/",
      filePattern: "^[a-z][a-z0-9-]*\\.contract\\.ts$",
      description: "Contract 파일은 kebab-case.contract.ts",
      examples: ["users.contract.ts", "auth.contract.ts"],
    },
  ],
};

/**
 * 글로브 패턴을 정규식으로 변환
 */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * 경로가 패턴과 매칭되는지 확인
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const regex = globToRegex(pattern);
  return regex.test(normalizedPath);
}

/**
 * Architecture Analyzer 클래스
 */
export class ArchitectureAnalyzer {
  private config: ArchitectureConfig;
  private rootDir: string;
  private projectStructure: ProjectStructure | null = null;

  constructor(rootDir: string, config?: Partial<ArchitectureConfig>) {
    this.rootDir = rootDir;
    this.config = {
      ...DEFAULT_ARCHITECTURE_CONFIG,
      ...config,
      folders: {
        ...DEFAULT_ARCHITECTURE_CONFIG.folders,
        ...config?.folders,
      },
      imports: [
        ...(DEFAULT_ARCHITECTURE_CONFIG.imports || []),
        ...(config?.imports || []),
      ],
    };
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<ArchitectureConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * 현재 설정 반환
   */
  getConfig(): ArchitectureConfig {
    return this.config;
  }

  /**
   * 파일 위치 검증
   */
  async checkLocation(request: CheckLocationRequest): Promise<CheckLocationResult> {
    const violations: ArchitectureViolation[] = [];
    const normalizedPath = this.toRelativePath(request.path);

    // 1. readonly 폴더 검사
    for (const [key, rule] of Object.entries(this.config.folders || {})) {
      const folderRule = typeof rule === "string"
        ? { pattern: key, description: rule }
        : rule;

      if (folderRule.readonly && matchesPattern(normalizedPath, folderRule.pattern)) {
        violations.push({
          ruleId: "READONLY_FOLDER",
          ruleType: "folder",
          file: request.path,
          message: `이 폴더는 수정 금지입니다: ${folderRule.description}`,
          suggestion: "이 파일은 자동 생성됩니다. bunx mandu generate를 사용하세요.",
          severity: "error",
        });
      }
    }

    // 2. 네이밍 규칙 검사
    for (const rule of this.config.naming || []) {
      if (normalizedPath.startsWith(rule.folder.replace(/\\/g, "/"))) {
        const fileName = path.basename(normalizedPath);
        const regex = new RegExp(rule.filePattern);

        if (!regex.test(fileName)) {
          violations.push({
            ruleId: "NAMING_CONVENTION",
            ruleType: "naming",
            file: request.path,
            message: `네이밍 규칙 위반: ${rule.description}`,
            suggestion: `예시: ${rule.examples?.join(", ") || "N/A"}`,
            severity: "error",
          });
        }
      }
    }

    // 3. 허용된 파일 타입 검사
    for (const [key, rule] of Object.entries(this.config.folders || {})) {
      const folderRule = typeof rule === "string"
        ? { pattern: key, description: rule }
        : rule;

      if (matchesPattern(normalizedPath, folderRule.pattern)) {
        if (folderRule.allowedFiles && folderRule.allowedFiles.length > 0) {
          const fileName = path.basename(normalizedPath);
          const isAllowed = folderRule.allowedFiles.some((pattern) => {
            const regex = globToRegex(pattern);
            return regex.test(fileName);
          });

          if (!isAllowed) {
            violations.push({
              ruleId: "DISALLOWED_FILE_TYPE",
              ruleType: "folder",
              file: request.path,
              message: `이 폴더에서 허용되지 않는 파일 타입입니다`,
              suggestion: `허용: ${folderRule.allowedFiles.join(", ")}`,
              severity: "warning",
            });
          }
        }
      }
    }

    // 4. 내용 기반 검사 (content가 제공된 경우)
    if (request.content) {
      const importViolations = await this.checkImports({
        sourceFile: request.path,
        imports: this.extractImports(request.content),
      });

      for (const v of importViolations.violations) {
        violations.push({
          ruleId: "FORBIDDEN_IMPORT",
          ruleType: "import",
          file: request.path,
          message: v.reason,
          suggestion: v.suggestion,
          severity: "error",
        });
      }
    }

    // 5. LLM 제안 (위반이 있는 경우)
    let suggestion: string | undefined;
    let recommendedPath: string | undefined;

    if (violations.length > 0) {
      const brain = getBrain();
      if (await brain.isLLMAvailable()) {
        const llmSuggestion = await this.getLLMSuggestion(request, violations);
        suggestion = llmSuggestion.suggestion;
        recommendedPath = llmSuggestion.recommendedPath;
      } else {
        // 템플릿 기반 제안
        recommendedPath = this.getTemplateRecommendedPath(request.path);
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
      suggestion,
      recommendedPath,
    };
  }

  /**
   * Import 검증
   */
  async checkImports(request: CheckImportRequest): Promise<CheckImportResult> {
    const violations: Array<{
      import: string;
      reason: string;
      suggestion?: string;
    }> = [];

    const normalizedSource = this.toRelativePath(request.sourceFile);

    for (const importPath of request.imports) {
      for (const rule of this.config.imports || []) {
        if (matchesPattern(normalizedSource, rule.source)) {
          // 금지된 import 검사
          if (rule.forbid) {
            for (const forbidden of rule.forbid) {
              if (
                importPath === forbidden ||
                importPath.startsWith(`${forbidden}/`)
              ) {
                violations.push({
                  import: importPath,
                  reason: rule.reason || `'${importPath}' import 금지`,
                  suggestion: this.getImportSuggestion(importPath, normalizedSource),
                });
              }
            }
          }

          // 허용된 import만 검사 (allow가 정의된 경우)
          if (rule.allow && rule.allow.length > 0) {
            const isAllowed = rule.allow.some((allowed) =>
              matchesPattern(importPath, allowed)
            );
            if (!isAllowed) {
              violations.push({
                import: importPath,
                reason: `'${importPath}'는 허용되지 않은 import입니다`,
                suggestion: `허용된 패턴: ${rule.allow.join(", ")}`,
              });
            }
          }
        }
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
    };
  }

  /**
   * 프로젝트 구조 인덱싱
   */
  async indexProject(): Promise<ProjectStructure> {
    const folders = await this.scanFolders(this.rootDir, 0, 3);

    this.projectStructure = {
      rootDir: this.rootDir,
      folders,
      config: this.config,
      indexedAt: new Date().toISOString(),
    };

    return this.projectStructure;
  }

  /**
   * 프로젝트 구조 반환
   */
  async getProjectStructure(): Promise<ProjectStructure> {
    if (!this.projectStructure) {
      return this.indexProject();
    }
    return this.projectStructure;
  }

  /**
   * 코드에서 import 문 추출
   */
  private extractImports(content: string): string[] {
    const imports: string[] = [];

    // ES6 import
    const importRegex = /import\s+(?:.*\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // require
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  private toRelativePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    if (path.isAbsolute(normalized)) {
      return path.relative(this.rootDir, normalized).replace(/\\/g, "/");
    }
    return normalized;
  }

  /**
   * 폴더 스캔
   */
  private async scanFolders(
    dir: string,
    depth: number,
    maxDepth: number
  ): Promise<FolderInfo[]> {
    if (depth >= maxDepth) return [];

    const folders: FolderInfo[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === "node_modules" || entry.name === ".git") continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.rootDir, fullPath).replace(/\\/g, "/");

        // 폴더 설명 찾기
        let description: string | undefined;
        for (const [key, rule] of Object.entries(this.config.folders || {})) {
          const folderRule = typeof rule === "string" ? { pattern: key, description: rule } : rule;
          if (matchesPattern(relativePath + "/", folderRule.pattern)) {
            description = folderRule.description;
            break;
          }
        }

        // 파일 수 계산
        const files = entries.filter((e) => e.isFile());

        folders.push({
          path: relativePath,
          description,
          fileCount: files.length,
          children: await this.scanFolders(fullPath, depth + 1, maxDepth),
        });
      }
    } catch {
      // 권한 없는 폴더 무시
    }

    return folders;
  }

  /**
   * Import에 대한 템플릿 제안
   */
  private getImportSuggestion(importPath: string, sourceFile: string): string {
    if (importPath === "fs") {
      if (sourceFile.includes("apps/web")) {
        return "프론트엔드에서는 fetch API를 사용하세요";
      }
      return "Bun.file() 또는 Bun.write()를 사용하세요";
    }
    if (importPath === "child_process") {
      return "Bun.spawn() 또는 Bun.$를 사용하세요";
    }
    if (importPath === "path") {
      return "import.meta.dir 또는 Bun.pathToFileURL을 사용하세요";
    }
    return "다른 모듈을 사용하세요";
  }

  /**
   * 템플릿 기반 권장 경로
   */
  private getTemplateRecommendedPath(filePath: string): string | undefined {
    const normalized = filePath.replace(/\\/g, "/");
    const fileName = path.basename(normalized);

    if (fileName.endsWith(".slot.ts")) {
      return `spec/slots/${fileName}`;
    }
    if (fileName.endsWith(".contract.ts")) {
      return `spec/contracts/${fileName}`;
    }
    if (normalized.includes("generated/")) {
      return undefined; // generated는 이동 불가
    }

    return undefined;
  }

  /**
   * LLM 기반 제안
   */
  private async getLLMSuggestion(
    request: CheckLocationRequest,
    violations: ArchitectureViolation[]
  ): Promise<{ suggestion?: string; recommendedPath?: string }> {
    const brain = getBrain();

    const prompt = `Mandu Framework 아키텍처 분석:

파일: ${request.path}
위반 사항:
${violations.map((v) => `- ${v.message}`).join("\n")}

프로젝트 구조 규칙:
${JSON.stringify(this.config.folders, null, 2)}

질문:
1. 이 파일의 올바른 위치는 어디인가요?
2. 어떻게 수정해야 하나요?

짧고 명확하게 답변하세요 (3줄 이내).`;

    try {
      const result = await brain.complete([
        { role: "user", content: prompt },
      ]);

      // 응답에서 경로 추출 시도
      const pathMatch = result.content.match(/(?:spec\/|apps\/|packages\/)[^\s,)]+/);

      return {
        suggestion: result.content,
        recommendedPath: pathMatch?.[0],
      };
    } catch {
      return {};
    }
  }
}

/**
 * 글로벌 analyzer 인스턴스
 */
let globalAnalyzer: ArchitectureAnalyzer | null = null;

/**
 * Architecture Analyzer 초기화
 */
export function initializeArchitectureAnalyzer(
  rootDir: string,
  config?: Partial<ArchitectureConfig>
): ArchitectureAnalyzer {
  globalAnalyzer = new ArchitectureAnalyzer(rootDir, config);
  return globalAnalyzer;
}

/**
 * 글로벌 analyzer 반환
 */
export function getArchitectureAnalyzer(): ArchitectureAnalyzer | null {
  return globalAnalyzer;
}
