/**
 * App-level 404 surface (Phase 6.3).
 *
 * Rendered when either
 *   (a) the URL doesn't match any route in the manifest, or
 *   (b) a page's loader calls `notFound()` / `throw notFound()`.
 *
 * The framework preserves layouts, cookies, and metadata when reaching
 * this page — treat it like any other page-level component.
 */
interface NotFoundData {
  message?: string;
}

interface NotFoundPageProps {
  loaderData?: NotFoundData;
}

export default function NotFoundPage({ loaderData }: NotFoundPageProps) {
  const message = loaderData?.message ?? "The page you were looking for doesn't exist.";
  return (
    <div
      data-testid="not-found-page"
      style={{ textAlign: "center", padding: "4rem 0" }}
    >
      <h1
        data-testid="not-found-heading"
        style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.5rem" }}
      >
        404 — Not Found
      </h1>
      <p
        data-testid="not-found-message"
        style={{ color: "var(--ink-muted)", fontSize: "0.9375rem", marginBottom: "1.5rem" }}
      >
        {message}
      </p>
      <a href="/" className="btn-primary">Back to home</a>
    </div>
  );
}
