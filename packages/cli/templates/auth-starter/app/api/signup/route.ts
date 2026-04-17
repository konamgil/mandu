/**
 * POST /api/signup
 *
 * Flow:
 *   1. session() + csrf() middleware — session is available, CSRF token validated
 *   2. parse email + password + confirmPassword from form body
 *   3. basic validation (non-empty, min length, passwords match)
 *   4. hash with argon2id (Bun.password default)
 *   5. create user in the in-memory store (throws on email collision)
 *   6. `loginUser(ctx, user.id)` — writes userId to session + commits Set-Cookie
 *   7. 302 → /dashboard
 *
 * On validation failure: 302 back to /signup with `?error=...&email=...`
 * so the form can re-render the error inline.
 */
import { Mandu } from "@mandujs/core";
import { hashPassword, loginUser } from "@mandujs/core/auth";
import { withSession, withCsrf } from "../../../src/lib/auth";
import { userStore, EmailTakenError } from "../../../server/domain/users";

interface SignupBody {
  email?: string;
  password?: string;
  confirmPassword?: string;
  _csrf?: string;
}

function redirectToSignup(
  ctx: import("@mandujs/core").ManduContext,
  error: string,
  email: string | undefined
): Response {
  const params = new URLSearchParams({ error });
  if (email) params.set("email", email);
  // Use ctx.redirect so any pending Set-Cookie (CSRF) lands on the response.
  return ctx.redirect(`/signup?${params.toString()}`, 302);
}

function isValidEmail(value: string): boolean {
  // Intentionally lenient — real validation is the user receiving mail,
  // which we don't do in this demo.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default Mandu.filling()
  .use(withSession())
  .use(withCsrf())
  .post(async (ctx) => {
    const body = await ctx.body<SignupBody>();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (!email || !isValidEmail(email)) {
      return redirectToSignup(ctx,"Please enter a valid email address.", email);
    }
    if (password.length < 8) {
      return redirectToSignup(ctx,"Password must be at least 8 characters.", email);
    }
    if (password !== confirmPassword) {
      return redirectToSignup(ctx,"Passwords do not match.", email);
    }

    let passwordHash: string;
    try {
      passwordHash = await hashPassword(password);
    } catch {
      return redirectToSignup(ctx,"Could not hash password. Try again.", email);
    }

    let user;
    try {
      user = userStore.create(email, passwordHash);
    } catch (err) {
      if (err instanceof EmailTakenError) {
        return redirectToSignup(ctx,"That email is already registered.", email);
      }
      throw err;
    }

    // Writes userId to session + calls saveSession() → Set-Cookie lands on the
    // redirect response automatically via ctx.redirect().
    await loginUser(ctx, user.id);

    return ctx.redirect("/dashboard", 302);
  });
