/**
 * Mandu Guard Analyzer
 *
 * 파일 분석 및 Import 추출
 */

import { readFile } from "fs/promises";
import { dirname, isAbsolute, relative, resolve } from "path";
import { minimatch } from "minimatch";
import type {
  ImportInfo,
  FileAnalysis,
  LayerDefinition,
  GuardConfig,
} from "./types";
import { WATCH_EXTENSIONS } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Import Extraction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Static import 패턴
 *
 * Examples:
 * - import { X } from 'module'
 * - import X from 'module'
 * - import * as X from 'module'
 * - import 'module'
 */
const STATIC_IMPORT_PATTERN = /^import\s+(?:(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*)\s+from\s+)?['"]([^'"]+)['"]/gm;

/**
 * Dynamic import 패턴
 *
 * Examples:
 * - import('module')
 * - await import('module')
 */
const DYNAMIC_IMPORT_PATTERN = /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/**
 * CommonJS require 패턴
 *
 * Examples:
 * - require('module')
 * - const X = require('module')
 */
const REQUIRE_PATTERN = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/**
 * Named import 추출 패턴
 */
const NAMED_IMPORT_PATTERN = /\{\s*([^}]+)\s*\}/;

/**
 * Default import 추출 패턴
 */
const DEFAULT_IMPORT_PATTERN = /^import\s+(\w+)/;

/**
 * 파일에서 import 문 추출
 */
export function extractImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = content.split("\n");

  // Static imports
  let match: RegExpExecArray | null;
  const staticPattern = new RegExp(STATIC_IMPORT_PATTERN.source, "gm");

  while ((match = staticPattern.exec(content)) !== null) {
    const statement = match[0];
    const path = match[1];
    const position = getLineAndColumn(content, match.index);

    // Named imports 추출
    const namedMatch = statement.match(NAMED_IMPORT_PATTERN);
    const namedImports = namedMatch
      ? namedMatch[1].split(",").map((s) => s.trim().split(" as ")[0].trim())
      : undefined;

    // Default import 추출
    const defaultMatch = statement.match(DEFAULT_IMPORT_PATTERN);
    const defaultImport =
      defaultMatch && !statement.includes("{") && !statement.includes("*")
        ? defaultMatch[1]
        : undefined;

    imports.push({
      statement,
      path,
      line: position.line,
      column: position.column,
      type: "static",
      namedImports,
      defaultImport,
    });
  }

  // Dynamic imports
  const dynamicPattern = new RegExp(DYNAMIC_IMPORT_PATTERN.source, "gm");

  while ((match = dynamicPattern.exec(content)) !== null) {
    const position = getLineAndColumn(content, match.index);

    imports.push({
      statement: match[0],
      path: match[1],
      line: position.line,
      column: position.column,
      type: "dynamic",
    });
  }

  // CommonJS requires
  const requirePattern = new RegExp(REQUIRE_PATTERN.source, "gm");

  while ((match = requirePattern.exec(content)) !== null) {
    const position = getLineAndColumn(content, match.index);

    imports.push({
      statement: match[0],
      path: match[1],
      line: position.line,
      column: position.column,
      type: "require",
    });
  }

  return imports;
}

/**
 * 인덱스에서 라인과 컬럼 위치 계산
 */
