/**
 * Clean Architecture Preset
 *
 * 백엔드 권장 아키텍처
 */

import type { PresetDefinition } from "../types";

/**
 * Clean Architecture 레이어 계층 구조
 *
 * 의존성: 외부 → 내부 (domain이 핵심)
 */
export const CLEAN_HIERARCHY = [
  "api",
  "infra",
  "application",
  "domain",
  "core",
  "shared",
] as const;

/**
 * Clean Architecture 프리셋 정의
 */
export const cleanPreset: PresetDefinition = {
  name: "clean",
  description: "Clean Architecture - 백엔드 권장 아키텍처",

  hierarchy: [...CLEAN_HIERARCHY],

  layers: [
    {
      name: "api",
      pattern: "src/**/api/**",
      canImport: ["application", "core", "shared"],
      description: "Controllers, Routes, DTOs",
    },
    {
      name: "infra",
      pattern: "src/**/infra/**",
      canImport: ["application", "domain", "core", "shared"],
      description: "Repositories 구현, 외부 API 클라이언트",
    },
    {
      name: "application",
      pattern: "src/**/application/**",
      canImport: ["domain", "core", "shared"],
      description: "Use Cases, Application Services",
    },
    {
      name: "domain",
      pattern: "src/**/domain/**",
      canImport: ["shared"],
      description: "Entities, Value Objects, Domain Services",
    },
    {
      name: "core",
      pattern: "src/core/**",
      canImport: ["shared"],
      description: "공통 핵심 (auth, config, errors)",
    },
    {
      name: "shared",
      pattern: "src/shared/**",
      canImport: [],
      description: "공유 유틸리티, 타입",
    },
  ],

  defaultSeverity: {
    layerViolation: "error",
    circularDependency: "error",
    crossSliceDependency: "warn",
    deepNesting: "info",
  },
};
