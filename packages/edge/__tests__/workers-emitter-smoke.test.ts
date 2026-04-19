/**
 * Smoke test for `emitWorkersBundle`.
 *
 * Exercises the end-to-end CLI emitter against a synthetic project
 * fixture. This is the closest we get to `mandu build --target=workers`
 * without invoking the full CLI (which would require a full routes
 * scan + real `Bun.build` over the entire monorepo).
 *
 * Skipped automatically if the `@mandujs/cli` workspace is unavailable
 * (e.g. when @mandujs/edge is tested in isolation on npm).
 */

import { describe, it, expect, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import type { RoutesManifest } from "@mandujs/core";

async function mkTempProject(): Promise<string> {
  // Create the fixture inside the mandu repo so Bun.build's module resolver
  // can walk up to the monorepo root for `node_modules` (workspace-linked
  // `@mandujs/edge` and `@mandujs/core`). A pure OS-temp dir would have no
  // `node_modules` ancestry and fail to resolve the imports.
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const scratchRoot = path.join(repoRoot, ".mandu-edge-test-scratch");
  await fs.mkdir(scratchRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(scratchRoot, "emit-"));
  await fs.mkdir(path.join(dir, "app", "api", "ping"), { recursive: true });

  // Minimal API route that doesn't pull in React (avoids bundle bloat
  // in this smoke scenario).
  await fs.writeFile(
    path.join(dir, "app", "api", "ping", "route.ts"),
    [
      `export default {`,
      `  async GET() {`,
      `    return new Response(JSON.stringify({ pong: true }), {`,
      `      headers: { "content-type": "application/json" },`,
      `    });`,
      `  },`,
      `};`,
      ``,
    ].join("\n")
  );

  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name: "mandu-edge-smoke-fixture", version: "0.0.0", type: "module" },
      null,
      2
    )
  );

  return dir;
}

let cleanupDir: string | null = null;

afterEach(async () => {
  if (cleanupDir) {
    await fs.rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
    cleanupDir = null;
  }
});

describe("mandu build --target=workers — emitter smoke", () => {
  it("emits worker.js + wrangler.toml for a minimal API-only project", async () => {
    let emitWorkersBundle: typeof import("../../cli/src/util/workers-emitter")["emitWorkersBundle"];
    try {
      const mod = await import("../../cli/src/util/workers-emitter");
      emitWorkersBundle = mod.emitWorkersBundle;
    } catch {
      // CLI workspace isn't wired in this checkout — skip rather than fail.
      console.warn(
        "[@mandujs/edge] Skipping emitter smoke — CLI workspace not available."
      );
      return;
    }

    const rootDir = await mkTempProject();
    cleanupDir = rootDir;

    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          id: "api/ping",
          pattern: "/api/ping",
          kind: "api",
          module: "app/api/ping/route.ts",
          methods: ["GET"],
        },
      ],
    };

    const result = await emitWorkersBundle({
      rootDir,
      manifest,
      cssPath: false,
      workerName: "mandu-edge-smoke",
    });

    // worker.js must exist and be non-trivially sized.
    const workerStat = await fs.stat(result.workerBundlePath);
    expect(workerStat.isFile()).toBe(true);
    expect(workerStat.size).toBeGreaterThan(100);

    // Bundle size must fit within the Workers free-tier (3 MB) —
    // keep a generous headroom. Large React SSR apps may push beyond
    // this; we use a very lenient budget here.
    expect(workerStat.size).toBeLessThan(3 * 1024 * 1024);

    // wrangler.toml should exist and embed the Worker name we supplied.
    const tomlText = await fs.readFile(result.wranglerConfigPath, "utf-8");
    expect(tomlText).toContain(`name = "mandu-edge-smoke"`);
    expect(tomlText).toContain(`main = ".mandu/workers/worker.js"`);

    // Emitted register/manifest files should be alongside worker.js.
    const workerDir = path.dirname(result.workerBundlePath);
    const manifestPath = path.join(workerDir, "manifest.json");
    const manifestStat = await fs.stat(manifestPath);
    expect(manifestStat.isFile()).toBe(true);
  }, 30_000);
});
