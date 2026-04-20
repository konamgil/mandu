/**
 * Cloudflare Workers bundle emitter.
 *
 * Runs as the last step of `mandu build --target=workers`. Produces:
 *
 *   .mandu/workers/worker.js    — bundled ModuleWorker entry
 *   .mandu/workers/register.js  — SSR handler registration wiring
 *   .mandu/workers/manifest.json — cloned RoutesManifest (serializable copy)
 *   wrangler.toml               — generated if absent; preserved otherwise
 *
 * The worker entry imports `@mandujs/core` + `@mandujs/edge/workers` and
 * calls `createWorkersHandler(manifest)` after registering every route
 * module. Route modules are inlined into the bundle by `Bun.build` with
 * `target: "browser"` and `format: "esm"` — Workers is happiest with ESM
 * modules, and the `browser` target strips Node core modules aggressively.
 */

import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { safeBuild } from "@mandujs/core/bundler/safe-build";
import type { RoutesManifest } from "@mandujs/core";
import { generateWranglerConfig } from "@mandujs/edge/workers";

const WORKER_OUTPUT_DIR = ".mandu/workers";
const WORKER_ENTRY_FILENAME = "worker.entry.ts";
const WORKER_REGISTER_FILENAME = "register.ts";
const WORKER_MANIFEST_FILENAME = "manifest.json";
const WORKER_OUTPUT_FILENAME = "worker.js";
const WRANGLER_CONFIG_FILENAME = "wrangler.toml";

export interface EmitWorkersBundleOptions {
  /** Absolute path to the project root. */
  rootDir: string;
  /** Parsed routes manifest — same object the main build consumed. */
  manifest: RoutesManifest;
  /** CSS link path (from the main build). Forwarded to the Workers handler. */
  cssPath: string | false;
  /** Override the wrangler `name` field. Defaults to a slug of the project dir. */
  workerName?: string;
  /**
   * Phase 18.λ — cron schedule strings to emit into the `[triggers]` block
   * of a newly-generated `wrangler.toml`. Pre-filtered by
   * {@link import("./cron-wrangler").extractWorkersCrons} — duplicates
   * removed, workers-ineligible jobs dropped. When an existing
   * `wrangler.toml` is preserved, this field is ignored (users are assumed
   * to have hand-tuned their triggers block).
   *
   * Empty / undefined leaves the `[triggers]` block out of the generated
   * config entirely.
   */
  crons?: string[];
}

export interface EmitWorkersBundleResult {
  /** Absolute path to the generated worker.js (bundled). */
  workerBundlePath: string;
  /** Size of the bundled worker in bytes. */
  bundleSize: number;
  /** Whether wrangler.toml was newly generated (vs preserved). */
  wranglerConfigGenerated: boolean;
  /** Absolute path to wrangler.toml. */
  wranglerConfigPath: string;
}

/**
 * Emit the Workers deployment artifacts. Returns the output paths and
 * bundle size for downstream reporting.
 */
