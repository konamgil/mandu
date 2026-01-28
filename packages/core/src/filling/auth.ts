/**
 * Mandu Auth Guards - 인증/인가 헬퍼 🔐
 *
 * Guard에서 사용할 수 있는 타입-안전 인증 헬퍼
 * 인증 실패 시 적절한 에러를 throw하여 Guard 체인 중단
 */

import type { ManduContext } from "./context";

/**
 * 인증 실패 에러 (401 Unauthorized)
 */
export class AuthenticationError extends Error {
  readonly statusCode = 401;

  constructor(message: string = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * 인가 실패 에러 (403 Forbidden)
 */
export class AuthorizationError extends Error {
  readonly statusCode = 403;
  readonly requiredRoles?: string[];

  constructor(message: string = "Access denied", requiredRoles?: string[]) {
    super(message);
    this.name = "AuthorizationError";
    this.requiredRoles = requiredRoles;
  }
}

/**
 * 기본 User 인터페이스
 * 프로젝트에서 확장하여 사용
 */
export interface BaseUser {
  id: string;
  [key: string]: unknown;
}

/**
 * Role을 가진 User 인터페이스
 */
export interface UserWithRole extends BaseUser {
  role: string;
}

/**
 * Roles 배열을 가진 User 인터페이스
 */
export interface UserWithRoles extends BaseUser {
  roles: string[];
}

// ============================================
// 🔐 Auth Guard Helpers
// ============================================

/**
 * 인증된 사용자 필수
 * Guard에서 user가 없으면 AuthenticationError throw
 *
 * @param ctx ManduContext
 * @param key store에서 user를 찾을 키 (기본: 'user')
 * @returns 인증된 User (타입 확정)
 * @throws AuthenticationError
 *
 * @example
 * ```typescript
 * import { requireUser } from '@mandujs/core'
 *
 * export default Mandu.filling()
 *   .guard(async (ctx) => {
 *     // JWT 토큰 검증 후 user 저장
 *     const user = await verifyToken(ctx.headers.get('Authorization'));
 *     ctx.set('user', user);
 *     return ctx.next();
 *   })
 *   .get((ctx) => {
 *     const user = requireUser(ctx);  // User 타입 확정, 없으면 401
 *     return ctx.ok({ message: `Hello, ${user.id}!` });
 *   })
 * ```
 */
export function requireUser<T extends BaseUser = BaseUser>(
  ctx: ManduContext,
  key: string = "user"
): T {
  const user = ctx.get<T>(key);

  if (!user) {
    throw new AuthenticationError("User context is required");
  }

  if (typeof user !== "object" || !("id" in user)) {
    throw new AuthenticationError("Invalid user context");
  }

  return user;
}

/**
 * 특정 역할 필수 (단일 role 필드)
 *
 * @param ctx ManduContext
 * @param roles 허용된 역할 목록
 * @param key store에서 user를 찾을 키 (기본: 'user')
 * @returns 인증된 User (타입 확정)
 * @throws AuthenticationError (user 없음)
 * @throws AuthorizationError (역할 불일치)
 *
 * @example
 * ```typescript
 * .guard((ctx) => {
 *   requireRole(ctx, 'admin', 'moderator');  // admin 또는 moderator만 허용
 *   return ctx.next();
 * })
 * ```
 */
export function requireRole<T extends UserWithRole = UserWithRole>(
  ctx: ManduContext,
  ...roles: string[]
): T {
  const user = requireUser<T>(ctx);

  if (!("role" in user) || typeof user.role !== "string") {
    throw new AuthorizationError("User has no role defined");
  }

  if (!roles.includes(user.role)) {
    throw new AuthorizationError(
      `Required role: ${roles.join(" or ")}`,
      roles
    );
  }

  return user;
}

/**
 * 특정 역할 중 하나 필수 (roles 배열 필드)
 *
 * @param ctx ManduContext
 * @param roles 허용된 역할 목록 (하나라도 있으면 통과)
 * @param key store에서 user를 찾을 키 (기본: 'user')
 * @returns 인증된 User (타입 확정)
 * @throws AuthenticationError (user 없음)
 * @throws AuthorizationError (역할 불일치)
 *
 * @example
 * ```typescript
 * .guard((ctx) => {
 *   requireAnyRole(ctx, 'editor', 'admin');  // editor 또는 admin 역할 필요
 *   return ctx.next();
 * })
 * ```
 */
export function requireAnyRole<T extends UserWithRoles = UserWithRoles>(
  ctx: ManduContext,
  ...roles: string[]
): T {
  const user = requireUser<T>(ctx);

  if (!("roles" in user) || !Array.isArray(user.roles)) {
    throw new AuthorizationError("User has no roles defined");
  }

  const hasRole = roles.some((role) => user.roles.includes(role));

  if (!hasRole) {
    throw new AuthorizationError(
      `Required one of roles: ${roles.join(", ")}`,
      roles
    );
  }

  return user;
}

/**
 * 모든 역할 필수 (roles 배열 필드)
 *
 * @param ctx ManduContext
 * @param roles 필요한 역할 목록 (모두 있어야 통과)
 * @returns 인증된 User (타입 확정)
 * @throws AuthenticationError (user 없음)
 * @throws AuthorizationError (역할 불일치)
 *
 * @example
 * ```typescript
 * .guard((ctx) => {
 *   requireAllRoles(ctx, 'verified', 'premium');  // verified AND premium 필요
 *   return ctx.next();
 * })
 * ```
 */
export function requireAllRoles<T extends UserWithRoles = UserWithRoles>(
  ctx: ManduContext,
  ...roles: string[]
): T {
  const user = requireUser<T>(ctx);

  if (!("roles" in user) || !Array.isArray(user.roles)) {
    throw new AuthorizationError("User has no roles defined");
  }

  const missingRoles = roles.filter((role) => !user.roles.includes(role));

  if (missingRoles.length > 0) {
    throw new AuthorizationError(
      `Missing required roles: ${missingRoles.join(", ")}`,
      roles
    );
  }

  return user;
}

// ============================================
// 🔐 Auth Guard Factory
// ============================================

/**
 * 인증 Guard 생성 팩토리
 * 반복되는 인증 로직을 Guard로 변환
 *
 * @example
 * ```typescript
 * const authGuard = createAuthGuard(async (ctx) => {
 *   const token = ctx.headers.get('Authorization')?.replace('Bearer ', '');
 *   if (!token) return null;
 *   return await verifyJwt(token);
 * });
 *
 * export default Mandu.filling()
 *   .guard(authGuard)
 *   .get((ctx) => {
 *     const user = requireUser(ctx);
 *     return ctx.ok({ user });
 *   })
 * ```
 */
export function createAuthGuard<T extends BaseUser>(
  authenticator: (ctx: ManduContext) => T | null | Promise<T | null>,
  options: {
    key?: string;
    onUnauthenticated?: (ctx: ManduContext) => Response;
  } = {}
) {
  const { key = "user", onUnauthenticated } = options;

  return async (ctx: ManduContext): Promise<symbol | Response> => {
    try {
      const user = await authenticator(ctx);

      if (user) {
        ctx.set(key, user);
        return ctx.next();
      }

      if (onUnauthenticated) {
        return onUnauthenticated(ctx);
      }

      return ctx.unauthorized("Authentication required");
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return ctx.unauthorized(error.message);
      }
      throw error;
    }
  };
}

/**
 * 역할 기반 Guard 생성 팩토리
 *
 * @example
 * ```typescript
 * const adminOnly = createRoleGuard('admin');
 * const editorOrAdmin = createRoleGuard('editor', 'admin');
 *
 * export default Mandu.filling()
 *   .guard(authGuard)
 *   .guard(adminOnly)  // admin만 접근 가능
 *   .delete((ctx) => ctx.noContent())
 * ```
 */
export function createRoleGuard(...allowedRoles: string[]) {
  return (ctx: ManduContext): symbol | Response => {
    try {
      requireRole(ctx, ...allowedRoles);
      return ctx.next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return ctx.unauthorized(error.message);
      }
      if (error instanceof AuthorizationError) {
        return ctx.forbidden(error.message);
      }
      throw error;
    }
  };
}
