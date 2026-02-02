/**
 * Guard Presets
 *
 * 아키텍처 프리셋 모음
 */

import type { GuardPreset, PresetDefinition } from "../types";
import { fsdPreset, FSD_HIERARCHY } from "./fsd";
import { cleanPreset, CLEAN_HIERARCHY } from "./clean";
import { hexagonalPreset, HEXAGONAL_HIERARCHY } from "./hexagonal";
import { atomicPreset, ATOMIC_HIERARCHY } from "./atomic";

// Re-export
export { fsdPreset, FSD_HIERARCHY } from "./fsd";
export { cleanPreset, CLEAN_HIERARCHY } from "./clean";
export { hexagonalPreset, HEXAGONAL_HIERARCHY } from "./hexagonal";
export { atomicPreset, ATOMIC_HIERARCHY } from "./atomic";

/**
 * Mandu 권장 프리셋 (FSD + Clean 조합)
 *
 * 풀스택 프로젝트에 최적화
 */
export const manduPreset: PresetDefinition = {
  name: "mandu",
  description: "Mandu 권장 아키텍처 - FSD + Clean Architecture 조합",

  hierarchy: [
    // Frontend (FSD)
    "app",
    "pages",
    "widgets",
    "features",
    "entities",
    // Backend (Clean)
    "api",
    "application",
    "domain",
    "infra",
    // Shared
    "core",
    "shared",
  ],

  layers: [
    // Frontend layers
    {
      name: "app",
      pattern: "src/app/**",
      canImport: ["pages", "widgets", "features", "entities", "shared"],
      description: "앱 진입점",
    },
    {
      name: "pages",
      pattern: "src/pages/**",
      canImport: ["widgets", "features", "entities", "shared"],
      description: "페이지 컴포넌트",
    },
    {
      name: "widgets",
      pattern: "src/widgets/**",
      canImport: ["features", "entities", "shared"],
      description: "독립적인 UI 블록",
    },
    {
      name: "features",
      pattern: "src/features/**",
      canImport: ["entities", "shared"],
      description: "비즈니스 기능",
    },
    {
      name: "entities",
      pattern: "src/entities/**",
      canImport: ["shared"],
      description: "비즈니스 엔티티",
    },
    // Backend layers
    {
      name: "api",
      pattern: "src/api/**",
      canImport: ["application", "domain", "core", "shared"],
      description: "API 라우트, 컨트롤러",
    },
    {
      name: "application",
      pattern: "src/application/**",
      canImport: ["domain", "core", "shared"],
      description: "유스케이스, 서비스",
    },
    {
      name: "domain",
      pattern: "src/domain/**",
      canImport: ["shared"],
      description: "도메인 모델",
    },
    {
      name: "infra",
      pattern: "src/infra/**",
      canImport: ["application", "domain", "core", "shared"],
      description: "인프라 구현",
    },
    // Shared layers
    {
      name: "core",
      pattern: "src/core/**",
      canImport: ["shared"],
      description: "핵심 공통 (auth, config)",
    },
    {
      name: "shared",
      pattern: "src/shared/**",
      canImport: [],
      description: "공유 유틸리티",
    },
  ],

  defaultSeverity: {
    layerViolation: "error",
    circularDependency: "warn",
    crossSliceDependency: "warn",
    deepNesting: "info",
  },
};

/**
 * 모든 프리셋 맵
 */
export const presets: Record<GuardPreset, PresetDefinition> = {
  fsd: fsdPreset,
  clean: cleanPreset,
  hexagonal: hexagonalPreset,
  atomic: atomicPreset,
  mandu: manduPreset,
};

/**
 * 프리셋 가져오기
 */
export function getPreset(name: GuardPreset): PresetDefinition {
  const preset = presets[name];
  if (!preset) {
    throw new Error(`Unknown guard preset: ${name}`);
  }
  return preset;
}

/**
 * 프리셋 목록 가져오기
 */
export function listPresets(): Array<{ name: GuardPreset; description: string }> {
  return Object.values(presets).map((p) => ({
    name: p.name,
    description: p.description,
  }));
}
