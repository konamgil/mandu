/**
 * Smoke tests for Deno / Vercel / Netlify edge emitters.
 *
 * Exercise the full `emit*Bundle` path against a synthetic fixture — no
 * real Bun.build or external CLI is invoked; each emitter writes source
 * files that Deno / Vercel / Netlify consume at deploy time. We verify
 * file presence, content markers, and config-file parseability.
 *
 * Skipped automatically if the `@mandujs/cli` workspace is unavailable
 * (e.g. when `@mandujs/edge` is installed from npm in isolation).
 */

import { describe, it, expect, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import type { RoutesManifest } from "@mandujs/core";

async function mkTempProject(): Promise<string> {
  // Create the fixture inside the mandu repo so Bun.build's module resolver
  // can walk up to the monorepo root for `node_modules`. Match the pattern
  // already used by workers-emitter-smoke.
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const scratchRoot = path.join(repoRoot, ".mandu-edge-emitters-test-scratch");
  await fs.mkdir(scratchRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(scratchRoot, "emit-"));
  await fs.mkdir(path.join(dir, "app", "api", "ping"), { recursive: true });

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
      { name: "mandu-edge-emitters-fixture", version: "0.0.0", type: "module" },
      null,
      2
    )
  );

  return dir;
}

function baseManifest(): RoutesManifest {
  return {
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
}

let cleanupDir: string | null = null;

afterEach(async () => {
  if (cleanupDir) {
    await fs.rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
    cleanupDir = null;
  }
});

describe("mandu build --target=deno — emitter smoke", () => {
  it("emits server.ts + register.ts + manifest.json + deno.json", async () => {
    let emitDenoBundle: typeof import("../../cli/src/util/deno-emitter")["emitDenoBundle"];
    try {
      const mod = await import("../../cli/src/util/deno-emitter");
      emitDenoBundle = mod.emitDenoBundle;
    } catch {
      console.warn(
        "[@mandujs/edge] Skipping deno emitter smoke — CLI workspace not available."
      );
      return;
    }

    const rootDir = await mkTempProject();
    cleanupDir = rootDir;

    const result = await emitDenoBundle({
      rootDir,
      manifest: baseManifest(),
      cssPath: false,
      projectName: "mandu-deno-smoke",
    });

    // server.ts exists and contains the expected import.
    const entry = await fs.readFile(result.serverEntryPath, "utf-8");
    expect(entry).toContain("createDenoHandler");
    expect(entry).toContain("./manifest.json");
    expect(entry).toContain("./register.ts");

    // register.ts wires the api/ping handler.
    const registerPath = path.join(path.dirname(result.serverEntryPath), "register.ts");
    const register = await fs.readFile(registerPath, "utf-8");
    expect(register).toContain("api/ping");
    expect(register).toContain("registerApiHandler");

    // deno.json parses cleanly and carries the project name.
    expect(result.denoConfigGenerated).toBe(true);
    const json = await fs.readFile(result.denoConfigPath, "utf-8");
    const parsed = JSON.parse(json) as {
      deploy: { project: string; entrypoint: string };
      tasks: Record<string, string>;
    };
    expect(parsed.deploy.project).toBe("mandu-deno-smoke");
    expect(parsed.deploy.entrypoint).toBe(".mandu/deno/server.ts");
    expect(parsed.tasks.deploy).toContain("--project=mandu-deno-smoke");

    // Manifest copy is emitted alongside the entry.
    const manifestPath = path.join(path.dirname(result.serverEntryPath), "manifest.json");
    const manifestStat = await fs.stat(manifestPath);
    expect(manifestStat.isFile()).toBe(true);
  }, 10_000);
});

describe("mandu build --target=vercel-edge — emitter smoke", () => {
  it("emits api/_mandu.ts + register.ts + manifest.json + vercel.json", async () => {
    let emitVercelEdgeBundle: typeof import("../../cli/src/util/vercel-edge-emitter")["emitVercelEdgeBundle"];
    try {
      const mod = await import("../../cli/src/util/vercel-edge-emitter");
      emitVercelEdgeBundle = mod.emitVercelEdgeBundle;
    } catch {
      console.warn(
        "[@mandujs/edge] Skipping vercel emitter smoke — CLI workspace not available."
      );
      return;
    }

    const rootDir = await mkTempProject();
    cleanupDir = rootDir;

    const result = await emitVercelEdgeBundle({
      rootDir,
      manifest: baseManifest(),
      cssPath: false,
      projectName: "mandu-vercel-smoke",
    });

    // api/_mandu.ts exists and contains the Vercel runtime marker.
    const entry = await fs.readFile(result.edgeEntryPath, "utf-8");
    expect(entry).toContain(`runtime: "edge"`);
    expect(entry).toContain("createVercelEdgeHandler");
    expect(entry).toContain("export const config");

    // register.ts lives under .mandu/vercel/.
    const manduDir = path.join(rootDir, ".mandu", "vercel");
    const register = await fs.readFile(path.join(manduDir, "register.ts"), "utf-8");
    expect(register).toContain("api/ping");
    expect(register).toContain("registerApiHandler");

    // vercel.json parses cleanly with edge runtime function + catch-all.
    expect(result.vercelConfigGenerated).toBe(true);
    const json = await fs.readFile(result.vercelConfigPath, "utf-8");
    const parsed = JSON.parse(json) as {
      functions: Record<string, { runtime: string }>;
      rewrites: Array<{ source: string; destination: string }>;
    };
    expect(parsed.functions["api/_mandu.ts"]?.runtime).toBe("edge");
    const catchAll = parsed.rewrites.find((r) => r.source === "/(.*)");
    expect(catchAll).toBeDefined();
  }, 10_000);
});

describe("mandu build --target=netlify-edge — emitter smoke", () => {
  it("emits netlify/edge-functions/ssr.ts + register.ts + manifest.json + netlify.toml", async () => {
    let emitNetlifyEdgeBundle: typeof import("../../cli/src/util/netlify-edge-emitter")["emitNetlifyEdgeBundle"];
    try {
      const mod = await import("../../cli/src/util/netlify-edge-emitter");
      emitNetlifyEdgeBundle = mod.emitNetlifyEdgeBundle;
    } catch {
      console.warn(
        "[@mandujs/edge] Skipping netlify emitter smoke — CLI workspace not available."
      );
      return;
    }

    const rootDir = await mkTempProject();
    cleanupDir = rootDir;

    const result = await emitNetlifyEdgeBundle({
      rootDir,
      manifest: baseManifest(),
      cssPath: false,
      projectName: "mandu-netlify-smoke",
    });

    // ssr.ts exists with Netlify path config.
    const entry = await fs.readFile(result.edgeEntryPath, "utf-8");
    expect(entry).toContain("createNetlifyEdgeHandler");
    expect(entry).toContain(`path: "/*"`);
    expect(entry).toContain("export const config");

    // register.ts under .mandu/netlify/.
    const manduDir = path.join(rootDir, ".mandu", "netlify");
    const register = await fs.readFile(path.join(manduDir, "register.ts"), "utf-8");
    expect(register).toContain("api/ping");
    expect(register).toContain("registerApiHandler");

    // netlify.toml generated.
    expect(result.netlifyConfigGenerated).toBe(true);
    const toml = await fs.readFile(result.netlifyConfigPath, "utf-8");
    expect(toml).toContain("[build]");
    expect(toml).toContain("[[edge_functions]]");
    expect(toml).toContain(`path = "/*"`);
    expect(toml).toContain(`function = "ssr"`);
    expect(toml).toContain(`# Project: mandu-netlify-smoke`);
  }, 10_000);
});
