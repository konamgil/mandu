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
import { cqrsPreset, CQRS_HIERARCHY } from "./cqrs";

// Re-export types
export type { GuardPreset, PresetDefinition } from "../types";

// Re-export
export { fsdPreset, FSD_HIERARCHY } from "./fsd";
export { cleanPreset, CLEAN_HIERARCHY } from "./clean";
export { hexagonalPreset, HEXAGONAL_HIERARCHY } from "./hexagonal";
export { atomicPreset, ATOMIC_HIERARCHY } from "./atomic";
export { cqrsPreset, CQRS_HIERARCHY } from "./cqrs";

/**
 * Mandu 권장 프리셋 (FSD + Clean 조합)
 *
 * 풀스택 프로젝트에 최적화
 */
export const manduPreset: PresetDefinition = {
  name: "mandu",
  description: "Mandu 권장 아키텍처 - client/server 분리 + strict shared",

  hierarchy: [
    // Client (FSD)
    "client/app",
    "client/pages",
    "client/widgets",
    "client/features",
    "client/entities",
    "client/shared",
    // Shared (strict)
    "shared/contracts",
    "shared/types",
    "shared/utils/client",
    "shared/utils/server",
    "shared/schema",
    "shared/env",
    "shared/unsafe",
    // Server (Clean)
    "server/api",
    "server/application",
    "server/domain",
    "server/infra",
    "server/core",
  ],

  layers: [
    // Client layers
    {
      name: "client/app",
      pattern: "src/client/app/**",
      canImport: [
        "client/pages",
        "client/widgets",
        "client/features",
        "client/entities",
        "client/shared",
        "shared/contracts",
        "shared/types",
        "shared/utils/client",
      ],
      description: "클라이언트 앱 진입점",
    },
    {
      name: "client/pages",
      pattern: "src/client/pages/**",
      canImport: [
        "client/widgets",
        "client/features",
        "client/entities",
        "client/shared",
        "shared/contracts",
        "shared/types",
        "shared/utils/client",
      ],
      description: "클라이언트 페이지",
    },
    {
      name: "client/widgets",
      pattern: "src/client/widgets/**",
      canImport: [
        "client/features",
        "client/entities",
        "client/shared",
        "shared/contracts",
        "shared/types",
        "shared/utils/client",
      ],
      description: "클라이언트 위젯",
    },
    {
      name: "client/features",
      pattern: "src/client/features/**",
      canImport: [
        "client/entities",
        "client/shared",
        "shared/contracts",
        "shared/types",
        "shared/utils/client",
      ],
      description: "클라이언트 기능",
    },
    {
      name: "client/entities",
      pattern: "src/client/entities/**",
      canImport: [
        "client/shared",
        "shared/contracts",
        "shared/types",
        "shared/utils/client",
      ],
      description: "클라이언트 엔티티",
    },
    {
      name: "client/shared",
      pattern: "src/client/shared/**",
      canImport: [
        "shared/contracts",
        "shared/types",
        "shared/utils/client",
      ],
      description: "클라이언트 전용 공유",
    },
    // Shared layers
    {
      name: "shared/contracts",
      pattern: "src/shared/contracts/**",
      canImport: ["shared/types", "shared/utils/client"],
      description: "공용 계약 (클라이언트 safe)",
    },
    {
      name: "shared/schema",
      pattern: "src/shared/schema/**",
      canImport: ["shared/types", "shared/utils/server"],
      description: "서버 전용 스키마 (JSON/OpenAPI)",
    },
    {
      name: "shared/types",
      pattern: "src/shared/types/**",
      canImport: [],
      description: "공용 타입",
    },
    {
      name: "shared/utils/client",
      pattern: "src/shared/utils/client/**",
      canImport: ["shared/types"],
      description: "클라이언트 safe 유틸",
    },
    {
      name: "shared/utils/server",
      pattern: "src/shared/utils/server/**",
      canImport: ["shared/types", "shared/utils/client"],
      description: "서버 전용 유틸",
    },
    {
      name: "shared/env",
      pattern: "src/shared/env/**",
      canImport: ["shared/types", "shared/utils/client", "shared/utils/server"],
      description: "서버 전용 환경/설정",
    },
    {
      name: "shared/unsafe",
      pattern: "src/shared/**",
      canImport: [],
      description: "금지된 shared 경로",
    },
    // Server layers
    {
      name: "server/api",
      pattern: "src/server/api/**",
      canImport: [
        "server/application",
        "server/domain",
        "server/infra",
        "server/core",
        "shared/contracts",
        "shared/schema",
        "shared/types",
        "shared/utils/client",
        "shared/utils/server",
        "shared/env",
      ],
      description: "서버 API 라우트, 컨트롤러",
    },
    {
      name: "server/application",
      pattern: "src/server/application/**",
      canImport: [
        "server/domain",
        "server/core",
        "shared/contracts",
        "shared/schema",
        "shared/types",
        "shared/utils/client",
        "shared/utils/server",
        "shared/env",
      ],
      description: "서버 유스케이스, 서비스",
    },
    {
      name: "server/domain",
      pattern: "src/server/domain/**",
      canImport: [
        "shared/contracts",
        "shared/schema",
        "shared/types",
        "shared/utils/client",
        "shared/utils/server",
        "shared/env",
      ],
      description: "서버 도메인 모델",
    },
    {
      name: "server/infra",
      pattern: "src/server/infra/**",
      canImport: [
        "server/application",
        "server/domain",
        "server/core",
        "shared/contracts",
        "shared/schema",
        "shared/types",
        "shared/utils/client",
        "shared/utils/server",
        "shared/env",
      ],
      description: "서버 인프라 구현",
    },
    {
      name: "server/core",
      pattern: "src/server/core/**",
      canImport: [
        "shared/contracts",
        "shared/schema",
        "shared/types",
        "shared/utils/client",
        "shared/utils/server",
        "shared/env",
      ],
      description: "서버 핵심 공통",
    },
  ],

  defaultSeverity: {
    layerViolation: "error",
    circularDependency: "warn",
    crossSliceDependency: "warn",
    deepNesting: "info",
    fileType: "error",
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
  cqrs: cqrsPreset,
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
