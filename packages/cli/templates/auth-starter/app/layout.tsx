/**
 * Root layout. Receives `authed` from `spec/slots/layout.slot.ts` so the
 * header can show the right set of nav links.
 *
 * NO `<html>/<head>/<body>` tags — Mandu's SSR renderer injects those.
 */
interface RootLayoutProps {
  children: React.ReactNode;
  authed?: boolean;
  csrfToken?: string;
}

export default function RootLayout({
  children,
  authed = false,
  csrfToken = "",
}: RootLayoutProps) {
  const guestLinks = (
    <>
      <a data-testid="nav-login" href="/login" className="btn-secondary">Log in</a>
      <a data-testid="nav-signup" href="/signup" className="btn-primary">Sign up</a>
    </>
  );

  const userLinks = (
    <>
      <a data-testid="nav-dashboard" href="/dashboard" className="btn-secondary">Dashboard</a>
      <form method="POST" action="/api/logout" style={{ display: "inline" }}>
        <input type="hidden" name="_csrf" value={csrfToken} />
        <button data-testid="nav-logout" type="submit" className="btn-secondary">Log out</button>
      </form>
    </>
  );

  return (
    <div style={{ minHeight: "100vh" }}>
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <div
          style={{
            maxWidth: "56rem",
            margin: "0 auto",
            padding: "0.75rem 1.25rem",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <a
            href="/"
            style={{
              fontWeight: 600,
              fontSize: "1.05rem",
              color: "var(--ink)",
              textDecoration: "none",
            }}
          >
            <span aria-hidden="true" style={{ marginRight: "0.5rem" }}>🥟</span>
            Mandu Auth Starter
          </a>
          <nav style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            {authed ? userLinks : guestLinks}
          </nav>
        </div>
      </header>
      <main
        style={{
          maxWidth: "40rem",
          margin: "0 auto",
          padding: "2.5rem 1.25rem",
        }}
      >
        {children}
      </main>
    </div>
  );
}
