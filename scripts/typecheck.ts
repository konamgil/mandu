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

for (const pkg of packages) {
  const pkgDir = join(ROOT, "packages", pkg);
  const tsconfigPath = join(pkgDir, "tsconfig.json");

  if (!existsSync(tsconfigPath)) {
    console.log(`⏭️  ${pkg} — tsconfig.json not found, skipping`);
    continue;
  }

  console.log(`🔍 ${pkg} — type-checking...`);

  try {
    if (checker.name === "tsgo") {
      await $`tsgo --noEmit --project ${tsconfigPath}`.quiet();
    } else {
      await $`tsc --noEmit --project ${tsconfigPath}`.quiet();
    }
    console.log(`✅ ${pkg} — no errors`);
  } catch (err: unknown) {
    hasError = true;
    console.error(`❌ ${pkg} — type errors found:\n`);
    const shellErr = err as { stdout?: Buffer; stderr?: Buffer };
    if (shellErr.stdout) {
      console.error(shellErr.stdout.toString());
    }
    if (shellErr.stderr) {
      console.error(shellErr.stderr.toString());
    }
  }
}

const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(1);

if (hasError) {
  console.error(`\n❌ Type check failed in ${elapsedSec}s (checker: ${checker.name}).`);
  process.exit(1);
} else {
  console.log(`\n✅ All packages passed type check in ${elapsedSec}s (checker: ${checker.name}).`);
}
