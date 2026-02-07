/**
 * Atomic Design Preset
 *
 * UI 컴포넌트 아키텍처
 *
 * @see https://bradfrost.com/blog/post/atomic-web-design/
 */

import type { PresetDefinition } from "../types";

/**
 * Atomic Design 레이어 계층 구조 (복잡 → 단순)
 */
export const ATOMIC_HIERARCHY = [
  "pages",
  "templates",
  "organisms",
  "molecules",
  "atoms",
] as const;

/**
 * Atomic Design 프리셋 정의
 */
export const atomicPreset: PresetDefinition = {
  name: "atomic",
  description: "Atomic Design - UI 컴포넌트 아키텍처",

  hierarchy: [...ATOMIC_HIERARCHY],

  layers: [
    {
      name: "pages",
      pattern: "src/components/pages/**",
      canImport: ["templates", "organisms", "molecules", "atoms"],
      description: "페이지 컴포넌트 (특정 콘텐츠가 있는 템플릿)",
    },
    {
      name: "templates",
      pattern: "src/components/templates/**",
      canImport: ["organisms", "molecules", "atoms"],
      description: "페이지 템플릿 (레이아웃 구조)",
    },
    {
      name: "organisms",
      pattern: "src/components/organisms/**",
      canImport: ["molecules", "atoms"],
      description: "복잡한 UI 블록 (Header, Footer, Form)",
    },
    {
      name: "molecules",
      pattern: "src/components/molecules/**",
      canImport: ["atoms"],
      description: "조합된 컴포넌트 (SearchInput, Card)",
    },
    {
      name: "atoms",
      pattern: "src/components/atoms/**",
      canImport: [],
      description: "기본 요소 (Button, Input, Text)",
    },
  ],

  defaultSeverity: {
    layerViolation: "error",
    circularDependency: "warn",
    crossSliceDependency: "info",
    deepNesting: "info",
  },
};
