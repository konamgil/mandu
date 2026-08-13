#!/usr/bin/env bun
/**
 * Phase 9b B — Developer helper for building the `mandu` standalone binary.
 *
 * Wraps `bun build --compile` with the invariants required for a working
 * Mandu CLI binary:
 *
 *   - Entry: `packages/cli/src/main.ts`
 *   - Target: host by default, `BUN_TARGET=…` env to cross-compile
 *   - React/react-dom are **not** bundled — they remain external because
 *     user projects provide them at runtime (see
 *     `packages/cli/src/util/bun.ts::buildExternalList`).
 *   - Regenerates `src/util/templates.generated.ts` first so the embedded
 *     file manifest is always in sync with `packages/cli/templates/`.
 *
 * Usage:
 *
 *   # host binary (Windows → mandu.exe, Unix → mandu)
 *   bun run packages/cli/scripts/build-binary.ts
 *
 *   # cross-compile to Linux x64 (glibc)
 *   BUN_TARGET=bun-linux-x64 bun run packages/cli/scripts/build-binary.ts
 *
 *   # cross-compile to macOS ARM64
 *   BUN_TARGET=bun-darwin-arm64 bun run packages/cli/scripts/build-binary.ts
 *
 * Full cross-compile matrix (release wiring lives in
 * `.github/workflows/release-binary.yml`, which is Phase 9b C's scope):
 *
 *   bun-linux-x64, bun-linux-x64-musl, bun-linux-arm64
 *   bun-darwin-x64, bun-darwin-arm64
 *   bun-windows-x64
 *
 * See also:
 *   docs/bun/phase-9-diagnostics/compile-binary.md §1.2 (target catalog)
 *   docs/bun/phase-9-diagnostics/compile-binary.md §5.1 (release matrix)
 */

import path from "node:path";
import { mkdirSync, existsSync, statSync } from "node:fs";

const CLI_PACKAGE_ROOT = path.resolve(import.meta.dir, "..");
const REPO_ROOT = path.resolve(CLI_PACKAGE_ROOT, "..", "..");
const ENTRY = path.join(CLI_PACKAGE_ROOT, "src", "main.ts");
const OUT_DIR = path.join(CLI_PACKAGE_ROOT, "dist");
const GENERATOR = path.join(CLI_PACKAGE_ROOT, "scripts", "generate-template-manifest.ts");

interface BuildOptions {
  target: string | undefined;
  outfile: string;
  windowsTitle?: string;
  windowsPublisher?: string;
  windowsVersion?: string;
}

function resolveOutfile(target: string | undefined): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const ext = (target ?? "").startsWith("bun-windows-") || process.platform === "win32" && !target
    ? ".exe"
    : "";
  const suffix = target ? `-${target.replace(/^bun-/, "")}` : "";
  return path.join(OUT_DIR, `mandu${suffix}${ext}`);
}

async function regenerateTemplateManifest(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("→ Regenerating template manifest …");
  const proc = Bun.spawn({
    cmd: ["bun", "run", GENERATOR],
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`generate-template-manifest.ts exited with code ${code}`);
  }
}

async function runBuild(opts: BuildOptions): Promise<void> {
  const args = [
    "build",
    "--compile",
    "--minify",
    "--sourcemap=none",
    ENTRY,
    "--outfile",
    opts.outfile,
  ];

  if (opts.target) {
    args.push("--target", opts.target);
  }

  // Windows metadata (SmartScreen-friendly). `bun build --compile` REJECTS
  // these flags when the compile target is not Windows, so we only attach
  // them for the host-Windows build or an explicit `--target bun-windows-*`.
  // Cross-compiling to Linux/macOS from a Windows host is a supported path
  // (tested in Phase 9.R2 bench), and this guard keeps that flow clean.
  const isWindowsTarget = opts.target
    ? opts.target.startsWith("bun-windows-")
    : process.platform === "win32";
  if (isWindowsTarget) {
    if (opts.windowsTitle) args.push(`--windows-title=${opts.windowsTitle}`);
    if (opts.windowsPublisher) args.push(`--windows-publisher=${opts.windowsPublisher}`);
    if (opts.windowsVersion) args.push(`--windows-version=${opts.windowsVersion}`);
  }

  // eslint-disable-next-line no-console
  console.log(`→ ${["bun", ...args].join(" ")}`);

  const proc = Bun.spawn({
    cmd: ["bun", ...args],
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`bun build --compile exited with code ${code}`);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function reportOutfile(outfile: string): void {
  if (!existsSync(outfile)) {
    // eslint-disable-next-line no-console
    console.error(`✗ Expected output at ${outfile} but the file does not exist.`);
    process.exit(1);
  }
  const st = statSync(outfile);
  // eslint-disable-next-line no-console
  console.log(`✓ Built ${path.relative(REPO_ROOT, outfile)} (${formatBytes(st.size)})`);
}

async function resolveCliVersion(): Promise<string> {
  try {
    const pkgPath = path.join(CLI_PACKAGE_ROOT, "package.json");
    const pkgText = await Bun.file(pkgPath).text();
    const pkg = JSON.parse(pkgText) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Convert SemVer (including prereleases) to Bun's numeric Windows format. */
export function toWindowsVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!match) return "0.0.0.0";
  return [match[1], match[2], match[3], match[4] ?? "0"].join(".");
}

async function main(): Promise<void> {
  const target = process.env.BUN_TARGET;
  const outfile = resolveOutfile(target);

  await regenerateTemplateManifest();

  const version = await resolveCliVersion();
  const versionParts = toWindowsVersion(version);

  await runBuild({
    target,
    outfile,
    windowsTitle: "Mandu CLI",
    windowsPublisher: "LamySolution",
    windowsVersion: versionParts,
  });

  reportOutfile(outfile);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("✗ build-binary failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
