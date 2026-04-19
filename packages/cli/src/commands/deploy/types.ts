/**
 * Deploy adapter interface + shared types.
 *
 * Phase 13.1 — `mandu deploy` subsystem. Each target platform (docker,
 * fly, vercel, railway, netlify, cf-pages, docker-compose) ships as its
 * own adapter behind the {@link DeployAdapter} contract so new providers
 * can be added without touching the dispatcher.
 *
 * ## Pipeline contract
 *
 * ```
 *   check()    — validate the project + toolchain (no writes)
 *   prepare()  — emit config artifacts (idempotent, --dry-run safe)
 *   deploy()   — optional: spawn the provider CLI (requires --execute)
 * ```
 *
 * ## Error model
 *
 * Every adapter operation returns a discriminated result rather than
 * throwing, so the caller can render a structured report + pick the
 * correct CLI exit code. `CLI_ERROR_CODES.DEPLOY_*` back the surface
 * strings to keep parity with the rest of the CLI error catalogue.
 *
 * @module cli/commands/deploy/types
 */
import type { RoutesManifest } from "@mandujs/core";
import type { ValidatedManduConfig } from "@mandujs/core/config/validate";

// =====================================================================
// Environments + targets
// =====================================================================

export const DEPLOY_TARGETS = [
  "docker",
  "fly",
  "vercel",
  "railway",
  "netlify",
  "cf-pages",
  "docker-compose",
] as const;

export type DeployTarget = (typeof DEPLOY_TARGETS)[number];

export function isDeployTarget(value: unknown): value is DeployTarget {
  return typeof value === "string" && (DEPLOY_TARGETS as readonly string[]).includes(value);
}

export const DEPLOY_ENVIRONMENTS = ["production", "staging", "preview"] as const;
export type DeployEnvironment = (typeof DEPLOY_ENVIRONMENTS)[number];

export function isDeployEnvironment(value: unknown): value is DeployEnvironment {
  return (
    typeof value === "string" &&
    (DEPLOY_ENVIRONMENTS as readonly string[]).includes(value)
  );
}

// =====================================================================
// Context passed to adapters
// =====================================================================

/**
 * Everything an adapter needs to inspect the project. Adapters must not
 * mutate this object — it's shared across calls within a single
 * `mandu deploy` invocation.
 */
export interface ProjectContext {
  /** Absolute project root. */
  readonly rootDir: string;
  /** Validated `mandu.config` (or defaults). */
  readonly config: ValidatedManduConfig;
  /**
   * Routes manifest. Optional because `check()` runs before `build()`;
   * `prepare()` and `deploy()` receive it after a successful build.
   */
  readonly manifest?: RoutesManifest;
  /** Project name (from package.json or inferred from rootDir). */
  readonly projectName: string;
  /**
   * Whether `public/` exists at the project root. Set once at context
   * creation so adapters don't re-stat the directory.
   */
  readonly hasPublicDir: boolean;
  /**
   * Whether Tailwind is in use (drives CSS path choices in some
   * adapters). Mirrors `isTailwindProject(rootDir)`.
   */
  readonly hasTailwind: boolean;
}

// =====================================================================
// Options
// =====================================================================

/**
 * Per-invocation deploy options. Most fields come from CLI flags; adapters
 * are free to ignore fields that don't apply to them.
 */
export interface DeployOptions {
  /** Target platform (`docker`, `fly`, etc.). */
  target: DeployTarget;
  /** Environment name (default: `production`). */
  env?: DeployEnvironment;
  /**
   * Project name override. Useful when the provider requires a different
   * slug than the `package.json` `name` field (e.g. Fly app, Workers
   * project, Vercel project).
   */
  projectName?: string;
  /**
   * Dry-run mode: run `check()` + `prepare()`, never invoke `deploy()`.
   * Artifacts are still written so the user can inspect them.
   */
  dryRun?: boolean;
  /**
   * Opt-in `deploy()` execution. Without this flag `prepare()` is the
   * last step — consistent with other CLIs (e.g. `terraform plan`).
   */
  execute?: boolean;
  /**
   * Verbose output. Secrets are masked regardless.
   */
  verbose?: boolean;
  /**
   * Override the working directory — mostly used by tests.
   */
  cwd?: string;
  /**
   * Set-secret mode: stash `KEY=VALUE` pairs in the OS keychain under the
   * current adapter's service name. Skips the rest of the pipeline.
   */
  setSecrets?: ReadonlyArray<string>;
  /**
   * Wave R3 M-01 — secret-leak guard map populated by the dispatcher before
   * `prepare()`. Adapters that render artifact bodies MUST forward this map
   * to every `writeArtifact` call so the `forbiddenValues` guard can reject
   * a regression that accidentally inlines a secret value into an artifact.
   */
  forbiddenSecrets?: ReadonlyMap<string, string>;
}

