/**
 * Signup page. Renders a form that POSTs to `/api/signup` with:
 *   - email, password, confirmPassword
 *   - `_csrf` hidden field containing the double-submit token
 *
 * The loader runs `attachAuthContext(ctx)` to ensure a CSRF cookie exists
 * and exposes the token to the view. The page exports `{ component, filling }`
 * as its default so the legacy page-loader path picks up both.
 */
import { Mandu } from "@mandujs/core";
import { attachAuthContext } from "../../src/lib/auth";

interface LoaderData {
  csrfToken: string;
  error?: string;
  email?: string;
}

function SignupPage({ loaderData }: { loaderData?: LoaderData }) {
  const csrfToken = loaderData?.csrfToken ?? "";
  const error = loaderData?.error;
  const email = loaderData?.email ?? "";

  return (
    <div>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        Create an account
      </h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "0.875rem", marginBottom: "1.75rem" }}>
        No email verification — this is a demo. Passwords are hashed with argon2id before storage.
      </p>

      {error ? (
        <div data-testid="signup-error" className="alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      ) : null}

      <form
        data-testid="signup-form"
        method="POST"
        action="/api/signup"
        className="card"
        style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}
      >
        <input type="hidden" name="_csrf" value={csrfToken} />

        <div>
          <label className="form-label" htmlFor="email">Email</label>
          <input
            className="input"
            type="email"
            id="email"
            name="email"
            defaultValue={email}
            required
            autoComplete="email"
            data-testid="signup-email"
          />
        </div>

        <div>
          <label className="form-label" htmlFor="password">Password</label>
          <input
            className="input"
            type="password"
            id="password"
            name="password"
            minLength={8}
            required
            autoComplete="new-password"
            data-testid="signup-password"
          />
        </div>

        <div>
          <label className="form-label" htmlFor="confirmPassword">Confirm password</label>
          <input
            className="input"
            type="password"
            id="confirmPassword"
            name="confirmPassword"
            minLength={8}
            required
            autoComplete="new-password"
            data-testid="signup-confirm"
          />
        </div>

        <button type="submit" className="btn-primary" style={{ alignSelf: "flex-start", marginTop: "0.25rem" }} data-testid="signup-submit">
          Create account
        </button>
      </form>

      <p style={{ marginTop: "1rem", fontSize: "0.875rem", color: "var(--ink-muted)" }}>
        Already have an account? <a href="/login" style={{ color: "var(--accent)" }}>Log in</a>
      </p>
    </div>
  );
}

export const filling = Mandu.filling<LoaderData>().loader(async (ctx) => {
  const { csrfToken } = await attachAuthContext(ctx);
  const error = ctx.query.error as string | undefined;
  const email = ctx.query.email as string | undefined;
  return { csrfToken, error, email };
});

export default SignupPage;
