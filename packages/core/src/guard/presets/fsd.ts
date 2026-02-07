/**
 * FSD (Feature-Sliced Design) Preset
 *
 * 프론트엔드 권장 아키텍처
 *
 * @see https://feature-sliced.design/
 */

import type { PresetDefinition } from "../types";

/**
 * FSD 레이어 계층 구조 (상위 → 하위)
 *
 * app → pages → widgets → features → entities → shared
 */
export const FSD_HIERARCHY = [
  "app",
  "pages",
  "widgets",
  "features",
  "entities",
  "shared",
] as const;

/**
 * FSD 프리셋 정의
 */
export const fsdPreset: PresetDefinition = {
  name: "fsd",
  description: "Feature-Sliced Design - 프론트엔드 권장 아키텍처",

  hierarchy: [...FSD_HIERARCHY],

  layers: [
    {
      name: "app",
      pattern: "src/app/**",
      canImport: ["pages", "widgets", "features", "entities", "shared"],
      description: "앱 진입점, 프로바이더, 글로벌 스타일",
    },
    {
      name: "pages",
      pattern: "src/pages/**",
      canImport: ["widgets", "features", "entities", "shared"],
      description: "페이지 컴포넌트, 라우팅",
    },
    {
      name: "widgets",
      pattern: "src/widgets/**",
      canImport: ["features", "entities", "shared"],
      description: "독립적인 UI 블록 (Header, Sidebar 등)",
    },
    {
      name: "features",
      pattern: "src/features/**",
      canImport: ["entities", "shared"],
      description: "비즈니스 기능 (로그인, 결제 등)",
    },
    {
      name: "entities",
      pattern: "src/entities/**",
      canImport: ["shared"],
      description: "비즈니스 엔티티 (User, Product 등)",
    },
    {
      name: "shared",
      pattern: "src/shared/**",
      canImport: [],
      description: "공유 유틸, UI 컴포넌트, 라이브러리",
    },
  ],

  defaultSeverity: {
    layerViolation: "error",
    circularDependency: "warn",
    crossSliceDependency: "warn",
    deepNesting: "info",
  },
};
