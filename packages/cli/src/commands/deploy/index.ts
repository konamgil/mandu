/**
 * `mandu deploy` — command entry.
 *
 * Pipeline:
 *
 *   1. Parse options (target / env / project / dry-run / execute / set-secret).
 *   2. Handle --set-secret mode up-front: stash pairs in OS keychain, exit.
 *   3. Validate mandu.config (fail early with CLI_E201).
 *   4. Architecture guard (unless --dry-run).
 *   5. Build (unless --dry-run — artifacts preview only).
 *   6. Adapter.check() → adapter.prepare() (always).
 *   7. Adapter.deploy() gated on --execute.
 *
 * The dispatcher **never** prints secret values. The only place a secret
 * touches disk is the `.mandu/secrets.json` fallback when `Bun.secrets`
 * is absent (which emits a one-shot warning — see `secret-bridge.ts`).
 *
 * @module cli/commands/deploy
 */
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { validateAndReport, checkDirectory, type GuardConfig } from "@mandujs/core";
import type { ValidatedManduConfig } from "@mandujs/core/config/validate";
import { CLI_ERROR_CODES } from "../../errors/codes";
import { resolveFromCwd } from "../../util/fs";
import { resolveManifest } from "../../util/manifest";
import {
  createBuiltinRegistry,
} from "./adapters";
import {
  createSecretBridge,
  maskSecret,
  parseSecretPair,
  SecretFormatError,
  type SecretBridge,
} from "./secret-bridge";
import {
  DEPLOY_TARGETS,
  isDeployEnvironment,
  isDeployTarget,
  type AdapterArtifact,
  type AdapterCheckResult,
  type DeployAdapter,
  type DeployAdapterRegistry,
  type DeployEnvironment,
  type DeployOptions,
  type DeployTarget,
  type ProjectContext,
  type SecretSpec,
} from "./types";

// =====================================================================
// CLI surface
// =====================================================================

export interface DeployCliOptions {
  /** Target platform. Required unless --help is set. */
  target?: string;
  /** Environment (defaults to "production"). */
  env?: string;
  /** Project name override. */
  project?: string;
  /** Preview only — skip build, emit artifacts, don't deploy. */
  dryRun?: boolean;
  /** Opt-in to provider-CLI deploy execution. */
  execute?: boolean;
  /** Print verbose diagnostics (secrets still masked). */
  verbose?: boolean;
  /** List form of `KEY=VALUE`. If present we run --set-secret mode. */
  setSecret?: string | string[];
  /** Override cwd — tests only. */
  cwd?: string;
  /** Injection point for tests. */
  registry?: DeployAdapterRegistry;
  /** Injection point for tests — bypass the real secret bridge. */
  bridge?: SecretBridge;
}

export interface DeploySummary {
  target: DeployTarget;
  env: DeployEnvironment;
  mode: "set-secret" | "dry-run" | "prepare" | "execute";
  projectName: string;
  artifacts: AdapterArtifact[];
  check?: AdapterCheckResult;
  executeOk?: boolean;
  missingSecrets: string[];
  storedSecrets: string[];
  /**
   * Non-null when the dispatcher short-circuited with a top-level error
   * — e.g. unknown target, guard failures, bad config.
   */
  fatal?: {
    code: string;
    message: string;
  };
}

/**
 * Main entry, registered from `registry.ts`. Returns `true` on success
 * (including `--dry-run` previews) and `false` on any fatal error.
 */
