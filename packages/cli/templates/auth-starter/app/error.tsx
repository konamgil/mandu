interface ErrorPageProps {
  error: Error;
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <div style={{ textAlign: "center", padding: "4rem 0" }}>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
        Something went wrong
      </h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        {error.message}
      </p>
      <button onClick={reset} className="btn-primary">Try again</button>
    </div>
  );
}
