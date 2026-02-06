/**
 * Mandu Guard Suggestions
 *
 * 스마트 해결 제안 생성기
 */

import type { ViolationType, LayerDefinition, GuardPreset } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Documentation Links
// ═══════════════════════════════════════════════════════════════════════════

const DOCS: Record<GuardPreset | "default", Record<string, string>> = {
  fsd: {
    base: "https://feature-sliced.design/docs",
    layers: "https://feature-sliced.design/docs/reference/layers",
    slices: "https://feature-sliced.design/docs/reference/slices",
    segments: "https://feature-sliced.design/docs/reference/segments",
    publicApi: "https://feature-sliced.design/docs/reference/public-api",
    isolation: "https://feature-sliced.design/docs/reference/isolation",
  },
  clean: {
    base: "https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html",
    layers: "https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html",
    dependency: "https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html#the-dependency-rule",
  },
  hexagonal: {
    base: "https://alistair.cockburn.us/hexagonal-architecture/",
    ports: "https://alistair.cockburn.us/hexagonal-architecture/",
    adapters: "https://alistair.cockburn.us/hexagonal-architecture/",
  },
  atomic: {
    base: "https://bradfrost.com/blog/post/atomic-web-design/",
    atoms: "https://bradfrost.com/blog/post/atomic-web-design/#atoms",
    molecules: "https://bradfrost.com/blog/post/atomic-web-design/#molecules",
    organisms: "https://bradfrost.com/blog/post/atomic-web-design/#organisms",
  },
  cqrs: {
    base: "https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs",
    commands: "https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs#solution",
    queries: "https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs#solution",
    layers: "https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html",
  },
  mandu: {
    base: "https://github.com/mandujs/mandu/docs/guard",
    layers: "https://github.com/mandujs/mandu/docs/guard#layers",
  },
  default: {
    base: "https://github.com/mandujs/mandu/docs/guard",
  },
};

/**
 * 문서 링크 가져오기
 */
export function getDocumentationLink(
  preset: GuardPreset | undefined,
  topic: string = "layers"
): string {
  const presetDocs = preset ? DOCS[preset] : DOCS.default;
  return presetDocs[topic] ?? presetDocs.base ?? DOCS.default.base;
}

// ═══════════════════════════════════════════════════════════════════════════
// Smart Suggestions
// ═══════════════════════════════════════════════════════════════════════════

interface SuggestionContext {
  type: ViolationType;
  fromLayer: string;
  toLayer: string;
  importPath: string;
  allowedLayers: string[];
  layers: LayerDefinition[];
  preset?: GuardPreset;
  slice?: string;
}

/**
 * 스마트 제안 생성
 */
export function generateSmartSuggestions(context: SuggestionContext): string[] {
  const { type, fromLayer, toLayer, importPath, allowedLayers, layers, preset, slice } = context;
  const suggestions: string[] = [];

  switch (type) {
    case "layer-violation":
      suggestions.push(...generateLayerViolationSuggestions(context));
      break;

    case "circular-dependency":
      suggestions.push(...generateCircularDependencySuggestions(context));
      break;

    case "cross-slice":
      suggestions.push(...generateCrossSliceSuggestions(context));
      break;

    case "deep-nesting":
      suggestions.push(...generateDeepNestingSuggestions(context));
      break;
  }

  return suggestions;
}

/**
 * 레이어 위반 제안 생성
 */
function generateLayerViolationSuggestions(context: SuggestionContext): string[] {
  const { fromLayer, toLayer, importPath, allowedLayers, preset } = context;
  const suggestions: string[] = [];

  // 1. 구체적인 대안 제시
  const targetModule = extractModuleName(importPath);

  if (allowedLayers.includes("shared")) {
    suggestions.push(
      `🔧 FIX: \`${targetModule}\`를 \`@/shared\`로 이동하세요`,
      `   변경 전: import { ${targetModule} } from '${importPath}'`,
      `   변경 후: import { ${targetModule} } from '@/shared/${targetModule.toLowerCase()}'`
    );
  }

  // 2. Prop drilling 제안
  if (toLayer === "widgets" || toLayer === "features") {
    suggestions.push(
      `🔄 ALTERNATIVE: Props로 전달받는 방식을 사용하세요`,
      `   부모 컴포넌트에서 ${targetModule}를 import하고 props로 전달`
    );
  }

  // 3. 허용된 레이어에서 유사 기능 찾기 제안
  if (allowedLayers.length > 0) {
    suggestions.push(
      `✅ ALLOWED: 다음 레이어에서 import 가능합니다:`,
      ...allowedLayers.map((l) => `   • @/${l}/*`)
    );
  }

  // 4. Composition pattern 제안 (FSD 전용)
  if (preset === "fsd" && (fromLayer === "features" || fromLayer === "entities")) {
    suggestions.push(
      `📦 PATTERN: Composition을 사용하세요`,
      `   상위 레이어(pages/widgets)에서 조합하여 사용`
    );
  }

  return suggestions;
}

/**
 * 순환 의존 제안 생성
 */
function generateCircularDependencySuggestions(context: SuggestionContext): string[] {
  const { fromLayer, toLayer, importPath } = context;
  const suggestions: string[] = [];

  suggestions.push(
    `🔄 DETECTED: ${fromLayer} ⇄ ${toLayer} 순환 의존`,
    ``,
    `🔧 FIX OPTIONS:`,
    `   1. 공통 의존성을 shared 레이어로 추출`,
    `   2. 인터페이스/타입을 별도 파일로 분리`,
    `   3. Dependency Injection 패턴 적용`,
    ``,
    `📊 REFACTORING STEPS:`,
    `   Step 1: 순환의 원인이 되는 공통 코드 식별`,
    `   Step 2: 공통 코드를 @/shared로 이동`,
    `   Step 3: 양쪽에서 shared를 import하도록 변경`
  );

  return suggestions;
}

