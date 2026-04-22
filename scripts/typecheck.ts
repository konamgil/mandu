#!/usr/bin/env bun
/**
 * Mandu Type-Check Script
 *
 * Defaults to the **TypeScript 7 native (Go) compiler** via `tsgo` for a
 * ~10× speedup over the old JS-based `tsc`. Falls back to `tsc` when
 * tsgo is unavailable or when `MANDU_TYPECHECK=tsc` is set.
 *
 * Usage:
 *   bun run typecheck                 # all packages, tsgo default
 *   bun run typecheck core            # specific package
 *   bun run typecheck core cli        # multiple
 *
 *   MANDU_TYPECHECK=tsc bun run typecheck   # force legacy tsc
 *   MANDU_TYPECHECK=tsgo bun run typecheck  # force tsgo (error if absent)
 *
 * Benchmark line is printed at the end so speed gains are visible:
 *
 *   ✅ All packages passed type check in 5.2s (checker: tsgo).
 */

import { $ } from "bun";
import { join } from "path";
import { existsSync } from "fs";

const ROOT = join(import.meta.dir, "..");
const ALL_PACKAGES = ["core", "cli", "mcp", "ate", "edge", "skills", "playground-runner"];

type Checker = "tsgo" | "tsc";

function selectChecker(): { name: Checker; invocation: string } {
  const override = (process.env.MANDU_TYPECHECK || "").toLowerCase();

  // Honor explicit override.
  if (override === "tsc") return { name: "tsc", invocation: "tsc" };
  if (override === "tsgo") {
    // Throw upstream if missing — user explicitly asked for tsgo.
    return { name: "tsgo", invocation: "tsgo" };
  }

  // Auto: prefer tsgo if the binary exists in node_modules; otherwise tsc.
  // Bun's binary layout on Windows is tsgo.exe / tsgo.bunx (not .cmd).
  const binDir = join(ROOT, "node_modules", ".bin");
  const candidates = process.platform === "win32"
    ? ["tsgo.exe", "tsgo.cmd", "tsgo.bunx", "tsgo"]
    : ["tsgo"];
  for (const c of candidates) {
    if (existsSync(join(binDir, c))) {
      return { name: "tsgo", invocation: "tsgo" };
    }
  }

  return { name: "tsc", invocation: "tsc" };
}

const requestedPackages = process.argv.slice(2);
const packages =
  requestedPackages.length > 0
    ? requestedPackages.filter((p) => {
        if (!ALL_PACKAGES.includes(p)) {
          console.error(`Unknown package: ${p} (available: ${ALL_PACKAGES.join(", ")})`);
          return false;
        }
        return true;
      })
    : ALL_PACKAGES;

if (packages.length === 0) {
  process.exit(1);
}

const checker = selectChecker();
console.log(`⚡ Checker: ${checker.name}${checker.name === "tsgo" ? " (TypeScript 7 native, ~10× faster)" : " (legacy)"}\n`);

const startedAt = performance.now();
let hasError = false;

// TS 7 — `--checkers` enables parallel type-check workers inside a single
// project. We parallelize BETWEEN projects too (across packages) by running
// them concurrently; each subprocess uses one checker worker by default. On
// an 8-core machine that's 7 parallel package checks + 1 worker each,
// capped naturally by CPU count.
const cpuCount = Math.max(1, Math.min(packages.length, 8));
const checkersPerProject = checker.name === "tsgo" ? "2" : undefined;

async function typecheckPackage(pkg: string): Promise<{ pkg: string; ok: boolean; stderr?: string; stdout?: string }> {
  const pkgDir = join(ROOT, "packages", pkg);
  const tsconfigPath = join(pkgDir, "tsconfig.json");

  if (!existsSync(tsconfigPath)) {
    console.log(`⏭️  ${pkg} — tsconfig.json not found, skipping`);
    return { pkg, ok: true };
  }

  console.log(`🔍 ${pkg} — type-checking...`);
  try {
    if (checker.name === "tsgo") {
      await $`tsgo --noEmit --project ${tsconfigPath} --checkers ${checkersPerProject}`.quiet();
    } else {
      await $`tsc --noEmit --project ${tsconfigPath}`.quiet();
    }
    console.log(`✅ ${pkg} — no errors`);
    return { pkg, ok: true };
  } catch (err: unknown) {
    const shellErr = err as { stdout?: Buffer; stderr?: Buffer };
    const stdout = shellErr.stdout?.toString();
    const stderr = shellErr.stderr?.toString();
    console.error(`❌ ${pkg} — type errors found`);
    return { pkg, ok: false, stdout, stderr };
  }
}

// Bounded concurrency across packages.
const results: Array<{ pkg: string; ok: boolean; stderr?: string; stdout?: string }> = [];
let cursor = 0;
async function worker() {
  while (cursor < packages.length) {
    const idx = cursor++;
    const pkg = packages[idx];
    if (!pkg) continue;
    results.push(await typecheckPackage(pkg));
  }
}
await Promise.all(Array.from({ length: cpuCount }, () => worker()));

// Sort back to input order for deterministic output.
results.sort((a, b) => packages.indexOf(a.pkg) - packages.indexOf(b.pkg));
for (const r of results) {
  if (!r.ok) {
    hasError = true;
    if (r.stdout) console.error(r.stdout);
    if (r.stderr) console.error(r.stderr);
  }
}

const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(1);

if (hasError) {
  console.error(`\n❌ Type check failed in ${elapsedSec}s (checker: ${checker.name}).`);
  process.exit(1);
} else {
  console.log(`\n✅ All packages passed type check in ${elapsedSec}s (checker: ${checker.name}).`);
}
