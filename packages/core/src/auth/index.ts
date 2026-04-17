/**
 * @mandujs/core/auth — Unified auth barrel.
 *
 * One import surface for everything auth-related in Mandu:
 *   - Password hashing (argon2id / bcrypt) from `./password`
 *   - Session-backed login helpers from `./login`
 *   - Error classes and guards from `../filling/auth`
 *
 * @example
 * ```ts
 * import {
 *   hashPassword,
 *   verifyPassword,
 *   loginUser,
 *   logoutUser,
 *   currentUserId,
 *   requireUser,
 *   AuthenticationError,
 * } from "@mandujs/core/auth";
 * ```
 *
 * Fine-grained subpath imports remain available for tree-shaking-sensitive
 * bundles:
 *   - `@mandujs/core/auth/password`
 *   - `@mandujs/core/auth/login`
 *
 * @module auth
 */

// ── Password hashing (Phase 2.1) ──
export {
  hashPassword,
  verifyPassword,
  type PasswordOptions,
} from "./password";

// ── Login / logout / read helpers (Phase 2.4) ──
export {
  loginUser,
  logoutUser,
  currentUserId,
  loggedAt,
  type LoginOptions,
} from "./login";

// ── Email verification (Phase 5.3) ──
// The underlying token store (./tokens) is deliberately NOT re-exported —
// it's the shared plumbing for verification + reset, not a public primitive.
export {
  createEmailVerification,
  type VerificationFlow,
  type VerificationFlowOptions,
} from "./verification";

// ── Password reset (Phase 5.3) ──
export {
  createPasswordReset,
  type ResetFlow,
  type ResetFlowOptions,
} from "./reset";

// ── Error classes, guards, and user types (re-exported from filling/auth) ──
// We DO NOT re-export the factory functions (`createAuthGuard`, `createRoleGuard`)
// here — those are broader "beforeHandle" plumbing that lives on the filling
// surface. Users who need them still import from `@mandujs/core` directly.
export {
  AuthenticationError,
  AuthorizationError,
  requireUser,
  requireRole,
  requireAnyRole,
  requireAllRoles,
  type BaseUser,
  type UserWithRole,
  type UserWithRoles,
} from "../filling/auth";
