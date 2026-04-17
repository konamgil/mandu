/**
 * Login page. Submits credentials to `/api/login` with CSRF protection.
 * Loader provides `{ csrfToken, error, email }` via `attachAuthContext`.
 */
import { Mandu } from "@mandujs/core";
import { attachAuthContext } from "../../src/lib/auth";

interface LoaderData {
  csrfToken: string;
  error?: string;
  email?: string;
}

function LoginPage({ loaderData }: { loaderData?: LoaderData }) {
  const csrfToken = loaderData?.csrfToken ?? "";
  const error = loaderData?.error;
  const email = loaderData?.email ?? "";

  return (
    <div>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.5rem" }}>Log in</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "0.875rem", marginBottom: "1.75rem" }}>
        Enter the email and password you used to sign up.
      </p>

      {error ? (
        <div data-testid="login-error" className="alert-error" style={{ marginBottom: "1rem" }}>
          {error}
        </div>
      ) : null}

      <form
        data-testid="login-form"
        method="POST"
        action="/api/login"
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
            data-testid="login-email"
          />
        </div>

        <div>
          <label className="form-label" htmlFor="password">Password</label>
          <input
            className="input"
            type="password"
            id="password"
            name="password"
            required
            autoComplete="current-password"
            data-testid="login-password"
          />
        </div>

        <button type="submit" className="btn-primary" style={{ alignSelf: "flex-start", marginTop: "0.25rem" }} data-testid="login-submit">
          Log in
        </button>
      </form>

      <p style={{ marginTop: "1rem", fontSize: "0.875rem", color: "var(--ink-muted)" }}>
        No account? <a href="/signup" style={{ color: "var(--accent)" }}>Sign up</a>
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

export default LoginPage;
