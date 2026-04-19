/**
 * Mandu + Cloudflare Workers starter page.
 *
 * SSR'd on the Worker. No hydration — this is a pure SSR demo to keep the
 * bundle minimal. Add `.island.tsx` files next to `page.tsx` for hydrated
 * components.
 */

export default function HomePage() {
  const region =
    typeof globalThis !== "undefined"
      ? (globalThis as { navigator?: { userAgent?: string } }).navigator
          ?.userAgent ?? "unknown"
      : "unknown";

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "64px 24px",
        lineHeight: 1.6,
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 48, margin: "0 0 12px" }}>
          Hello, Workers!
        </h1>
        <p style={{ opacity: 0.75, margin: 0 }}>
          Mandu + Cloudflare Workers — Phase 15.1 MVP
        </p>
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>What this demo shows</h2>
        <ul style={{ paddingLeft: 20 }}>
          <li>SSR rendered inside a Cloudflare Worker</li>
          <li>Mandu filling pipeline running on WebCrypto primitives</li>
          <li>
            <code>/api/health</code> endpoint proving API routes work on the
            edge
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Try it</h2>
        <pre
          style={{
            background: "#1e293b",
            padding: 16,
            borderRadius: 8,
            overflow: "auto",
          }}
        >
{`# Build the Workers bundle
bun run build:workers

# Local dev against the real Workers runtime
bun run preview

# Deploy to Cloudflare
bun run deploy`}
        </pre>
      </section>

      <footer style={{ opacity: 0.5, fontSize: 13 }}>
        <div>Runtime: Cloudflare Workers</div>
        <div>User-Agent: {region}</div>
      </footer>
    </main>
  );
}
