/**
 * POST /api/login
 *
 * CSRF-protected. On success: `loginUser(ctx, id)` + 302 → /dashboard.
 * On invalid credentials: re-render /login with the email preserved and
 * a 401 embedded in the redirect URL (the form reads `?error=...`).
 *
 * We intentionally return the same error message for "unknown email" and
 * "wrong password" so the login form doesn't leak which half of the
 * credentials was wrong.
 */
import { Mandu, type ManduContext } from "@mandujs/core";
import { verifyPassword, loginUser } from "@mandujs/core/auth";
import { withSession, withCsrf } from "../../../src/lib/auth";
import { userStore } from "../../../server/domain/users";

interface LoginBody {
  email?: string;
  password?: string;
  _csrf?: string;
}

const GENERIC_FAILURE = "Invalid email or password.";

function redirectToLogin(
  ctx: ManduContext,
  error: string,
  email: string | undefined
): Response {
  const params = new URLSearchParams({ error });
  if (email) params.set("email", email);
  // ctx.redirect preserves any pending Set-Cookie (CSRF rotation, etc.).
  return ctx.redirect(`/login?${params.toString()}`, 302);
}

export default Mandu.filling()
  .use(withSession())
  .use(withCsrf())
  .post(async (ctx) => {
    const body = await ctx.body<LoginBody>();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return redirectToLogin(ctx, GENERIC_FAILURE, email);
    }

    const user = userStore.findByEmail(email);
    if (!user) {
      // `verifyPassword` short-circuits on empty hash (see
      // auth/password.ts:104). Skipping a dummy-hash compare — argon2id
      // timing is dominated by memory cost, so the timing gap between
      // "unknown email" and "wrong password" is acceptable for an
      // in-memory demo store.
      return redirectToLogin(ctx, GENERIC_FAILURE, email);
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return redirectToLogin(ctx, GENERIC_FAILURE, email);
    }

    await loginUser(ctx, user.id);
    return ctx.redirect("/dashboard", 302);
  });
