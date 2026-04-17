import type { ManduConfig } from "@mandujs/core";

/**
 * Mandu Auth Starter — demonstrates Phase 2 modules:
 *   - session() middleware (cookie-backed sessions)
 *   - csrf() middleware (double-submit cookie pattern)
 *   - hashPassword / verifyPassword (Bun.password argon2id)
 *   - loginUser / logoutUser / currentUserId (session bridge helpers)
 *
 * Middleware is wired per-route inside `src/lib/auth.ts`: session + csrf
 * installation lives there because Mandu composes middleware on the filling
 * chain (`.use(...)`), not at the manifest level. See README for rationale.
 */
export default {
  server: {
    port: 3333,
  },
} satisfies ManduConfig;
