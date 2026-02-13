import { createRequire } from "node:module";

/**
 * React renderer integrity layer
 *
 * Goal: SSR renderer must use the same React graph as the app route modules.
 * If @mandujs/core resolves react-dom from CLI's transient bunx cache,
 * hooks can break with `resolveDispatcher() === null`.
 */

type ReactDomServer = {
  renderToString?: (element: unknown) => string;
  renderToReadableStream?: (element: unknown, options?: Record<string, unknown>) => Promise<ReadableStream>;
};

const requireFromCore = createRequire(import.meta.url);

let cachedServer: ReactDomServer | null = null;
let cachedServerBrowser: ReactDomServer | null = null;

function loadFromProjectOrCore(specifier: "react-dom/server" | "react-dom/server.browser"): ReactDomServer {
  // 1) Prefer app-level dependency graph (process.cwd)
  const projectRequire = createRequire(`${process.cwd()}/`);

  try {
    return projectRequire(specifier) as ReactDomServer;
  } catch {
    // 2) Fallback to framework-local resolution (tests/isolated runtime)
    return requireFromCore(specifier) as ReactDomServer;
  }
}

export function getRenderToString(): (element: unknown) => string {
  if (!cachedServer) {
    cachedServer = loadFromProjectOrCore("react-dom/server");
  }

  if (typeof cachedServer.renderToString !== "function") {
    throw new Error("renderToString not found in react-dom/server");
  }

  return cachedServer.renderToString;
}

export function getRenderToReadableStream(): (
  element: unknown,
  options?: Record<string, unknown>
) => Promise<ReadableStream> {
  if (!cachedServerBrowser) {
    cachedServerBrowser = loadFromProjectOrCore("react-dom/server.browser");
  }

  if (typeof cachedServerBrowser.renderToReadableStream !== "function") {
    throw new Error("renderToReadableStream not found in react-dom/server.browser");
  }

  return cachedServerBrowser.renderToReadableStream;
}
