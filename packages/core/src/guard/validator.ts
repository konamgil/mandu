/**
 * Mandu Guard Validator
 *
 * 아키텍처 규칙 검증
 */

import type {
  FileAnalysis,
  ImportInfo,
  LayerDefinition,
  Violation,
  ViolationType,
  Severity,
  SeverityConfig,
  GuardConfig,
} from "./types";
import { basename, dirname, isAbsolute, relative, resolve } from "path";
import { resolveImportLayer, shouldIgnoreImport } from "./analyzer";
import { generateSmartSuggestions } from "./suggestions";
import { FILE_PATTERNS } from "../router/fs-types";

// ═══════════════════════════════════════════════════════════════════════════
// Layer Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 레이어 의존성 검증
 */
export function validateLayerDependency(
  fromLayer: string,
  toLayer: string,
  layers: LayerDefinition[]
): boolean {
  const fromLayerDef = layers.find((l) => l.name === fromLayer);
  if (!fromLayerDef) return true; // 알 수 없는 레이어는 통과

  return fromLayerDef.canImport.includes(toLayer);
}

/**
 * 같은 레이어 내 같은 슬라이스인지 확인
 */
export function isSameSlice(
  fromSlice: string | undefined,
  toSlice: string | undefined
): boolean {
  if (!fromSlice || !toSlice) return false;
  return fromSlice === toSlice;
}

// ═══════════════════════════════════════════════════════════════════════════
// Violation Detection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 위반 생성
 */
export function createViolation(
  type: ViolationType,
  analysis: FileAnalysis,
  importInfo: ImportInfo,
  fromLayer: string,
  toLayer: string,
  layers: LayerDefinition[],
  severityConfig: SeverityConfig
): Violation {
  const fromLayerDef = layers.find((l) => l.name === fromLayer);
  const allowedLayers = fromLayerDef?.canImport ?? [];

  const severityMap: Record<ViolationType, keyof SeverityConfig> = {
    "layer-violation": "layerViolation",
    "circular-dependency": "circularDependency",
    "cross-slice": "crossSliceDependency",
    "deep-nesting": "deepNesting",
    "file-type": "fileType",
    "invalid-shared-segment": "invalidSharedSegment",
  };

  const severity: Severity = severityConfig[severityMap[type]] ?? "error";

  const ruleNames: Record<ViolationType, string> = {
    "layer-violation": "Layer Dependency",
    "circular-dependency": "Circular Dependency",
    "cross-slice": "Cross-Slice Dependency",
    "deep-nesting": "Deep Nesting",
    "file-type": "TypeScript Only",
    "invalid-shared-segment": "Shared Segment",
  };

  const ruleDescriptions: Record<ViolationType, string> = {
    "layer-violation": `"${fromLayer}" 레이어는 "${toLayer}" 레이어를 import할 수 없습니다`,
    "circular-dependency": `순환 의존성이 감지되었습니다: ${fromLayer} ⇄ ${toLayer}`,
    "cross-slice": `같은 레이어 내 다른 슬라이스 간 직접 import가 감지되었습니다`,
    "deep-nesting": `깊은 경로 import가 감지되었습니다. Public API를 통해 import하세요`,
    "file-type": `JS/JSX 파일은 금지됩니다. .ts/.tsx로 변환하세요`,
    "invalid-shared-segment": `shared 하위 세그먼트 규칙을 위반했습니다`,
  };

  // 스마트 제안 생성
  const suggestions = generateSmartSuggestions({
    type,
    fromLayer,
    toLayer,
    importPath: importInfo.path,
    allowedLayers,
    layers,
    slice: analysis.slice,
  });

  return {
    type,
    filePath: analysis.filePath,
    line: importInfo.line,
    column: importInfo.column,
    importStatement: importInfo.statement,
    importPath: importInfo.path,
    fromLayer,
    toLayer,
    ruleName: ruleNames[type],
    ruleDescription: ruleDescriptions[type],
    severity,
    allowedLayers,
    suggestions,
  };
}

