/**
 * FS Routes Patterns
 *
 * 파일 경로 → URL 패턴 변환 유틸리티
 *
 * @module router/fs-patterns
 */

import type { RouteSegment, SegmentType, ScannedFileType } from "./fs-types";
import { SEGMENT_PATTERNS, FILE_PATTERNS } from "./fs-types";

// ═══════════════════════════════════════════════════════════════════════════
// Segment Parsing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 세그먼트 문자열을 파싱하여 RouteSegment 반환
 *
 * @example
 * parseSegment("blog") // { raw: "blog", type: "static" }
 * parseSegment("[slug]") // { raw: "[slug]", type: "dynamic", paramName: "slug" }
 * parseSegment("[...path]") // { raw: "[...path]", type: "catchAll", paramName: "path" }
 * parseSegment("(marketing)") // { raw: "(marketing)", type: "group" }
 */
export function parseSegment(segment: string): RouteSegment {
  // Optional catch-all: [[...param]]
  const optionalCatchAllMatch = segment.match(SEGMENT_PATTERNS.optionalCatchAll);
  if (optionalCatchAllMatch) {
    return {
      raw: segment,
      type: "optionalCatchAll",
      paramName: optionalCatchAllMatch[1],
    };
  }

  // Catch-all: [...param]
  const catchAllMatch = segment.match(SEGMENT_PATTERNS.catchAll);
  if (catchAllMatch) {
    return {
      raw: segment,
      type: "catchAll",
      paramName: catchAllMatch[1],
    };
  }

  // Dynamic: [param]
  const dynamicMatch = segment.match(SEGMENT_PATTERNS.dynamic);
  if (dynamicMatch) {
    return {
      raw: segment,
      type: "dynamic",
      paramName: dynamicMatch[1],
    };
  }

  // Group: (name)
  const groupMatch = segment.match(SEGMENT_PATTERNS.group);
  if (groupMatch) {
    return {
      raw: segment,
      type: "group",
    };
  }

  // Static segment
  return {
    raw: segment,
    type: "static",
  };
}

/**
 * 경로를 세그먼트 배열로 파싱
 *
 * @example
 * parseSegments("blog/[slug]/comments")
 * // [
 * //   { raw: "blog", type: "static" },
 * //   { raw: "[slug]", type: "dynamic", paramName: "slug" },
 * //   { raw: "comments", type: "static" }
 * // ]
 */
export function parseSegments(relativePath: string): RouteSegment[] {
  // Windows 경로 정규화
  const normalized = relativePath.replace(/\\/g, "/");

  // 경로에서 파일명 제거하고 디렉토리만 추출
  // 파일명 패턴: xxx.ext 또는 xxx.ext.ext (예: page.tsx, comments.island.tsx)
  const lastSlash = normalized.lastIndexOf("/");

  // 슬래시가 없으면 파일명만 있는 것 (루트)
  if (lastSlash === -1) {
    return [];
  }

  const pathWithoutFile = normalized.slice(0, lastSlash);

  if (!pathWithoutFile || pathWithoutFile === ".") {
    return [];
  }

  const parts = pathWithoutFile.split("/").filter(Boolean);
  return parts.map(parseSegment);
}

// ═══════════════════════════════════════════════════════════════════════════
// Pattern Conversion
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 세그먼트 배열을 URL 패턴으로 변환
 *
 * @example
 * segmentsToPattern([
 *   { raw: "blog", type: "static" },
 *   { raw: "[slug]", type: "dynamic", paramName: "slug" }
 * ])
 * // "/blog/:slug"
 */
export function segmentsToPattern(segments: RouteSegment[]): string {
  if (segments.length === 0) {
    return "/";
  }

  const parts = segments
    .filter((seg) => seg.type !== "group") // 그룹은 URL에 포함 안 됨
    .map((seg) => segmentToPatternPart(seg));

  return "/" + parts.join("/");
}

/**
 * 단일 세그먼트를 URL 패턴 부분으로 변환
 */
function segmentToPatternPart(segment: RouteSegment): string {
  switch (segment.type) {
    case "static":
      return segment.raw;

    case "dynamic":
      // [param] → :param
      return `:${segment.paramName}`;

    case "catchAll":
      // [...param] → :param* (Mandu 라우터 문법)
      return `:${segment.paramName}*`;

    case "optionalCatchAll":
      // [[...param]] → :param*? (optional catch-all)
      return `:${segment.paramName}*?`;

    case "group":
      // 그룹은 URL에 포함 안 됨
      return "";

    default:
      return segment.raw;
  }
}

/**
 * 파일 경로를 URL 패턴으로 변환
 *
 * @example
 * pathToPattern("blog/[slug]/page.tsx")
 * // "/blog/:slug"
 *
 * pathToPattern("(marketing)/pricing/page.tsx")
 * // "/pricing"
 */
export function pathToPattern(relativePath: string): string {
  const segments = parseSegments(relativePath);
  return segmentsToPattern(segments);
}

// ═══════════════════════════════════════════════════════════════════════════
// File Type Detection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 파일명으로 파일 타입 감지
 *
 * @example
 * detectFileType("page.tsx") // "page"
 * detectFileType("route.ts") // "route"
 * detectFileType("comments.island.tsx") // "island"
 */