export async function emitWorkersBundle(
  options: EmitWorkersBundleOptions
): Promise<EmitWorkersBundleResult> {
  const {
    rootDir,
    manifest,
    cssPath,
    workerName: explicitName,
    crons,
  } = options;

  console.log(`\n☁️  Building Cloudflare Workers bundle...`);

  const workerDir = path.join(rootDir, WORKER_OUTPUT_DIR);
  await fs.mkdir(workerDir, { recursive: true });

  // 1. Emit a copy of the manifest for the worker to import at runtime.
  const manifestPath = path.join(workerDir, WORKER_MANIFEST_FILENAME);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // 2. Generate the register.ts that imports every route module (so
  //    `registerApiHandler` / `registerPageHandler` calls run at load).
  const registerSource = generateRegisterSource(manifest, rootDir);
  const registerPath = path.join(workerDir, WORKER_REGISTER_FILENAME);
  await fs.writeFile(registerPath, registerSource);

  // 3. Generate the worker entry that wires everything together.
  const entrySource = generateWorkerEntrySource({
    manifestRelativePath: `./${WORKER_MANIFEST_FILENAME}`,
    registerRelativePath: `./${WORKER_REGISTER_FILENAME}`,
    cssPath,
  });
  const entryPath = path.join(workerDir, WORKER_ENTRY_FILENAME);
  await fs.writeFile(entryPath, entrySource);

  // 4. Bundle with Bun.build targeting `bun` — Cloudflare Workers'
  //    workerd V8 isolates speak the Bun/Node superset when the
  //    `nodejs_compat` flag is on (which we default in wrangler.toml).
  //    Using `browser` would reject Node built-ins that `@mandujs/core`
  //    imports (`module`, `child_process`, etc.). We mark first-party
  //    packages + React externally so the bundle stays small and
  //    Wrangler pulls them from node_modules at deploy time.
  const outPath = path.join(workerDir, WORKER_OUTPUT_FILENAME);
  const buildResult = await safeBuild({
    entrypoints: [entryPath],
    outdir: workerDir,
    naming: WORKER_OUTPUT_FILENAME,
    target: "bun",
    format: "esm",
    minify: false,
    sourcemap: "none",
    splitting: false,
    external: [
      // Cloudflare-specific modules — workerd provides these natively.
      "cloudflare:workers",
      // node: builtins — Workers nodejs_compat polyfills these.
      "node:*",
    ],
  });

  if (!buildResult.success) {
    const message = buildResult.logs
      .map((log) => (log && typeof log === "object" && "message" in log ? String((log as { message: unknown }).message) : String(log)))
      .join("\n");
    throw new Error(`Bun.build failed:\n${message}`);
  }

  let bundleSize = 0;
  try {
    const stat = await fs.stat(outPath);
    bundleSize = stat.size;
  } catch {
    // Non-fatal — Bun.build succeeded but we couldn't stat for size.
  }

  // 5. Emit or preserve wrangler.toml.
  const projectName =
    (explicitName ?? (await inferProjectName(rootDir))) || "mandu-worker";

  const wranglerPath = path.join(rootDir, WRANGLER_CONFIG_FILENAME);
  const wranglerExists = existsSync(wranglerPath);
  if (!wranglerExists) {
    const publicDirAbs = path.join(rootDir, "public");
    const hasPublic = existsSync(publicDirAbs);
    const toml = generateWranglerConfig({
      projectName,
      main: `${WORKER_OUTPUT_DIR}/${WORKER_OUTPUT_FILENAME}`.replace(/\\/g, "/"),
      assetsDir: hasPublic ? "public" : undefined,
      // Phase 18.λ — emit scheduler's workers-eligible crons into the
      // `[triggers]` block. When the user has hand-authored a
      // `wrangler.toml`, `wranglerExists` is true and we skip regeneration
      // entirely — their triggers block wins.
      crons: crons && crons.length > 0 ? crons : undefined,
    });
    await fs.writeFile(wranglerPath, toml);
  }

  const sizeKB = (bundleSize / 1024).toFixed(1);
  console.log(`   ✅ worker.js (${sizeKB} KB)`);
  console.log(`   📄 wrangler.toml ${wranglerExists ? "(preserved)" : "(generated)"}`);
  if (!wranglerExists && crons && crons.length > 0) {
    console.log(`   ⏰ Cron triggers: ${crons.length} (${crons.join(", ")})`);
  } else if (wranglerExists && crons && crons.length > 0) {
    console.log(
      `   ⚠️  wrangler.toml preserved — merge these cron triggers manually: ${crons.join(", ")}`
    );
  }
  console.log(`   Output: ${WORKER_OUTPUT_DIR}/worker.js`);
  console.log(`\n   Next: wrangler dev   or   wrangler deploy`);

  return {
    workerBundlePath: outPath,
    bundleSize,
    wranglerConfigGenerated: !wranglerExists,
    wranglerConfigPath: wranglerPath,
  };
}

/**
 * Generate `register.ts`. Imports every route module in the manifest using
 * Bun.build-resolvable paths. Each route module's import side-effect
 * registers its handler through the module-level `registerApiHandler` /
 * `registerPageHandler` calls populated by `@mandujs/cli`'s runtime.
 *
 * For FS-Routes projects the route modules live at `app/**`; their files
 * export `ManduFilling` instances that we wrap via `registerManifestHandlers`
 * at runtime. In the worker bundle we eagerly import them so the module
 * graph is tree-shaken into the final `.js`.
 */