function createFileTypeViolation(
  analysis: FileAnalysis,
  severityConfig: SeverityConfig
): Violation {
  const severity: Severity = severityConfig.fileType ?? "error";
  const normalizedPath = analysis.filePath.replace(/\\/g, "/");
  const extension = normalizedPath.slice(normalizedPath.lastIndexOf("."));

  return {
    type: "file-type",
    filePath: analysis.filePath,
    line: 1,
    column: 1,
    importStatement: normalizedPath,
    importPath: normalizedPath,
    fromLayer: "typescript",
    toLayer: extension,
    ruleName: "TypeScript Only",
    ruleDescription: `JS/JSX 파일은 금지됩니다 (${extension}). .ts/.tsx로 변환하세요`,
    severity,
    allowedLayers: [],
    suggestions: [
      "파일 확장자를 .ts 또는 .tsx로 변경하세요",
      "필요한 타입을 추가하고 TypeScript로 변환하세요",
    ],
  };
}

function createInvalidSharedSegmentViolation(
  analysis: FileAnalysis,
  severityConfig: SeverityConfig
): Violation {
  const severity: Severity = severityConfig.invalidSharedSegment ?? "error";
  const normalizedPath = analysis.filePath.replace(/\\/g, "/");
  const marker = "src/shared/";
  let segment = "(unknown)";

  const index = normalizedPath.indexOf(marker);
  if (index !== -1) {
    const rest = normalizedPath.slice(index + marker.length);
    segment = rest.split("/")[0] || "(root)";
  }

  return {
    type: "invalid-shared-segment",
    filePath: analysis.filePath,
    line: 1,
    column: 1,
    importStatement: normalizedPath,
    importPath: normalizedPath,
    fromLayer: "shared",
    toLayer: "shared/unsafe",
    ruleName: "Shared Segment",
    ruleDescription: `src/shared/${segment}는 허용되지 않습니다`,
    severity,
    allowedLayers: [],
    suggestions: [
      "허용 경로: src/shared/contracts|schema|types|utils/client|utils/server|env",
      "파일을 허용된 shared 하위 폴더로 이동하세요",
    ],
  };
}