export function detectFileType(filename: string, islandSuffix: string = ".island"): ScannedFileType | null {
  // Island 파일 먼저 체크 (*.island.tsx)
  const islandPattern = new RegExp(`\\${islandSuffix}\\.(tsx?|jsx?)$`);
  if (islandPattern.test(filename)) {
    return "island";
  }

  if (FILE_PATTERNS.page.test(filename)) return "page";
  if (FILE_PATTERNS.layout.test(filename)) return "layout";
  if (FILE_PATTERNS.route.test(filename)) return "route";
  if (FILE_PATTERNS.loading.test(filename)) return "loading";
  if (FILE_PATTERNS.error.test(filename)) return "error";
  if (FILE_PATTERNS.notFound.test(filename)) return "not-found";

  return null;
}

/**
 * 비공개 폴더인지 확인
 *
 * @example
 * isPrivateFolder("_components") // true
 * isPrivateFolder("components") // false
 */
export function isPrivateFolder(folderName: string): boolean {
  return SEGMENT_PATTERNS.private.test(folderName);
}

/**
 * 그룹 폴더인지 확인
 *
 * @example
 * isGroupFolder("(marketing)") // true
 * isGroupFolder("marketing") // false
 */
export function isGroupFolder(folderName: string): boolean {
  return SEGMENT_PATTERNS.group.test(folderName);
}

// ═══════════════════════════════════════════════════════════════════════════
// Route ID Generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 파일 경로에서 라우트 ID 생성
 *
 * @example
 * generateRouteId("blog/[slug]/page.tsx")
 * // "blog-$slug"
 *
 * generateRouteId("api/users/route.ts")
 * // "api-users"
 */
export function generateRouteId(relativePath: string): string {
  const segments = parseSegments(relativePath);

  const parts = segments
    .filter((seg) => seg.type !== "group")
    .map((seg) => {
      switch (seg.type) {
        case "dynamic":
          return `$${seg.paramName}`;
        case "catchAll":
        case "optionalCatchAll":
          return `$${seg.paramName}`;
        default:
          return seg.raw;
      }
    });

  if (parts.length === 0) {
    return "index";
  }

  return parts.join("-").toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════
// Priority Sorting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 세그먼트 타입별 우선순위 (낮을수록 높은 우선순위)
 */
const SEGMENT_PRIORITY: Record<SegmentType, number> = {
  static: 0,
  group: 1, // 그룹은 URL에 영향 없으므로 static과 동일
  dynamic: 2,
  catchAll: 3,
  optionalCatchAll: 4,
};

/**
 * 라우트 우선순위 계산
 *
 * 정적 라우트가 동적 라우트보다 높은 우선순위
 * 더 구체적인 라우트가 높은 우선순위
 *
 * @returns 낮을수록 높은 우선순위
 */
export function calculateRoutePriority(segments: RouteSegment[]): number {
  let priority = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // 깊이에 따른 가중치 적용
    priority += SEGMENT_PRIORITY[seg.type] * Math.pow(10, segments.length - i - 1);
  }

  return priority;
}

/**
 * 라우트 배열을 우선순위에 따라 정렬
 *
 * 정적 → 동적 → catch-all 순서
 */
export function sortRoutesByPriority<T extends { segments: RouteSegment[] }>(routes: T[]): T[] {
  return [...routes].sort((a, b) => {
    const priorityA = calculateRoutePriority(a.segments);
    const priorityB = calculateRoutePriority(b.segments);
    return priorityA - priorityB;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 세그먼트 유효성 검사
 */
export function validateSegments(segments: RouteSegment[]): { valid: boolean; error?: string } {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    // Catch-all은 마지막이어야 함
    if (seg.type === "catchAll" || seg.type === "optionalCatchAll") {
      if (i !== segments.length - 1) {
        return {
          valid: false,
          error: `Catch-all segment "${seg.raw}" must be the last segment`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * 패턴 충돌 확인
 *
 * 두 패턴이 동일한 URL을 매칭할 수 있는지 확인
 */
export function patternsConflict(patternA: string, patternB: string): boolean {
  const shapeA = normalizePatternShape(patternA);
  const shapeB = normalizePatternShape(patternB);

  return shapeA === shapeB;
}

/**
 * 패턴 형태 정규화 (파라미터 이름 무시)
 *
 * @example
 * /blog/:slug -> /blog/:PARAM
 * /docs/:path* -> /docs/*
 * /docs/:path*? -> /docs/*
 */
function normalizePatternShape(pattern: string): string {
  const normalized = pattern.replace(/\/$/, "") || "/";

  if (normalized === "/") return "/";

  const segments = normalized.split("/").filter(Boolean);
  const parts = segments.map((seg) => {
    if (seg === "*") return "*";

    if (seg.startsWith(":")) {
      const wildcardMatch = seg.match(/^:([^*?]+)\*(\?)?$/);
      if (wildcardMatch) {
        // optional 여부는 충돌 판단에서 동일하게 취급
        return "*";
      }
      return ":PARAM";
    }

    return seg;
  });

  return "/" + parts.join("/");
}
