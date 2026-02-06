/**
 * CQRS Preset
 *
 * Command Query Responsibility Segregation 아키텍처
 * 쓰기 경로(Commands)와 읽기 경로(Queries)의 격리를 프레임워크 레벨에서 강제
 */

import type { PresetDefinition } from "../types";

/**
 * CQRS 레이어 계층 구조
 *
 * 의존성: 외부 → 내부 (domain이 핵심)
 * commands와 queries는 서로 격리됨
 */
export const CQRS_HIERARCHY = [
  "api",
  "infra",
  "application/commands",
  "application/queries",
  "application/dto",
  "application/mappers",
  "application/events",
  "domain",
  "core",
  "shared",
] as const;

/**
 * CQRS 프리셋 정의
 */
export const cqrsPreset: PresetDefinition = {
  name: "cqrs",
  description: "CQRS - Command/Query 분리 아키텍처",

  hierarchy: [...CQRS_HIERARCHY],

  layers: [
    {
      name: "api",
      pattern: "src/**/api/**",
      canImport: ["application/commands", "application/queries", "application/dto", "core", "shared"],
      description: "Controllers, Routes - Command/Query 디스패치",
    },
    {
      name: "infra",
      pattern: "src/**/infra/**",
      canImport: ["application/commands", "application/queries", "domain", "core", "shared"],
      description: "Repository 구현, 외부 서비스 어댑터",
    },
    {
      name: "application/commands",
      pattern: "src/**/application/commands/**",
      canImport: ["domain", "application/dto", "application/events", "core", "shared"],
      description: "Command Handlers - 쓰기 경로 (queries 접근 불가)",
    },
    {
      name: "application/queries",
      pattern: "src/**/application/queries/**",
      canImport: ["domain", "application/dto", "core", "shared"],
      description: "Query Handlers - 읽기 경로 (commands, events 접근 불가)",
    },
    {
      name: "application/dto",
      pattern: "src/**/application/dto/**",
      canImport: ["domain", "shared"],
      description: "Data Transfer Objects",
    },
    {
      name: "application/mappers",
      pattern: "src/**/application/mappers/**",
      canImport: ["domain", "application/dto", "shared"],
      description: "Domain ↔ DTO 변환기",
    },
    {
      name: "application/events",
      pattern: "src/**/application/events/**",
      canImport: ["domain", "shared"],
      description: "Domain Events, Integration Events",
    },
    {
      name: "domain",
      pattern: "src/**/domain/**",
      canImport: ["shared"],
      description: "Entities, Value Objects, Domain Services, Aggregates",
    },
    {
      name: "core",
      pattern: "src/core/**",
      canImport: ["shared"],
      description: "공통 핵심 (auth, config, errors, CQRS bus)",
    },
    {
      name: "shared",
      pattern: "src/shared/**",
      canImport: [],
      description: "공유 유틸리티, 타입, 인터페이스",
    },
  ],

  defaultSeverity: {
    layerViolation: "error",
    circularDependency: "error",
    crossSliceDependency: "warn",
    deepNesting: "info",
  },
};
