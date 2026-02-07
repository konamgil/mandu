/**
 * Decision Memory - 아키텍처 결정 기억 시스템
 *
 * 과거 아키텍처 결정을 저장하고 AI가 일관된 선택을 하도록 유도
 *
 * @module guard/decision-memory
 *
 * @example
 * ```typescript
 * import { getDecisions, saveDecision, searchDecisions } from "@mandujs/core/guard";
 *
 * // 태그로 결정 검색
 * const authDecisions = await searchDecisions(rootDir, ["auth", "security"]);
 *
 * // 새 결정 저장
 * await saveDecision(rootDir, {
 *   id: "ADR-004",
 *   title: "Use JWT for API Authentication",
 *   status: "accepted",
 *   tags: ["auth", "api", "security"],
 *   context: "API 인증 방식 결정 필요",
 *   decision: "JWT + Refresh Token 조합 사용",
 *   consequences: ["토큰 만료 관리 필요", "Redis 세션 저장소 필요"],
 * });
 * ```
 */

import { join, basename, extname } from "path";
import { mkdir, readdir, readFile, writeFile, stat } from "fs/promises";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ADR 상태
 */
export type DecisionStatus =
  | "proposed"   // 제안됨
  | "accepted"   // 승인됨
  | "deprecated" // 폐기됨
  | "superseded"; // 대체됨

/**
 * Architecture Decision Record (ADR)
 */
export interface ArchitectureDecision {
  /** 고유 ID (e.g., "ADR-001") */
  id: string;

  /** 제목 */
  title: string;

  /** 상태 */
  status: DecisionStatus;

  /** 날짜 */
  date: string;

  /** 태그 (검색용) */
  tags: string[];

  /** 컨텍스트: 왜 이 결정이 필요했는가 */
  context: string;

  /** 결정 내용 */
  decision: string;

  /** 결과 및 영향 */
  consequences: string[];

  /** 관련 결정 ID들 */
  relatedDecisions?: string[];

  /** 대체된 결정 ID (status가 superseded일 때) */
  supersededBy?: string;

  /** 추가 메타데이터 */
  metadata?: Record<string, unknown>;
}

/**
 * 결정 검색 결과
 */
export interface DecisionSearchResult {
  /** 검색된 결정들 */
  decisions: ArchitectureDecision[];

  /** 총 결정 수 */
  total: number;

  /** 검색 키워드 */
  searchTags: string[];
}

/**
 * 일관성 검사 결과
 */
export interface ConsistencyCheckResult {
  /** 일관성 여부 */
  consistent: boolean;

  /** 관련 결정들 */
  relatedDecisions: ArchitectureDecision[];

  /** 경고 메시지 */
  warnings: string[];

  /** 제안 사항 */
  suggestions: string[];
}

/**
 * 압축된 아키텍처 정보 (AI용)
 */
export interface CompactArchitecture {
  /** 프로젝트 이름 */
  project: string;

  /** 마지막 업데이트 */
  lastUpdated: string;

  /** 핵심 결정 요약 */
  keyDecisions: {
    id: string;
    title: string;
    tags: string[];
    summary: string;
  }[];

  /** 태그별 결정 수 */
  tagCounts: Record<string, number>;

  /** 레이어/모듈 규칙 요약 */
  rules: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const DECISIONS_DIR = "spec/decisions";
const ARCHITECTURE_FILE = "spec/architecture.json";
const ADR_TEMPLATE = `# {title}

**ID:** {id}
**Status:** {status}
**Date:** {date}
**Tags:** {tags}

## Context

{context}

## Decision

{decision}

## Consequences

{consequences}

## Related Decisions

{relatedDecisions}
`;

// ═══════════════════════════════════════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * spec/decisions 디렉토리 확인 및 생성
 */
async function ensureDecisionsDir(rootDir: string): Promise<string> {
  const decisionsPath = join(rootDir, DECISIONS_DIR);
  await mkdir(decisionsPath, { recursive: true });
  return decisionsPath;
}

/**
 * ADR 파일을 파싱하여 ArchitectureDecision으로 변환
 */
export function parseADRMarkdown(content: string, filename: string): ArchitectureDecision | null {
  try {
    // 제목 추출
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] || filename.replace(/\.md$/, "");

    // ID 추출
    const idMatch = content.match(/\*\*ID:\*\*\s*(.+)$/m);
    const id = idMatch?.[1]?.trim() || filename.replace(/\.md$/, "");

    // Status 추출
    const statusMatch = content.match(/\*\*Status:\*\*\s*(.+)$/m);
    const status = (statusMatch?.[1]?.trim().toLowerCase() || "proposed") as DecisionStatus;

    // Date 추출
    const dateMatch = content.match(/\*\*Date:\*\*\s*(.+)$/m);
    const date = dateMatch?.[1]?.trim() || new Date().toISOString().split("T")[0];

    // Tags 추출
    const tagsMatch = content.match(/\*\*Tags:\*\*\s*(.+)$/m);
    const tags = tagsMatch?.[1]
      ?.split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean) || [];