/**
 * Cross-slice 의존 제안 생성
 */
function generateCrossSliceSuggestions(context: SuggestionContext): string[] {
  const { fromLayer, importPath, slice } = context;
  const toSlice = extractSliceFromPath(importPath, fromLayer);
  const suggestions: string[] = [];

  suggestions.push(
    `🔀 DETECTED: ${fromLayer}/${slice} → ${fromLayer}/${toSlice} cross-slice import`,
    ``,
    `🔧 FIX OPTIONS:`,
    `   1. 공통 로직을 shared 세그먼트로 추출:`,
    `      @/${fromLayer}/${slice}/shared → @/shared/${fromLayer}-common`,
    ``,
    `   2. @x notation 사용 (명시적 cross-import):`,
    `      import { X } from '@/${fromLayer}/${toSlice}/@x/${slice}'`,
    ``,
    `   3. 상위 레이어에서 조합:`,
    `      widgets나 pages에서 두 slice를 조합`
  );

  return suggestions;
}

/**
 * 깊은 중첩 제안 생성
 */
function generateDeepNestingSuggestions(context: SuggestionContext): string[] {
  const { importPath } = context;
  const parts = importPath.replace(/^[@~]\//, "").split("/");
  const publicApiPath = parts.slice(0, 2).join("/");
  const suggestions: string[] = [];

  suggestions.push(
    `📁 DETECTED: 내부 구현 직접 import`,
    ``,
    `🔧 FIX:`,
    `   변경 전: import { X } from '${importPath}'`,
    `   변경 후: import { X } from '@/${publicApiPath}'`,
    ``,
    `📦 PUBLIC API:`,
    `   @/${publicApiPath}/index.ts에서 필요한 항목을 export하세요`,
    ``,
    `   // @/${publicApiPath}/index.ts`,
    `   export { X } from './internal/path';`
  );

  return suggestions;
}

// ═══════════════════════════════════════════════════════════════════════════
// Agent-Optimized Format
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 에이전트 최적화 포맷 생성
 *
 * AI Agent가 파싱하기 쉬운 구조화된 형식
 */
export interface AgentViolationFormat {
  /** 위반 식별자 */
  id: string;
  /** 심각도 */
  severity: "error" | "warn" | "info";
  /** 위치 정보 */
  location: {
    file: string;
    line: number;
    column: number;
  };
  /** 규칙 정보 */
  rule: {
    name: string;
    description: string;
    documentation: string;
  };
  /** 위반 상세 */
  violation: {
    type: ViolationType;
    fromLayer: string;
    toLayer: string;
    importStatement: string;
    importPath: string;
  };
  /** 수정 방법 */
  fix: {
    primary: string;
    alternatives: string[];
    codeChange?: {
      before: string;
      after: string;
    };
  };
  /** 허용된 import */
  allowed: string[];
}

/**
 * 에이전트 친화적 형식으로 변환
 */
export function toAgentFormat(
  violation: {
    type: ViolationType;
    filePath: string;
    line: number;
    column: number;
    importStatement: string;
    importPath: string;
    fromLayer: string;
    toLayer: string;
    ruleName: string;
    ruleDescription: string;
    severity: "error" | "warn" | "info";
    allowedLayers: string[];
    suggestions: string[];
  },
  preset?: GuardPreset
): AgentViolationFormat {
  const targetModule = extractModuleName(violation.importPath);

  return {
    id: `guard-${violation.type}-${violation.line}`,
    severity: violation.severity,
    location: {
      file: violation.filePath,
      line: violation.line,
      column: violation.column,
    },
    rule: {
      name: violation.ruleName,
      description: violation.ruleDescription,
      documentation: getDocumentationLink(preset, "layers"),
    },
    violation: {
      type: violation.type,
      fromLayer: violation.fromLayer,
      toLayer: violation.toLayer,
      importStatement: violation.importStatement,
      importPath: violation.importPath,
    },
    fix: {
      primary: violation.suggestions[0] ?? "수정 필요",
      alternatives: violation.suggestions.slice(1),
      codeChange: violation.allowedLayers.includes("shared")
        ? {
            before: violation.importStatement,
            after: `import { ${targetModule} } from '@/shared/${targetModule.toLowerCase()}'`,
          }
        : undefined,
    },
    allowed: violation.allowedLayers.map((l) => `@/${l}/*`),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Import 경로에서 모듈 이름 추출
 */
function extractModuleName(importPath: string): string {
  const parts = importPath.replace(/^[@~]\//, "").split("/");
  const lastPart = parts[parts.length - 1];
  // PascalCase로 변환
  return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
}

/**
 * 경로에서 슬라이스 추출
 */
function extractSliceFromPath(importPath: string, fromLayer?: string): string {
  const parts = importPath.replace(/^[@~]\//, "").split("/");
  if (fromLayer) {
    const layerParts = fromLayer.split("/");
    const matchesLayer = parts.slice(0, layerParts.length).join("/") === fromLayer;
    if (matchesLayer && parts.length > layerParts.length) {
      return parts[layerParts.length];
    }
  }
  return parts[1] ?? "unknown";
}
