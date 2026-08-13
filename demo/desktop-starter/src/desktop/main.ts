/**
 * Mandu desktop starter — main entry
 *
 * Pattern: main thread runs `Bun.serve()`, a Worker owns the native
 * WebView. This keeps the blocking `webview.run()` loop from starving the
 * HTTP server's event loop.
 *
 * Launch:
 *   $ bun add webview-bun          # install the optional peer
 *   $ mandu build                  # generate .mandu/manifest.json
 *   $ bun run src/desktop/main.ts  # or: bun --compile for a single binary
 */

import { startServer } from "@mandujs/core";
import type { RoutesManifest, BundleManifest } from "@mandujs/core";
import path from "path";
import fs from "fs";

async function loadManifest(): Promise<{
  routes: RoutesManifest;
  bundles?: BundleManifest;
}> {
  const rootDir = path.resolve(
    import.meta.dir ?? process.cwd(),
    "..",
    "..",
  );
  const routesPath = path.join(rootDir, ".mandu", "routes.json");
  const manifestPath = path.join(rootDir, ".mandu", "manifest.json");

  if (!fs.existsSync(routesPath)) {
    throw new Error(
      `Routes manifest not found at ${routesPath}. Run \`mandu build\` first.`,
    );
  }

  const routes = JSON.parse(
    fs.readFileSync(routesPath, "utf-8"),
  ) as RoutesManifest;

  let bundles: BundleManifest | undefined;
  if (fs.existsSync(manifestPath)) {
    try {
      bundles = JSON.parse(
        fs.readFileSync(manifestPath, "utf-8"),
      ) as BundleManifest;
    } catch {
      // Pure-SSR projects — bundle manifest is optional.
    }
  }

  return { routes, bundles };
}

async function main(): Promise<void> {
  const { routes, bundles } = await loadManifest();

  const server = startServer(routes, {
    port: 0,
    hostname: "127.0.0.1",
    rootDir: path.resolve(import.meta.dir ?? process.cwd(), "..", ".."),
    isDev: false,
    bundleManifest: bundles,
  });

  const port = server.server.port;
  if (!port) {
    throw new Error("Mandu server failed to allocate a port.");
  }
  const url = `http://127.0.0.1:${port}`;
  console.log(`[desktop] mandu server listening at ${url}`);

  // Worker hosts the WebView — its blocking run() loop never competes
  // with Bun.serve() on the main thread.
  const worker = new Worker(
    new URL("@mandujs/core/compat/desktop/worker", import.meta.url),
  );

  worker.addEventListener("message", (ev) => {
    const msg = ev.data as { type?: string; message?: string };
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "ready":
        console.log("[desktop] window ready");
        break;
      case "closed":
        console.log("[desktop] window closed, shutting down");
        server.stop();
        worker.terminate();
        process.exit(0);
      case "error":
        console.error("[desktop] worker error:", msg.message);
        break;
    }
  });

  worker.postMessage({
    type: "open",
    options: {
      url,
      title: process.env.MANDU_APP_TITLE ?? "Mandu Desktop Starter",
      width: 1280,
      height: 800,
    },
  });

  // Keep main thread alive. The process exits in the `closed` handler
  // above; SIGINT gets a best-effort cleanup here.
  process.on("SIGINT", () => {
    console.log("\n[desktop] SIGINT — shutting down");
    server.stop();
    worker.terminate();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("[desktop] fatal:", error);
  process.exit(1);
});