function generateRegisterSource(manifest: RoutesManifest, rootDir: string): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated by mandu build --target=workers.`);
  lines.push(`// Do not edit — re-runs overwrite this file.`);
  lines.push(`import {`);
  lines.push(`  registerApiHandler,`);
  lines.push(`  registerPageHandler,`);
  lines.push(`  registerPageLoader,`);
  lines.push(`  registerLayoutLoader,`);
  lines.push(`  needsHydration,`);
  lines.push(`} from "@mandujs/core";`);
  lines.push("");

  let importIndex = 0;
  const imports: string[] = [];
  const registrations: string[] = [];

  for (const route of manifest.routes) {
    if (route.kind === "api") {
      if (!route.module) continue;
      const importName = `route_${importIndex++}`;
      const relPath = toRelativeImport(rootDir, route.module);
      imports.push(`import * as ${importName} from "${relPath}";`);
      registrations.push(
        [
          `registerApiHandler(${JSON.stringify(route.id)}, async (req: Request, params: Record<string, string> = {}) => {`,
          `  const mod: any = ${importName};`,
          `  const target: any = mod.default ?? mod.handler ?? mod;`,
          `  if (target && typeof target.handle === "function") {`,
          `    return target.handle(req, params);`,
          `  }`,
          `  if (target && typeof target === "object") {`,
          `    const method = req.method.toUpperCase();`,
          `    const fn = target[method];`,
          `    if (typeof fn === "function") {`,
          `      return fn(req, { params });`,
          `    }`,
          `  }`,
          `  return new Response("Method Not Allowed", { status: 405 });`,
          `});`,
        ].join("\n")
      );
    } else if (route.kind === "page" && route.componentModule) {
      const importName = `page_${importIndex++}`;
      const relPath = toRelativeImport(rootDir, route.componentModule);
      imports.push(`import * as ${importName} from "${relPath}";`);
      if (route.slotModule) {
        registrations.push(
          [
            `registerPageHandler(${JSON.stringify(route.id)}, async () => {`,
            `  const mod: any = ${importName};`,
            `  const rawDefault = mod.default;`,
            `  if (typeof rawDefault === "function") {`,
            `    return { component: rawDefault, filling: mod.filling };`,
            `  }`,
            `  if (typeof rawDefault === "object" && rawDefault !== null) {`,
            `    return { ...rawDefault };`,
            `  }`,
            `  throw new Error("[Mandu] Page module '${route.id}' has no default export.");`,
            `});`,
          ].join("\n")
        );
      } else {
        registrations.push(
          `registerPageLoader(${JSON.stringify(route.id)}, async () => ${importName});`
        );
      }
      if (Array.isArray(route.layoutChain)) {
        for (const layoutPath of route.layoutChain) {
          const layoutImportName = `layout_${importIndex++}`;
          const layoutRelPath = toRelativeImport(rootDir, layoutPath);
          imports.push(`import * as ${layoutImportName} from "${layoutRelPath}";`);
          registrations.push(
            `registerLayoutLoader(${JSON.stringify(layoutPath)}, async () => ${layoutImportName});`
          );
        }
      }
    }
  }

  lines.push(...imports);
  lines.push("");
  lines.push("// eslint-disable-next-line @typescript-eslint/no-unused-vars");
  lines.push("const _needsHydration = needsHydration; // keep symbol referenced");
  lines.push("");
  lines.push(...registrations);
  lines.push("");
  lines.push(`export {};`);

  return lines.join("\n");
}

/**
 * Generate `worker.entry.ts` — the ModuleWorker entry that `Bun.build`
 * bundles into `worker.js`.
 */
function generateWorkerEntrySource(opts: {
  manifestRelativePath: string;
  registerRelativePath: string;
  cssPath: string | false;
}): string {
  const cssPathExpr =
    opts.cssPath === false ? "false" : JSON.stringify(opts.cssPath);
  return [
    `// Auto-generated by mandu build --target=workers.`,
    `// ModuleWorker entry for Cloudflare Workers.`,
    `import manifest from "${opts.manifestRelativePath}" with { type: "json" };`,
    `import { createWorkersHandler } from "@mandujs/edge/workers";`,
    `import "${opts.registerRelativePath}";`,
    ``,
    `const fetch = createWorkersHandler(manifest as any, {`,
    `  cssPath: ${cssPathExpr},`,
    `});`,
    ``,
    `export default { fetch };`,
    ``,
  ].join("\n");
}

async function inferProjectName(rootDir: string): Promise<string | undefined> {
  try {
    const pkgRaw = await fs.readFile(path.join(rootDir, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw) as { name?: unknown };
    if (typeof pkg.name !== "string") return undefined;
    return pkg.name
      .toLowerCase()
      .replace(/@[^/]+\//, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
  } catch {
    return undefined;
  }
}

function toRelativeImport(rootDir: string, modulePath: string): string {
  // Canonicalize `app/page.tsx` → `../../app/page.tsx` (from .mandu/workers).
  const abs = path.isAbsolute(modulePath) ? modulePath : path.join(rootDir, modulePath);
  let rel = path.relative(path.join(rootDir, WORKER_OUTPUT_DIR), abs);
  rel = rel.replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}