export async function deploy(options: DeployCliOptions = {}): Promise<boolean> {
  const cwd = options.cwd ? path.resolve(options.cwd) : resolveFromCwd(".");
  const registry = options.registry ?? createBuiltinRegistry();
  const log = createLogger(options.verbose === true);

  // ----- parse + validate options ------------------------------------
  const targetInput = options.target;
  if (!targetInput) {
    logUnknownTarget(undefined);
    return false;
  }
  if (!isDeployTarget(targetInput)) {
    logUnknownTarget(targetInput);
    return false;
  }

  const target: DeployTarget = targetInput;
  const adapter = registry.get(target);
  if (!adapter) {
    logUnknownTarget(target);
    return false;
  }

  const env: DeployEnvironment = isDeployEnvironment(options.env)
    ? options.env
    : "production";

  const setSecretList = normalizeSetSecrets(options.setSecret);

  // ----- set-secret mode: stash and exit -----------------------------
  if (setSecretList.length > 0) {
    const bridge =
      options.bridge ??
      createSecretBridge({ target, rootDir: cwd });
    const stored: string[] = [];
    for (const raw of setSecretList) {
      try {
        const { name, value } = parseSecretPair(raw);
        await bridge.set(name, value);
        stored.push(name);
        log.info(`  stored ${name}=${maskSecret(value)} (${bridge.backend})`);
      } catch (err) {
        if (err instanceof SecretFormatError) {
          log.error(`  ${err.message}`);
          return false;
        }
        throw err;
      }
    }
    console.log(`\n✅ Stored ${stored.length} secret(s) for target "${target}".`);
    return true;
  }

  // ----- configure deploy options  -----------------------------------
  const deployOptions: DeployOptions = {
    target,
    env,
    projectName: options.project,
    dryRun: options.dryRun === true,
    execute: options.execute === true,
    verbose: options.verbose === true,
    cwd,
  };

  // ----- header ------------------------------------------------------
  console.log(`\n🚀 Mandu Deploy — target=${target}, env=${env}${deployOptions.dryRun ? " (dry-run)" : ""}`);

  // ----- config load -------------------------------------------------
  const config = await validateAndReport(cwd);
  if (!config) {
    log.error(`Config validation failed (${CLI_ERROR_CODES.DEPLOY_CONFIG_INVALID}).`);
    return false;
  }

  // ----- project context ---------------------------------------------
  const projectName =
    deployOptions.projectName ??
    (await inferProjectName(cwd)) ??
    "mandu-app";
  const project: ProjectContext = {
    rootDir: cwd,
    config,
    projectName,
    hasPublicDir: existsSync(path.join(cwd, "public")),
    hasTailwind: existsSync(path.join(cwd, ".mandu/client/globals.css")),
  };

  // ----- guard -------------------------------------------------------
  if (!deployOptions.dryRun) {
    const guardOk = await runGuard(config, cwd);
    if (!guardOk) {
      log.error(`Architecture guard refused deploy (${CLI_ERROR_CODES.DEPLOY_GUARD_FAILED}).`);
      return false;
    }
  }

  // ----- build -------------------------------------------------------
  if (!deployOptions.dryRun) {
    const ok = await runBuild();
    if (!ok) {
      log.error(`Build failed (${CLI_ERROR_CODES.DEPLOY_BUILD_FAILED}).`);
      return false;
    }
    // After build, load manifest for adapters that can benefit (vercel /
    // cf-pages preflight). Failure here is non-fatal — adapters decide.
    try {
      const resolved = await resolveManifest(cwd, { fsRoutes: config.fsRoutes });
      (project as { manifest?: typeof resolved.manifest }).manifest = resolved.manifest;
    } catch (err) {
      log.warn(
        `  manifest load skipped: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ----- adapter.check() ---------------------------------------------
  console.log(`\n🔍 Adapter check: ${adapter.name}`);
  const checkResult = await adapter.check(project, deployOptions);
  renderCheckResult(checkResult, log);
  if (!checkResult.ok) {
    return false;
  }

  // ----- secret inventory --------------------------------------------
  const bridge =
    options.bridge ??
    createSecretBridge({ target, rootDir: cwd });
  const storedSecrets = await bridge.listStoredNames();
  const missingSecrets = adapter.secrets
    .filter((s) => s.required && !storedSecrets.includes(s.name))
    .map((s) => s.name);
  if (adapter.secrets.length > 0) {
    renderSecretsInventory(adapter.secrets, storedSecrets, missingSecrets, log);
  }

  // ----- forbidden-secret map (Wave R3 M-01) -------------------------
  const forbiddenSecrets = new Map<string, string>();
  for (const name of storedSecrets) {
    const value = await bridge.get(name);
    if (typeof value === "string" && value.length >= 8) {
      forbiddenSecrets.set(name, value);
    }
  }
  const prepareOptions: DeployOptions = {
    ...deployOptions,
    forbiddenSecrets,
  };

  // ----- adapter.prepare() -------------------------------------------
  console.log(`\n📦 Adapter prepare: ${adapter.name}`);
  let artifacts: AdapterArtifact[] = [];
  try {
    artifacts = await adapter.prepare(project, prepareOptions);
  } catch (err) {
    log.error(`  prepare failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  renderArtifacts(artifacts);

  // ----- dry-run short-circuit ---------------------------------------
  if (deployOptions.dryRun) {
    console.log(`\n✅ Dry-run complete. No provider CLI invoked.`);
    return true;
  }

  // ----- execute gate ------------------------------------------------
  if (!deployOptions.execute) {
    console.log(
      `\n✅ Artifacts prepared. Pass --execute to invoke the provider CLI (${adapter.name}).`
    );
    return true;
  }

  if (missingSecrets.length > 0) {
    log.error(
      `  cannot execute — missing secret(s): ${missingSecrets.join(", ")} (${CLI_ERROR_CODES.DEPLOY_SECRET_MISSING})`
    );
    return false;
  }

  if (!adapter.deploy) {
    log.error(
      `  adapter "${adapter.name}" is prepare-only — use the provider CLI directly ` +
        `(${CLI_ERROR_CODES.DEPLOY_NOT_IMPLEMENTED}).`
    );
    return false;
  }

  console.log(`\n🚢 Adapter deploy: ${adapter.name}`);
  const deployResult = await adapter.deploy(project, deployOptions);
  if (!deployResult.ok) {
    for (const issue of deployResult.errors ?? []) {
      log.error(`  ${issue.message}${issue.hint ? ` — ${issue.hint}` : ""}`);
    }
    return false;
  }
  if (deployResult.url) {
    console.log(`  🌐 ${deployResult.url}`);
  }
  if (deployResult.deploymentId) {
    console.log(`  id: ${deployResult.deploymentId}`);
  }
  console.log(`\n✅ Deploy complete.`);
  return true;
}

// =====================================================================
// Helpers (pure — exported for tests)
// =====================================================================

export function normalizeSetSecrets(
  input: string | string[] | undefined
): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.filter((s) => typeof s === "string");
  return [input];
}

function logUnknownTarget(target: string | undefined): void {
  console.error(
    `\n❌ Unsupported deploy target${target ? `: ${target}` : ""} (${CLI_ERROR_CODES.DEPLOY_UNSUPPORTED_TARGET})`
  );
  console.error(`   Supported: ${DEPLOY_TARGETS.join(", ")}`);
}

async function inferProjectName(rootDir: string): Promise<string | undefined> {
  try {
    const pkgRaw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
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

async function runGuard(
  config: ValidatedManduConfig,
  cwd: string
): Promise<boolean> {
  const preset = config.guard?.preset ?? "mandu";
  const guardCfg: GuardConfig = {
    preset,
    srcDir: config.guard?.srcDir ?? "src",
    exclude: config.guard?.exclude,
  };
  const report = await checkDirectory(guardCfg, cwd);
  if (report.bySeverity.error > 0) {
    console.error(`❌ Guard: ${report.bySeverity.error} error(s).`);
    return false;
  }
  console.log(`  ✅ Guard passed (${preset})`);
  return true;
}

async function runBuild(): Promise<boolean> {
  const { build } = await import("../build");
  return build();
}

// =====================================================================
// Rendering helpers
// =====================================================================

interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

function createLogger(verbose: boolean): Logger {
  return {
    info(message) {
      if (verbose) console.log(message);
    },
    warn(message) {
      console.warn(message);
    },
    error(message) {
      console.error(`❌ ${message}`);
    },
  };
}

function renderCheckResult(result: AdapterCheckResult, log: Logger): void {
  for (const issue of result.errors) {
    log.error(`  ${issue.message}${issue.hint ? ` — ${issue.hint}` : ""}`);
  }
  for (const issue of result.warnings) {
    log.warn(`  ⚠️  ${issue.message}${issue.hint ? ` (${issue.hint})` : ""}`);
  }
  if (result.ok && result.errors.length === 0 && result.warnings.length === 0) {
    console.log("  ✅ check passed");
  } else if (result.ok) {
    console.log("  ✅ check passed (with warnings above)");
  }
}

function renderSecretsInventory(
  specs: ReadonlyArray<SecretSpec>,
  stored: ReadonlyArray<string>,
  missing: ReadonlyArray<string>,
  log: Logger
): void {
  console.log(`\n🔐 Secrets:`);
  for (const spec of specs) {
    const present = stored.includes(spec.name);
    const marker = present ? "✅" : spec.required ? "❌" : "⚠️ ";
    console.log(`  ${marker} ${spec.name} — ${spec.description}`);
    if (!present && spec.docsUrl) {
      log.info(`     docs: ${spec.docsUrl}`);
    }
  }
  if (missing.length > 0) {
    console.log(
      `\n   Missing required: ${missing.join(", ")}. ` +
        `Set with: mandu deploy --target=... --set-secret NAME=value`
    );
  }
}

function renderArtifacts(artifacts: AdapterArtifact[]): void {
  for (const art of artifacts) {
    const marker = art.preserved ? "•" : "+";
    const rel = path.relative(process.cwd(), art.path) || art.path;
    const desc = art.description ? ` — ${art.description}` : "";
    console.log(`  ${marker} ${rel}${desc}`);
  }
}
