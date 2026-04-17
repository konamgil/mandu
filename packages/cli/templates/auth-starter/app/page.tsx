export default function HomePage() {
  return (
    <div>
      <h1
        style={{
          fontSize: "2.25rem",
          fontWeight: 700,
          lineHeight: 1.15,
          marginBottom: "0.75rem",
        }}
      >
        Mandu Auth Starter
      </h1>
      <p
        data-testid="home-tagline"
        style={{
          color: "var(--ink-muted)",
          fontSize: "1rem",
          lineHeight: 1.55,
          marginBottom: "2rem",
          maxWidth: "34rem",
        }}
      >
        A runnable demo of Phase 2 primitives: sessions, CSRF, argon2id password hashing,
        and the `loginUser` / `logoutUser` helpers — wired into a real signup / login /
        dashboard flow.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "3rem" }}>
        <a data-testid="cta-signup" href="/signup" className="btn-primary">Sign up</a>
        <a data-testid="cta-login" href="/login" className="btn-secondary">Log in</a>
      </div>

      <section>
        <h2 style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--ink-muted)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          What's exercised
        </h2>
        <ul className="card" style={{ padding: "1rem 1.25rem", listStyle: "disc", paddingInlineStart: "2.25rem" }}>
          <li style={{ marginBottom: "0.25rem" }}>
            <code>session()</code> middleware — cookie-backed, HMAC-signed
          </li>
          <li style={{ marginBottom: "0.25rem" }}>
            <code>csrf()</code> middleware — double-submit cookie on form POSTs
          </li>
          <li style={{ marginBottom: "0.25rem" }}>
            <code>hashPassword</code> / <code>verifyPassword</code> — argon2id via Bun.password
          </li>
          <li>
            <code>loginUser</code> / <code>logoutUser</code> / <code>currentUserId</code> — session bridge helpers
          </li>
        </ul>
      </section>
    </div>
  );
}