function getLineAndColumn(content: string, index: number): { line: number; column: number } {
  const lines = content.slice(0, index).split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer Resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 파일 경로에서 레이어 결정
 */
export function resolveFileLayer(
  filePath: string,
  layers: LayerDefinition[],
  rootDir: string
): string | null {
  const relativePath = relative(rootDir, filePath).replace(/\\/g, "/");

  for (const layer of layers) {
    if (minimatch(relativePath, layer.pattern)) {
      return layer.name;
    }
  }

  return null;
}

/**
 * Import 경로에서 타겟 레이어 결정
 */
export function resolveImportLayer(
  importPath: string,
  layers: LayerDefinition[],
  srcDir: string,
  fromFile?: string,
  rootDir?: string
): string | null {
  const normalizedImportPath = importPath.replace(/\\/g, "/");
  const normalizedSrcDir = srcDir.replace(/\\/g, "/").replace(/\/$/, "");

  const isAlias = normalizedImportPath.startsWith("@/") || normalizedImportPath.startsWith("~/");
  const isRelative = normalizedImportPath.startsWith(".");
  const isSrcAbsolute = normalizedSrcDir.length > 0 && normalizedSrcDir !== "." &&
    (normalizedImportPath === normalizedSrcDir || normalizedImportPath.startsWith(`${normalizedSrcDir}/`));

  // 상대/alias/src 경로가 아닌 경우 (node_modules 등)
  if (!isAlias && !isRelative && !isSrcAbsolute) {
    return null;
  }

  const candidates: string[] = [];

  if (isAlias) {
    const aliasPath = normalizedImportPath.slice(2);
    const withSrc = normalizedSrcDir.length > 0 ? `${normalizedSrcDir}/${aliasPath}` : aliasPath;
    candidates.push(withSrc, aliasPath);
  } else if (isSrcAbsolute) {
    const trimmed = normalizedSrcDir.length > 0 && normalizedImportPath.startsWith(`${normalizedSrcDir}/`)
      ? normalizedImportPath.slice(normalizedSrcDir.length + 1)
      : normalizedImportPath;
    candidates.push(normalizedImportPath, trimmed);
  } else if (isRelative) {
    if (!fromFile || !rootDir) {
      return null;
    }

    const absoluteFromFile = isAbsolute(fromFile) ? fromFile : resolve(rootDir, fromFile);
    const resolvedPath = resolve(dirname(absoluteFromFile), normalizedImportPath);
    const relativeToRoot = relative(rootDir, resolvedPath).replace(/\\/g, "/");

    // 루트 밖이면 무시
    if (relativeToRoot.startsWith("..") || relativeToRoot.startsWith("../")) {
      return null;
    }

    candidates.push(relativeToRoot);

    if (normalizedSrcDir.length > 0 && relativeToRoot.startsWith(`${normalizedSrcDir}/`)) {
      candidates.push(relativeToRoot.slice(normalizedSrcDir.length + 1));
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.replace(/\\/g, "/");

    for (const layer of layers) {
      if (minimatch(normalizedCandidate, layer.pattern)) {
        return layer.name;
      }
    }
  }

  return null;
}

/**
 * FSD 슬라이스 이름 추출
 */
export function extractSlice(filePath: string, layer: string): string | undefined {
  const relativePath = filePath.replace(/\\/g, "/");

  // layer/slice/... 형식에서 slice 추출
  const pattern = new RegExp(`${layer}/([^/]+)`);
  const match = relativePath.match(pattern);

  return match?.[1];
}

// ═══════════════════════════════════════════════════════════════════════════
// File Analysis
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 파일 분석
 */
export async function analyzeFile(
  filePath: string,
  layers: LayerDefinition[],
  rootDir: string
): Promise<FileAnalysis> {
  const content = await readFile(filePath, "utf-8");
  const imports = extractImports(content);
  const layer = resolveFileLayer(filePath, layers, rootDir);
  const slice = layer ? extractSlice(filePath, layer) : undefined;

  return {
    filePath,
    rootDir,
    layer,
    slice,
    imports,
    analyzedAt: Date.now(),
  };
}

/**
 * 파일이 분석 대상인지 확인
 */
export function shouldAnalyzeFile(
  filePath: string,
  config: GuardConfig,
  rootDir?: string
): boolean {
  const ext = filePath.slice(filePath.lastIndexOf("."));

  // 확장자 체크
  if (!WATCH_EXTENSIONS.includes(ext)) {
    return false;
  }

  // 제외 패턴 체크
  if (config.exclude) {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const candidates = new Set<string>([normalizedPath]);

    if (rootDir) {
      const relativeToRoot = relative(rootDir, filePath).replace(/\\/g, "/");
      candidates.add(relativeToRoot);

      const srcDir = (config.srcDir ?? "src").replace(/\\/g, "/").replace(/\/$/, "");
      if (srcDir && relativeToRoot.startsWith(`${srcDir}/`)) {
        candidates.add(relativeToRoot.slice(srcDir.length + 1));
      }
    }

    for (const pattern of config.exclude) {
      for (const candidate of candidates) {
        if (minimatch(candidate, pattern)) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Import가 무시 대상인지 확인
 */
export function shouldIgnoreImport(
  importPath: string,
  config: GuardConfig
): boolean {
  const normalizedImportPath = importPath.replace(/\\/g, "/");
  const srcDir = (config.srcDir ?? "src").replace(/\\/g, "/").replace(/\/$/, "");
  const isSrcAbsolute = srcDir.length > 0 && srcDir !== "." &&
    (normalizedImportPath === srcDir || normalizedImportPath.startsWith(`${srcDir}/`));

  // 외부 모듈 (node_modules)
  if (
    !normalizedImportPath.startsWith(".") &&
    !normalizedImportPath.startsWith("@/") &&
    !normalizedImportPath.startsWith("~/") &&
    !isSrcAbsolute
  ) {
    return true;
  }

  // 무시 패턴 체크
  if (config.ignoreImports) {
    for (const pattern of config.ignoreImports) {
      if (minimatch(normalizedImportPath, pattern)) {
        return true;
      }
    }
  }

  return false;
}
