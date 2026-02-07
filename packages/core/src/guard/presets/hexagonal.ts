/**
 * Hexagonal Architecture Preset
 *
 * 포트와 어댑터 패턴
 */

import type { PresetDefinition } from "../types";

/**
 * Hexagonal Architecture 레이어 계층 구조
 */
export const HEXAGONAL_HIERARCHY = [
  "adapters/in",
  "adapters/out",
  "application",
  "ports",
  "domain",
] as const;

/**
 * Hexagonal Architecture 프리셋 정의
 */
export const hexagonalPreset: PresetDefinition = {
  name: "hexagonal",
  description: "Hexagonal Architecture - 포트와 어댑터 패턴",

  hierarchy: [...HEXAGONAL_HIERARCHY],

  layers: [
    {
      name: "adapters/in",
      pattern: "src/adapters/in/**",
      canImport: ["application", "ports"],
      description: "Driving Adapters (Controllers, CLI, GraphQL)",
    },
    {
      name: "adapters/out",
      pattern: "src/adapters/out/**",
      canImport: ["application", "ports"],
      description: "Driven Adapters (Repositories, External APIs)",
    },
    {
      name: "application",
      pattern: "src/application/**",
      canImport: ["domain", "ports"],
      description: "Use Cases, Application Services",
    },
    {
      name: "ports",
      pattern: "src/ports/**",
      canImport: ["domain"],
      description: "Port Interfaces (입출력 계약)",
    },
    {
      name: "domain",
      pattern: "src/domain/**",
      canImport: [],
      description: "Pure Business Logic (외부 의존 없음)",
    },
  ],

  defaultSeverity: {
    layerViolation: "error",
    circularDependency: "error",
    crossSliceDependency: "warn",
    deepNesting: "info",
  },
};
