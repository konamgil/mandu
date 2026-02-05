/**
 * DNA-004: Session Key Utilities
 *
 * 세션 키 기반 격리 시스템
 * - SSR 상태 격리 (팀별, 사용자별)
 * - 캐시 키 생성 (route + params + user)
 * - WebSocket 채널 격리 (향후)
 */

/**
 * 세션 스코프
 */
export type SessionScope =
  | "global"   // 전역 (모든 사용자 공유)
  | "team"     // 팀별 격리
  | "user"     // 사용자별 격리
  | "request"; // 요청별 격리 (캐시 없음)

/**
 * 세션 키 빌더 옵션
 */
export interface SessionKeyOptions {
  /** 라우트 ID 또는 경로 */
  route: string;

  /** 팀 ID (team/user 스코프에서 사용) */
  teamId?: string;

  /** 사용자 ID (user 스코프에서 사용) */
  userId?: string;

  /** 세션 스코프 */
  scope: SessionScope;

  /** 추가 파라미터 (쿼리 파라미터 등) */
  params?: Record<string, string>;

  /** 네임스페이스 (기본: "session") */
  namespace?: string;
}

/**
 * 캐시 키 빌더 옵션
 */
export interface CacheKeyOptions {
  /** 캐시 타입 (예: "ssr", "api", "data") */
  type: string;

  /** 리소스 식별자 */
  resource: string;

  /** 버전 또는 태그 */
  version?: string;

  /** 추가 파라미터 */
  params?: Record<string, string | number | boolean>;

  /** 사용자 ID (사용자별 캐시 시) */
  userId?: string;
}

/**
 * 문자열 정규화 (소문자, 특수문자 제거)
 */
function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 파라미터를 정렬된 문자열로 변환
 */
function serializeParams(params: Record<string, string | number | boolean>): string {
  const entries = Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return "";

  return entries
    .map(([k, v]) => `${normalize(k)}=${normalize(String(v))}`)
    .join("&");
}

/**
 * 세션 키 생성
 *
 * @example
 * ```ts
 * // 전역 세션
 * buildSessionKey({ route: "/dashboard", scope: "global" })
 * // → "session:/dashboard"
 *
 * // 팀별 세션
 * buildSessionKey({ route: "/projects", scope: "team", teamId: "team-123" })
 * // → "session:/projects:team:team-123"
 *
 * // 사용자별 세션
 * buildSessionKey({ route: "/profile", scope: "user", userId: "user-456" })
 * // → "session:/profile:user:user-456"
 *
 * // 파라미터 포함
 * buildSessionKey({
 *   route: "/search",
 *   scope: "user",
 *   userId: "user-456",
 *   params: { q: "mandu", page: "1" }
 * })
 * // → "session:/search:user:user-456:page=1&q=mandu"
 * ```
 */
