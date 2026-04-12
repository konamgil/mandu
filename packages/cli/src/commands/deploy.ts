/**
 * mandu deploy - Pre-deployment validation and artifact generation
 *
 * Pipeline: guard-check -> build -> deployment artifacts
 * Supports --target docker (Dockerfile) and --target fly (fly.toml).
 */
import { validateAndReport, checkDirectory, type GuardConfig } from "@mandujs/core";
import { resolveFromCwd } from "../util/fs";
import path from "path";
import fs from "fs/promises";

export interface DeployOptions { target?: string }

const DOCKERFILE = `FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY . .
RUN bun run build
EXPOSE 3333
CMD ["bun", "run", "start"]
`;

const FLY_TOML = `app = "mandu-app"
primary_region = "nrt"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3333
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0
`;

export async function deploy(options: DeployOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  console.log("🚀 Mandu Deploy\n");

  const config = await validateAndReport(rootDir);
  if (!config) { console.error("❌ Config validation failed."); return false; }

  // Architecture guard check
  const preset = config.guard?.preset ?? "mandu";
  const guardCfg: GuardConfig = {
    preset, srcDir: config.guard?.srcDir ?? "src", exclude: config.guard?.exclude,
  };
  const report = await checkDirectory(guardCfg, rootDir);
  if (report.bySeverity.error > 0) {
    console.error(`❌ Guard: ${report.bySeverity.error} error(s). Fix before deploying.`);
    return false;
  }
  console.log(`  ✅ Guard passed (${preset})`);

  // Build
  const { build } = await import("./build");
  if (!(await build())) { console.error("❌ Build failed."); return false; }

  // Target-specific artifact generation
  const { target } = options;
  if (target === "docker" || target === "fly") {
    await fs.writeFile(path.join(rootDir, "Dockerfile"), DOCKERFILE);
    if (target === "fly") {
      await fs.writeFile(path.join(rootDir, "fly.toml"), FLY_TOML);
    }
    console.log(`\n📦 Generated ${target === "fly" ? "Dockerfile + fly.toml" : "Dockerfile"}`);
  }

  console.log("\n✅ Deploy preparation complete.");
  return true;
}