function createSharedEnvImportViolation(
  analysis: FileAnalysis,
  importInfo: ImportInfo,
  fromLayer: string,
  allowedLayers: string[],
  severityConfig: SeverityConfig
): Violation {
  const severity: Severity = severityConfig.layerViolation ?? "error";

  return {
    type: "layer-violation",
    filePath: analysis.filePath,
    line: importInfo.line,
    column: importInfo.column,
    importStatement: importInfo.statement,
    importPath: importInfo.path,
    fromLayer,
    toLayer: "shared/env",
    ruleName: "Shared Env (Server-only)",
    ruleDescription: "shared/env는 서버 전용입니다. 클라이언트 레이어에서 import할 수 없습니다",
    severity,
    allowedLayers,
    suggestions: [
      "환경변수 접근은 src/server 또는 app/api/route.ts에서 처리하세요",
      "필요한 값은 서버에서 주입하거나 응답으로 전달하세요",
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// File Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 파일 분석 결과 검증
 */
export function validateFileAnalysis(
  analysis: FileAnalysis,
  layers: LayerDefinition[],
  config: GuardConfig
): Violation[] {
  const violations: Violation[] = [];
  const severityConfig = config.severity ?? {};
  const normalizedPath = analysis.filePath.toLowerCase();

  if (normalizedPath.endsWith(".js") || normalizedPath.endsWith(".jsx")) {
    violations.push(createFileTypeViolation(analysis, severityConfig));
  }

  if (analysis.layer === "shared/unsafe") {
    violations.push(createInvalidSharedSegmentViolation(analysis, severityConfig));
  }

  // FS Routes 규칙 검사 (app/ 내부)
  violations.push(...validateFsRoutesImports(analysis, layers, config));

  // 파일이 레이어에 속하지 않으면 검사 안 함
  if (!analysis.layer) {
    return violations;
  }

  const fromLayer = analysis.layer;
  const fromLayerDef = layers.find((l) => l.name === fromLayer);

  if (!fromLayerDef) {
    return violations;
  }

  for (const importInfo of analysis.imports) {
    const isFsRoutesImport = isFsRoutesImportPath(importInfo.path);
    if (shouldIgnoreImport(importInfo.path, config) && !isFsRoutesImport) {
      continue;
    }

    // Import 레이어 해석
    const toLayer = resolveImportLayer(
      importInfo.path,
      layers,
      config.srcDir ?? "src",
      analysis.filePath,
      analysis.rootDir
    );

    if (!toLayer) {
      continue; // 레이어를 알 수 없으면 무시
    }

    if (toLayer === "shared/env" && fromLayer.startsWith("client/")) {
      violations.push(
        createSharedEnvImportViolation(
          analysis,
          importInfo,
          fromLayer,
          fromLayerDef?.canImport ?? [],
          severityConfig
        )
      );
      continue;
    }

    // 같은 레이어 내 같은 슬라이스는 허용
    if (fromLayer === toLayer) {
      // Cross-slice 체크 (같은 레이어 내 다른 슬라이스)
      const toSlice = extractSliceFromImport(
        importInfo.path,
        toLayer,
        config.srcDir ?? "src",
        analysis.filePath,
        analysis.rootDir
      );
      if (analysis.slice && toSlice && analysis.slice !== toSlice) {
        violations.push(
          createViolation(
            "cross-slice",
            analysis,
            importInfo,
            fromLayer,
            toLayer,
            layers,
            severityConfig
          )
        );
      }
      continue;
    }

    // 레이어 의존성 검증
    if (!validateLayerDependency(fromLayer, toLayer, layers)) {
      violations.push(
        createViolation(
          "layer-violation",
          analysis,
          importInfo,
          fromLayer,
          toLayer,
          layers,
          severityConfig
        )
      );
    }
  }

  return violations;
}

/**
 * Import 경로에서 슬라이스 추출
 */
function extractSliceFromImport(
  importPath: string,
  layer: string,
  srcDir: string,
  fromFile?: string,
  rootDir?: string
): string | undefined {
  const normalizedImportPath = importPath.replace(/\\/g, "/");
  const normalizedSrcDir = srcDir.replace(/\\/g, "/").replace(/\/$/, "");

  let layerRelative: string | undefined;

  if (normalizedImportPath.startsWith("@/") || normalizedImportPath.startsWith("~/")) {
    layerRelative = normalizedImportPath.slice(2);
  } else if (
    normalizedSrcDir.length > 0 && normalizedSrcDir !== "." &&
    (normalizedImportPath === normalizedSrcDir || normalizedImportPath.startsWith(`${normalizedSrcDir}/`))
  ) {
    layerRelative = normalizedImportPath.startsWith(`${normalizedSrcDir}/`)
      ? normalizedImportPath.slice(normalizedSrcDir.length + 1)
      : normalizedImportPath;
  } else if (normalizedImportPath.startsWith(".")) {
    if (!fromFile || !rootDir) {
      return undefined;
    }

    const absoluteFromFile = isAbsolute(fromFile) ? fromFile : resolve(rootDir, fromFile);
    const resolvedPath = resolve(dirname(absoluteFromFile), normalizedImportPath);
    const relativeToRoot = relative(rootDir, resolvedPath).replace(/\\/g, "/");

    if (relativeToRoot.startsWith("..") || relativeToRoot.startsWith("../")) {
      return undefined;
    }

    layerRelative = normalizedSrcDir.length > 0 && normalizedSrcDir !== "." && relativeToRoot.startsWith(`${normalizedSrcDir}/`)
      ? relativeToRoot.slice(normalizedSrcDir.length + 1)
      : relativeToRoot;
  }

  if (!layerRelative) return undefined;

  const parts = layerRelative.split("/");
  const layerParts = layer.split("/");
  const matchesLayer = parts.slice(0, layerParts.length).join("/") === layer;
  if (matchesLayer && parts.length > layerParts.length) {
    return parts[layerParts.length];
  }

  return undefined;
}

/**
 * FS Routes 규칙 검증 (app/ 내부)
 */
function validateFsRoutesImports(
  analysis: FileAnalysis,
  layers: LayerDefinition[],
  config: GuardConfig
): Violation[] {
  const fsRoutesConfig = config.fsRoutes;
  if (!fsRoutesConfig) return [];

  const fileType = getFsRouteFileType(analysis);
  if (!fileType) return [];

  const violations: Violation[] = [];
  const severity = config.severity?.layerViolation ?? "error";
  const allowedLayers =
    fileType === "page"
      ? fsRoutesConfig.pageCanImport
      : fileType === "layout"
      ? fsRoutesConfig.layoutCanImport
      : fsRoutesConfig.routeCanImport;

  for (const importInfo of analysis.imports) {
    const isFsRoutesImport = isFsRoutesImportPath(importInfo.path);
    if (shouldIgnoreImport(importInfo.path, config) && !isFsRoutesImport) {
      continue;
    }

    // Rule: page -> page 금지
    if (fileType === "page" && fsRoutesConfig.noPageToPage) {
      if (resolvesToPageImport(importInfo.path, analysis)) {
        violations.push({
          type: "layer-violation",
          filePath: analysis.filePath,
          line: importInfo.line,
          column: importInfo.column,
          importStatement: importInfo.statement,
          importPath: importInfo.path,
          fromLayer: "page",
          toLayer: "page",
          ruleName: "FS Routes Page Import",
          ruleDescription: "page.tsx에서 다른 page.tsx import는 금지됩니다",
          severity,
          allowedLayers: allowedLayers ?? [],
          suggestions: [
            "공통 UI는 app/ 외부(shared/widgets)로 이동하세요",
            "필요한 데이터는 상위 layout에서 주입하세요",
          ],
        });
      }
    }

    // Rule: page/layout import 가능한 레이어 제한
    if (allowedLayers) {
      const toLayer = resolveImportLayer(
        importInfo.path,
        layers,
        config.srcDir ?? "src",
        analysis.filePath,
        analysis.rootDir
      );

      if (toLayer === "shared/env" && fileType !== "route") {
        violations.push(
          createSharedEnvImportViolation(
            analysis,
            importInfo,
            fileType,
            allowedLayers,
            config.severity ?? {}
          )
        );
        continue;
      }

      if (toLayer && !allowedLayers.includes(toLayer)) {
        const fileLabel = fileType === "route" ? "route.ts" : `${fileType}.tsx`;
        const suggestions =
          fileType === "route"
            ? [
                `허용 레이어: ${allowedLayers.join(", ")}`,
                "서버 로직은 src/server 또는 src/shared로 이동하세요",
              ]
            : [
                `허용 레이어: ${allowedLayers.join(", ")}`,
                "클라이언트 로직은 src/client 또는 src/shared로 이동하세요",
              ];

        violations.push({
          type: "layer-violation",
          filePath: analysis.filePath,
          line: importInfo.line,
          column: importInfo.column,
          importStatement: importInfo.statement,
          importPath: importInfo.path,
          fromLayer: fileType,
          toLayer,
          ruleName: "FS Routes Import Rule",
          ruleDescription: `${fileLabel}는 지정된 레이어만 import 가능합니다`,
          severity,
          allowedLayers,
          suggestions,
        });
      }
    }
  }

  return violations;
}

function getFsRouteFileType(analysis: FileAnalysis): "page" | "layout" | "route" | null {
  const normalizedPath = normalizePathValue(
    analysis.rootDir
      ? relative(
          analysis.rootDir,
          isAbsolute(analysis.filePath)
            ? analysis.filePath
            : resolve(analysis.rootDir, analysis.filePath)
        )
      : analysis.filePath
  );

  if (!isFsRoutesPath(normalizedPath)) {
    return null;
  }

  const fileName = basename(normalizedPath);
  if (FILE_PATTERNS.page.test(fileName)) {
    return "page";
  }
  if (FILE_PATTERNS.layout.test(fileName)) {
    return "layout";
  }
  if (FILE_PATTERNS.route.test(fileName)) {
    return "route";
  }

  return null;
}

function isFsRoutesPath(normalizedPath: string): boolean {
  const cleaned = normalizedPath.replace(/^\.\/+/, "");
  const segments = cleaned.split("/");
  if (segments.includes("src")) {
    return false;
  }
  return segments.includes("app");
}

function isFsRoutesImportPath(importPath: string): boolean {
  const normalized = importPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const segments = normalized.split("/");
  if (segments.includes("src")) {
    return false;
  }
  return segments.includes("app");
}

function resolvesToPageImport(importPath: string, analysis: FileAnalysis): boolean {
  const normalizedImport = importPath.replace(/\\/g, "/");
  const importFileName = basename(normalizedImport);

  if (FILE_PATTERNS.page.test(importFileName) || importFileName === "page") {
    if (!analysis.rootDir) {
      return isFsRoutesPath(normalizedImport);
    }
  }

  if (normalizedImport.startsWith(".")) {
    const resolvedPath = resolveFsRoutesPath(normalizedImport, analysis);
    if (!resolvedPath) return false;

    const resolvedFileName = basename(resolvedPath);
    return (
      isFsRoutesPath(resolvedPath) &&
      (FILE_PATTERNS.page.test(resolvedFileName) || resolvedFileName === "page")
    );
  }

  if (normalizedImport.startsWith("app/") || normalizedImport.includes("/app/")) {
    return FILE_PATTERNS.page.test(importFileName) || importFileName === "page";
  }

  if (normalizedImport.startsWith("@/") || normalizedImport.startsWith("~/")) {
    const aliasPath = normalizedImport.slice(2);
    const aliasFileName = basename(aliasPath);
    return (
      isFsRoutesPath(aliasPath) &&
      (FILE_PATTERNS.page.test(aliasFileName) || aliasFileName === "page")
    );
  }

  return false;
}

function resolveFsRoutesPath(importPath: string, analysis: FileAnalysis): string | null {
  if (!analysis.rootDir) return null;

  const absoluteFromFile = isAbsolute(analysis.filePath)
    ? analysis.filePath
    : resolve(analysis.rootDir, analysis.filePath);
  const resolvedPath = resolve(dirname(absoluteFromFile), importPath);
  const relativePath = normalizePathValue(relative(analysis.rootDir, resolvedPath));
  if (relativePath.startsWith("..")) {
    return null;
  }
  return relativePath;
}

// ═══════════════════════════════════════════════════════════════════════════
// Batch Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 여러 파일 분석 결과 검증
 */
export function validateAnalyses(
  analyses: FileAnalysis[],
  layers: LayerDefinition[],
  config: GuardConfig
): Violation[] {
  const allViolations: Violation[] = [];

  for (const analysis of analyses) {
    const violations = validateFileAnalysis(analysis, layers, config);
    allViolations.push(...violations);
  }

  return allViolations;
}

/**
 * 순환 의존성 감지
 */
export function detectCircularDependencies(
  analyses: FileAnalysis[],
  layers: LayerDefinition[],
  config: GuardConfig
): Violation[] {
  const violations: Violation[] = [];
  const lookup = buildFileLookup(analyses);
  const graph = buildDependencyGraph(analyses, config, lookup);
  const analysisByPath = new Map<string, FileAnalysis>();
  const seenPairs = new Set<string>();

  for (const analysis of analyses) {
    analysisByPath.set(normalizePathValue(analysis.filePath), analysis);
  }

  // 간단한 직접 순환 감지 (A → B → A)
  for (const [file, deps] of graph.entries()) {
    for (const dep of deps) {
      const depDeps = graph.get(dep);
      if (depDeps?.includes(file)) {
        const pairKey = [file, dep].sort().join("::");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        const analysis = analysisByPath.get(file);
        if (!analysis) continue;

        const importInfo = analysis.imports.find(
          (i) => resolveImportTarget(i.path, analysis, config, lookup) === dep
        );
        if (!importInfo) continue;

        const depAnalysis = analysisByPath.get(dep);
        const fromLayer = analysis.layer ?? "unknown";
        const toLayer =
          depAnalysis?.layer ??
          resolveImportLayer(
            importInfo.path,
            layers,
            config.srcDir ?? "src",
            analysis.filePath,
            analysis.rootDir
          ) ??
          "unknown";

        violations.push(
          createViolation(
            "circular-dependency",
            analysis,
            importInfo,
            fromLayer,
            toLayer,
            layers,
            config.severity ?? {}
          )
        );
      }
    }
  }

  return violations;
}

/**
 * 의존성 그래프 빌드
 */
function buildDependencyGraph(
  analyses: FileAnalysis[],
  config: GuardConfig,
  lookup: Map<string, string>
): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  for (const analysis of analyses) {
    const deps = new Set<string>();
    const fromPath = normalizePathValue(analysis.filePath);

    for (const imp of analysis.imports) {
      if (shouldIgnoreImport(imp.path, config)) {
        continue;
      }

      const resolved = resolveImportTarget(imp.path, analysis, config, lookup);
      if (resolved && resolved !== fromPath) {
        deps.add(resolved);
      }
    }

    graph.set(fromPath, Array.from(deps));
  }

  return graph;
}

function normalizePathValue(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function stripExtension(filePath: string): string {
  return filePath.replace(/\.[^/.]+$/, "");
}

function expandPathKeys(filePath: string): string[] {
  const normalized = normalizePathValue(filePath);
  const noExt = stripExtension(normalized);
  const keys = new Set<string>([normalized, noExt]);

  if (noExt.endsWith("/index")) {
    keys.add(noExt.slice(0, -"/index".length));
  }
  if (normalized.endsWith("/index")) {
    keys.add(normalized.slice(0, -"/index".length));
  }

  return Array.from(keys);
}

function buildFileLookup(analyses: FileAnalysis[]): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const analysis of analyses) {
    const canonical = normalizePathValue(analysis.filePath);

    for (const key of expandPathKeys(canonical)) {
      if (!lookup.has(key)) {
        lookup.set(key, canonical);
      }
    }

    if (analysis.rootDir) {
      const absolutePath = isAbsolute(analysis.filePath)
        ? analysis.filePath
        : resolve(analysis.rootDir, analysis.filePath);
      const absoluteNormalized = normalizePathValue(absolutePath);
      for (const key of expandPathKeys(absoluteNormalized)) {
        if (!lookup.has(key)) {
          lookup.set(key, canonical);
        }
      }

      const relativePath = normalizePathValue(relative(analysis.rootDir, absolutePath));
      for (const key of expandPathKeys(relativePath)) {
        if (!lookup.has(key)) {
          lookup.set(key, canonical);
        }
      }
    }
  }

  return lookup;
}

function resolveImportTarget(
  importPath: string,
  analysis: FileAnalysis,
  config: GuardConfig,
  lookup: Map<string, string>
): string | null {
  const normalizedImportPath = importPath.replace(/\\/g, "/");
  const srcDir = (config.srcDir ?? "src").replace(/\\/g, "/").replace(/\/$/, "");
  const candidates: string[] = [];

  if (normalizedImportPath.startsWith("@/") || normalizedImportPath.startsWith("~/")) {
    const aliasPath = normalizedImportPath.slice(2);
    const withSrc = srcDir.length > 0 ? `${srcDir}/${aliasPath}` : aliasPath;
    candidates.push(withSrc, aliasPath);

    if (analysis.rootDir) {
      candidates.push(normalizePathValue(resolve(analysis.rootDir, withSrc)));
    }
  } else if (normalizedImportPath.startsWith(".")) {
    if (!analysis.rootDir) return null;

    const absoluteFromFile = isAbsolute(analysis.filePath)
      ? analysis.filePath
      : resolve(analysis.rootDir, analysis.filePath);
    const resolvedPath = resolve(dirname(absoluteFromFile), normalizedImportPath);
    const normalizedResolved = normalizePathValue(resolvedPath);
    const relativeToRoot = normalizePathValue(relative(analysis.rootDir, resolvedPath));

    candidates.push(normalizedResolved);

    if (!relativeToRoot.startsWith("..")) {
      candidates.push(relativeToRoot);
      if (srcDir.length > 0 && srcDir !== "." && relativeToRoot.startsWith(`${srcDir}/`)) {
        candidates.push(relativeToRoot.slice(srcDir.length + 1));
      }
    }
  } else if (srcDir.length > 0 && srcDir !== "." &&
             (normalizedImportPath === srcDir || normalizedImportPath.startsWith(`${srcDir}/`))) {
    const trimmed = normalizedImportPath.startsWith(`${srcDir}/`)
      ? normalizedImportPath.slice(srcDir.length + 1)
      : normalizedImportPath;
    candidates.push(normalizedImportPath, trimmed);

    if (analysis.rootDir) {
      candidates.push(normalizePathValue(resolve(analysis.rootDir, normalizedImportPath)));
    }
  } else {
    return null;
  }

  for (const candidate of candidates) {
    for (const key of expandPathKeys(candidate)) {
      const resolved = lookup.get(key);
      if (resolved) return resolved;
    }
  }

  return null;
}