export function buildSessionKey(options: SessionKeyOptions): string {
  const { route, teamId, userId, scope, params, namespace = "session" } = options;
  const parts: string[] = [namespace, normalize(route)];

  switch (scope) {
    case "team":
      if (teamId) {
        parts.push(`team:${normalize(teamId)}`);
      }
      break;

    case "user":
      if (userId) {
        parts.push(`user:${normalize(userId)}`);
      } else if (teamId) {
        // user 스코프에서 teamId만 있으면 팀 레벨로 폴백
        parts.push(`team:${normalize(teamId)}`);
      }
      break;

    case "request":
      // 요청별 고유 키 (타임스탬프 + 랜덤)
      parts.push(`req:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      break;

    case "global":
    default:
      // 추가 스코프 없음
      break;
  }

  // 파라미터 추가
  if (params && Object.keys(params).length > 0) {
    const serialized = serializeParams(params);
    if (serialized) {
      parts.push(serialized);
    }
  }

  return parts.join(":");
}

/**
 * 캐시 키 생성
 *
 * @example
 * ```ts
 * // SSR 캐시
 * buildCacheKey({ type: "ssr", resource: "/blog/123" })
 * // → "cache:ssr:/blog/123"
 *
 * // 버전 포함
 * buildCacheKey({ type: "api", resource: "users", version: "v2" })
 * // → "cache:api:users:v2"
 *
 * // 파라미터 포함
 * buildCacheKey({
 *   type: "data",
 *   resource: "products",
 *   params: { category: "food", limit: 10 }
 * })
 * // → "cache:data:products:category=food&limit=10"
 *
 * // 사용자별 캐시
 * buildCacheKey({
 *   type: "ssr",
 *   resource: "/dashboard",
 *   userId: "user-123"
 * })
 * // → "cache:ssr:/dashboard:user:user-123"
 * ```
 */
export function buildCacheKey(options: CacheKeyOptions): string {
  const { type, resource, version, params, userId } = options;
  const parts: string[] = ["cache", normalize(type), normalize(resource)];

  if (version) {
    parts.push(normalize(version));
  }

  if (userId) {
    parts.push(`user:${normalize(userId)}`);
  }

  if (params && Object.keys(params).length > 0) {
    const serialized = serializeParams(params);
    if (serialized) {
      parts.push(serialized);
    }
  }

  return parts.join(":");
}

/**
 * WebSocket 채널 키 생성
 *
 * @example
 * ```ts
 * buildChannelKey({ channel: "notifications", userId: "user-123" })
 * // → "ws:notifications:user:user-123"
 *
 * buildChannelKey({ channel: "team-chat", teamId: "team-456" })
 * // → "ws:team-chat:team:team-456"
 * ```
 */
export function buildChannelKey(options: {
  channel: string;
  userId?: string;
  teamId?: string;
}): string {
  const { channel, userId, teamId } = options;
  const parts: string[] = ["ws", normalize(channel)];

  if (userId) {
    parts.push(`user:${normalize(userId)}`);
  } else if (teamId) {
    parts.push(`team:${normalize(teamId)}`);
  }

  return parts.join(":");
}

/**
 * 세션 키 파싱
 *
 * @example
 * ```ts
 * parseSessionKey("session:/dashboard:team:team-123")
 * // → { namespace: "session", route: "/dashboard", scope: "team", teamId: "team-123" }
 * ```
 */
export function parseSessionKey(key: string): {
  namespace: string;
  route: string;
  scope: SessionScope;
  teamId?: string;
  userId?: string;
  params?: string;
} | null {
  const parts = key.split(":");

  if (parts.length < 2) return null;

  const [namespace, route, ...rest] = parts;
  let scope: SessionScope = "global";
  let teamId: string | undefined;
  let userId: string | undefined;
  let params: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const part = rest[i];

    if (part === "team" && rest[i + 1]) {
      scope = "team";
      teamId = rest[++i];
    } else if (part === "user" && rest[i + 1]) {
      scope = "user";
      userId = rest[++i];
    } else if (part.startsWith("req:")) {
      scope = "request";
    } else if (part.includes("=")) {
      params = part;
    }
  }

  return { namespace, route, scope, teamId, userId, params };
}

/**
 * 키 패턴 매칭 (와일드카드 지원)
 *
 * @example
 * ```ts
 * matchKeyPattern("session:/dashboard:*", "session:/dashboard:team:team-123")
 * // → true
 *
 * matchKeyPattern("cache:ssr:*", "cache:api:users")
 * // → false
 * ```
 */
export function matchKeyPattern(pattern: string, key: string): boolean {
  const patternParts = pattern.split(":");
  const keyParts = key.split(":");

  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];

    if (p === "*") {
      // 와일드카드는 나머지 모두 매칭
      return true;
    }

    if (p === "**") {
      // 더블 와일드카드는 0개 이상 매칭
      if (i === patternParts.length - 1) return true;

      // 나머지 패턴과 매칭되는 위치 찾기
      const remaining = patternParts.slice(i + 1);
      for (let j = i; j <= keyParts.length - remaining.length; j++) {
        if (matchKeyPattern(remaining.join(":"), keyParts.slice(j).join(":"))) {
          return true;
        }
      }
      return false;
    }

    if (keyParts[i] !== p) {
      return false;
    }
  }

  return patternParts.length === keyParts.length;
}