// =====================================================================
// Adapter result shapes
// =====================================================================

export interface AdapterIssue {
  /** Stable CLI error code if the issue is fatal (for exit mapping). */
  code?: string;
  /** Short human-readable reason (one line). */
  message: string;
  /**
   * Remediation hint — rendered after the issue. Keep it actionable.
   */
  hint?: string;
}

export interface AdapterCheckResult {
  ok: boolean;
  errors: AdapterIssue[];
  warnings: AdapterIssue[];
}

export interface AdapterArtifact {
  /** Absolute path to the written file. */
  path: string;
  /** Artifact description (printed in `--verbose`). */
  description?: string;
  /** `true` if the file existed before and was preserved. */
  preserved?: boolean;
}

export interface DeployResult {
  ok: boolean;
  /** Deployment URL when the provider emits one. */
  url?: string;
  /** Provider-specific deployment id (e.g. Vercel deployment id). */
  deploymentId?: string;
  /** Non-fatal warnings collected during execution. */
  warnings?: AdapterIssue[];
  /** Fatal errors (present when `ok === false`). */
  errors?: AdapterIssue[];
}

/**
 * Declaration of a secret an adapter needs to deploy. The dispatcher
 * uses this list to (a) prompt for missing values, (b) wire `Bun.secrets`
 * lookups, and (c) enforce never-writing-secrets-to-disk invariant.
 */
export interface SecretSpec {
  /** Environment variable name (`VERCEL_TOKEN`, `FLY_API_TOKEN`, …). */
  name: string;
  /** Whether the secret is required for `deploy()` to succeed. */
  required: boolean;
  /** Human description, rendered when the secret is missing. */
  description: string;
  /**
   * URL pointing at the provider's token-issuance docs. Shown beside the
   * description so users can get a token without leaving the terminal.
   */
  docsUrl?: string;
}

// =====================================================================
// Adapter contract
// =====================================================================

export interface DeployAdapter {
  /** Human-friendly adapter name for logs. */
  readonly name: string;
  /** Target identifier (matches `DeployTarget`). */
  readonly target: DeployTarget;
  /**
   * Minimum version of the provider CLI required to `deploy()`. When the
   * adapter doesn't spawn a provider CLI, leave this as `null`.
   */
  readonly minimumCliVersion: { binary: string; semver: string } | null;
  /**
   * Secrets the adapter consumes. Used for `--dry-run` previews and for
   * `Bun.secrets` plumbing. Order is preserved in output.
   */
  readonly secrets: ReadonlyArray<SecretSpec>;
  /**
   * Fast validation step — no writes, no network. Adapters should fail
   * fast here when the project obviously isn't ready (missing manifest,
   * wrong runtime, etc.).
   */
  check(project: ProjectContext, options: DeployOptions): Promise<AdapterCheckResult>;
  /**
   * Emit config files (Dockerfile, fly.toml, netlify.toml, …). Must be
   * idempotent — re-running `prepare()` should produce the same tree.
   * Returning `preserved: true` on an artifact indicates the adapter
   * detected existing user-authored content and refused to overwrite.
   */
  prepare(project: ProjectContext, options: DeployOptions): Promise<AdapterArtifact[]>;
  /**
   * Optional: invoke the provider CLI. Gated behind `--execute`. Adapters
   * without a deploy primitive should omit this field (the dispatcher
   * reports a friendly "prepare-only adapter" message instead).
   */
  deploy?(project: ProjectContext, options: DeployOptions): Promise<DeployResult>;
}

// =====================================================================
// Registry
// =====================================================================

export class DeployAdapterRegistry {
  private readonly adapters = new Map<DeployTarget, DeployAdapter>();

  register(adapter: DeployAdapter): void {
    if (this.adapters.has(adapter.target)) {
      throw new Error(
        `DeployAdapterRegistry: duplicate registration for "${adapter.target}"`
      );
    }
    this.adapters.set(adapter.target, adapter);
  }

  get(target: DeployTarget): DeployAdapter | undefined {
    return this.adapters.get(target);
  }

  list(): DeployAdapter[] {
    return Array.from(this.adapters.values()).sort((a, b) =>
      a.target.localeCompare(b.target)
    );
  }

  has(target: DeployTarget): boolean {
    return this.adapters.has(target);
  }

  size(): number {
    return this.adapters.size;
  }
}