    // Context 섹션 추출
    const contextMatch = content.match(/## Context\s+([\s\S]*?)(?=##|$)/);
    const context = contextMatch?.[1]?.trim() || "";

    // Decision 섹션 추출
    const decisionMatch = content.match(/## Decision\s+([\s\S]*?)(?=##|$)/);
    const decision = decisionMatch?.[1]?.trim() || "";

    // Consequences 섹션 추출
    const consequencesMatch = content.match(/## Consequences\s+([\s\S]*?)(?=##|$)/);
    const consequencesText = consequencesMatch?.[1]?.trim() || "";
    const consequences = consequencesText
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);

    // Related Decisions 추출
    const relatedMatch = content.match(/## Related Decisions\s+([\s\S]*?)(?=##|$)/);
    const relatedText = relatedMatch?.[1]?.trim() || "";
    const relatedDecisions = relatedText
      .match(/ADR-\d+/g)
      ?.filter(Boolean) || [];

    return {
      id,
      title,
      status,
      date,
      tags,
      context,
      decision,
      consequences,
      relatedDecisions: relatedDecisions.length > 0 ? relatedDecisions : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * ArchitectureDecision을 Markdown으로 변환
 */
export function formatADRAsMarkdown(adr: ArchitectureDecision): string {
  const consequencesList = adr.consequences.map((c) => `- ${c}`).join("\n");
  const relatedList = adr.relatedDecisions?.length
    ? adr.relatedDecisions.map((r) => `- ${r}`).join("\n")
    : "None";

  return ADR_TEMPLATE
    .replace("{title}", adr.title)
    .replace("{id}", adr.id)
    .replace("{status}", adr.status)
    .replace("{date}", adr.date)
    .replace("{tags}", adr.tags.join(", "))
    .replace("{context}", adr.context)
    .replace("{decision}", adr.decision)
    .replace("{consequences}", consequencesList)
    .replace("{relatedDecisions}", relatedList);
}

/**
 * 모든 결정 불러오기
 */
export async function getAllDecisions(rootDir: string): Promise<ArchitectureDecision[]> {
  const decisionsPath = join(rootDir, DECISIONS_DIR);

  try {
    const files = await readdir(decisionsPath);
    const mdFiles = files.filter((f) => extname(f) === ".md");

    const decisions: ArchitectureDecision[] = [];

    for (const file of mdFiles) {
      const content = await readFile(join(decisionsPath, file), "utf-8");
      const parsed = parseADRMarkdown(content, file);
      if (parsed) {
        decisions.push(parsed);
      }
    }

    // ID 순서로 정렬
    return decisions.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    // 디렉토리가 없으면 빈 배열 반환
    return [];
  }
}

/**
 * ID로 결정 조회
 */
export async function getDecisionById(
  rootDir: string,
  id: string
): Promise<ArchitectureDecision | null> {
  const decisions = await getAllDecisions(rootDir);
  return decisions.find((d) => d.id === id) || null;
}

/**
 * 태그로 결정 검색
 */
export async function searchDecisions(
  rootDir: string,
  tags: string[]
): Promise<DecisionSearchResult> {
  const allDecisions = await getAllDecisions(rootDir);
  const normalizedTags = tags.map((t) => t.toLowerCase());

  // 활성 상태(accepted, proposed)인 결정만 필터
  const activeDecisions = allDecisions.filter(
    (d) => d.status === "accepted" || d.status === "proposed"
  );

  // 태그 매칭
  const matched = activeDecisions.filter((decision) =>
    normalizedTags.some((tag) =>
      decision.tags.some((dt) => dt.includes(tag) || tag.includes(dt))
    )
  );

  return {
    decisions: matched,
    total: matched.length,
    searchTags: tags,
  };
}

/**
 * 새 결정 저장
 */
export async function saveDecision(
  rootDir: string,
  decision: Omit<ArchitectureDecision, "date"> & { date?: string }
): Promise<{ success: boolean; filePath: string; message: string }> {
  const decisionsPath = await ensureDecisionsDir(rootDir);

  // 날짜 기본값 설정
  const fullDecision: ArchitectureDecision = {
    ...decision,
    date: decision.date || new Date().toISOString().split("T")[0],
  };

  // 파일명 생성 (ADR-001-title-slug.md)
  const slug = fullDecision.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const filename = `${fullDecision.id}-${slug}.md`;
  const filePath = join(decisionsPath, filename);

  // Markdown으로 변환 및 저장
  const markdown = formatADRAsMarkdown(fullDecision);
  await writeFile(filePath, markdown, "utf-8");

  // architecture.json 업데이트
  await updateCompactArchitecture(rootDir);

  return {
    success: true,
    filePath,
    message: `Decision ${fullDecision.id} saved successfully`,
  };
}

/**
 * 일관성 검사
 * 특정 작업이 기존 결정과 충돌하는지 확인
 */
export async function checkConsistency(
  rootDir: string,
  intent: string,
  proposedTags: string[]
): Promise<ConsistencyCheckResult> {
  const searchResult = await searchDecisions(rootDir, proposedTags);
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // 관련 결정 분석
  for (const decision of searchResult.decisions) {
    // Deprecated 결정 경고
    if (decision.status === "deprecated") {
      warnings.push(
        `⚠️ ${decision.id} is deprecated: ${decision.title}`
      );
    }

    // Superseded 결정 경고
    if (decision.status === "superseded" && decision.supersededBy) {
      warnings.push(
        `⚠️ ${decision.id} was superseded by ${decision.supersededBy}`
      );
      suggestions.push(
        `Check ${decision.supersededBy} for current guidelines`
      );
    }

    // 결정 내용 기반 제안
    if (decision.status === "accepted") {
      suggestions.push(
        `📋 ${decision.id}: ${decision.decision.slice(0, 100)}...`
      );
    }
  }

  return {
    consistent: warnings.length === 0,
    relatedDecisions: searchResult.decisions,
    warnings,
    suggestions,
  };
}

/**
 * 압축 아키텍처 정보 생성 (AI용)
 */
export async function generateCompactArchitecture(
  rootDir: string
): Promise<CompactArchitecture> {
  const decisions = await getAllDecisions(rootDir);

  // 태그별 카운트
  const tagCounts: Record<string, number> = {};
  decisions.forEach((d) => {
    d.tags.forEach((tag) => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  // 핵심 결정 (accepted만)
  const acceptedDecisions = decisions.filter((d) => d.status === "accepted");
  const keyDecisions = acceptedDecisions.map((d) => ({
    id: d.id,
    title: d.title,
    tags: d.tags,
    summary: d.decision.slice(0, 200),
  }));

  // 규칙 요약 추출 (결정에서 핵심 규칙 추출)
  const rules = acceptedDecisions
    .flatMap((d) => {
      const ruleMatches = d.decision.match(/(?:사용|금지|위치|필수|권장)[^.]*\./g);
      return ruleMatches || [];
    })
    .slice(0, 10);

  // 프로젝트 이름 추출 시도
  let projectName = "unknown";
  try {
    const packageJson = await readFile(join(rootDir, "package.json"), "utf-8");
    const pkg = JSON.parse(packageJson);
    projectName = pkg.name || "unknown";
  } catch {
    // ignore
  }

  return {
    project: projectName,
    lastUpdated: new Date().toISOString(),
    keyDecisions,
    tagCounts,
    rules,
  };
}

/**
 * architecture.json 업데이트
 */
export async function updateCompactArchitecture(rootDir: string): Promise<void> {
  const compact = await generateCompactArchitecture(rootDir);
  const archPath = join(rootDir, ARCHITECTURE_FILE);

  // spec 디렉토리 확인
  await mkdir(join(rootDir, "spec"), { recursive: true });

  await writeFile(archPath, JSON.stringify(compact, null, 2), "utf-8");
}

/**
 * architecture.json 읽기
 */
export async function getCompactArchitecture(
  rootDir: string
): Promise<CompactArchitecture | null> {
  const archPath = join(rootDir, ARCHITECTURE_FILE);

  try {
    const content = await readFile(archPath, "utf-8");
    return JSON.parse(content);
  } catch {
    // 파일이 없으면 생성 후 반환
    await updateCompactArchitecture(rootDir);
    return generateCompactArchitecture(rootDir);
  }
}

/**
 * 다음 ADR ID 생성
 */
export async function getNextDecisionId(rootDir: string): Promise<string> {
  const decisions = await getAllDecisions(rootDir);

  if (decisions.length === 0) {
    return "ADR-001";
  }

  // 가장 높은 ID 찾기
  const maxId = decisions.reduce((max, d) => {
    const num = parseInt(d.id.replace("ADR-", ""), 10) || 0;
    return Math.max(max, num);
  }, 0);

  return `ADR-${String(maxId + 1).padStart(3, "0")}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Export for index.ts
// ═══════════════════════════════════════════════════════════════════════════

export {
  DECISIONS_DIR,
  ARCHITECTURE_FILE,
};
