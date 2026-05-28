import { describe, expect, it } from "bun:test";
import React from "react";
import type { RoutesManifest } from "../../spec/schema";
import {
  createServerRegistry,
  startServer,
  type ManduServer,
} from "../server";

// Issue #314 — server page components must receive `searchParams` (query
// string) as a prop, matching the value `generateMetadata` already gets.
// SearchPage renders the query so we can assert it survives SSR.
function SearchPage({
  params,
  searchParams,
}: {
  params: Record<string, string>;
  searchParams: Record<string, string>;
}): React.ReactElement {
  return React.createElement(
    "main",
    null,
    React.createElement("p", { "data-testid": "q" }, `q = ${searchParams.q ?? "(undefined)"}`),
    React.createElement("p", { "data-testid": "id" }, `id = ${params.id ?? "(none)"}`),
  );
}

function searchManifest(): RoutesManifest {
  return {
    version: 1,
    routes: [
      {
        id: "search",
        kind: "page",
        pattern: "/search",
        module: "app/search/page.tsx",
        componentModule: "app/search/page.tsx",
        hydration: { strategy: "none", priority: "visible", preload: false },
      },
    ],
  };
}

async function fetchSearch(query: string): Promise<{ status: number; html: string }> {
  const registry = createServerRegistry();
  registry.registerRouteComponent("search", SearchPage);

  let server: ManduServer | undefined;
  try {
    server = startServer(searchManifest(), {
      port: 0,
      registry,
      transitions: false,
      prefetch: false,
      spa: false,
      devtools: false,
      silent: true,
    });
    const response = await fetch(`http://127.0.0.1:${server.server.port}/search${query}`);
    return { status: response.status, html: await response.text() };
  } finally {
    server?.stop();
  }
}

describe("server page searchParams prop (#314)", () => {
  it("passes the query string to the page component", async () => {
    const { status, html } = await fetchSearch("?q=foo");

    expect(status).toBe(200);
    expect(html).toContain("q = foo");
    expect(html).not.toContain("q = (undefined)");
  });

  it("renders gracefully when the query string is absent", async () => {
    const { status, html } = await fetchSearch("");

    expect(status).toBe(200);
    expect(html).toContain("q = (undefined)");
  });
});
