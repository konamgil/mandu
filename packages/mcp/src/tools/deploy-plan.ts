/**
 * MCP tools — deploy intent inspection & compile.
 *
 * Issue #250 — Phase 1 follow-up.
 *
 * Two read-mostly tools agents use to drive Mandu's deploy pipeline:
 *
 *   - `mandu.deploy.plan` — run the heuristic inferer over the routes
 *     manifest and the existing intent cache. Returns the next cache
 *     + a per-route diff. Default is read-only (`apply: false`); pass
 *     `apply: true` to atomically write `.mandu/deploy.intent.json`.
 *
 *   - `mandu.deploy.compile` — compile the manifest + cache into a
 *     concrete `vercel.json` (other targets land in subsequent
 *     phases). Returns the config object, the per-route summary, and
 *     compile warnings. Read-only — never writes vercel.json.
 *
 * The two tools share the same `@mandujs/core/deploy` engine the CLI
 * uses, so agents and humans see identical results. Going through the
 * core API rather than spawning the CLI keeps the response structured
 * and avoids a child-process roundtrip.
 *
 * @see packages/cli/src/commands/deploy/plan.ts — interactive CLI
 * @see packages/cli/src/commands/deploy/adapters/vercel.ts — adapter
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  compileVercelJson,
  emptyDeployIntentCache,
  inferDeployIntentWithBrain,
  isStaticIntentValidFor,
  loadDeployIntentCache,
  planDeploy,
  saveDeployIntentCache,
  VercelCompileError,
  buildDeployInferenceContext,
  type DeployIntent,
  type DeployIntentCache,
  type PlanDiffEntry,
  type VercelCompileResult,
} from "@mandujs/core/compat/deploy/index";
import {
  generateManifest,
  loadManifest,
  type RoutesManifest,
} from "@mandujs/core";
import { resolveBrainAdapter } from "@mandujs/core/compat/brain/index";
import path from "node:path";

/**
 * Resolve the routes manifest for the project.
 *
 * Prefer the on-disk `.mandu/routes.manifest.json` (fast, written by
 * `mandu build` / `mandu dev`). When that's missing, scan `app/`
 * directly via `generateManifest()` so the tool keeps working in a
 * fresh checkout. Returns `{ manifest, error }` — the error surface
 * is `null` when at least one path succeeded, otherwise it carries
 * the most specific reason so the MCP response can guide the agent.
 */
async function resolveManifestForTooling(
  projectRoot: string,
): Promise<{ manifest: RoutesManifest | null; error: string | null }> {
  const manifestPath = path.join(projectRoot, ".mandu", "routes.manifest.json");
  try {
    const result = await loadManifest(manifestPath);
    if (result.success && result.data) {
      return { manifest: result.data, error: null };
    }
    // Fall through to fs scan if the on-disk manifest is missing/malformed.
  } catch {
    // Fall through.
  }
  try {
    const result = await generateManifest(projectRoot);
    return { manifest: result.manifest, error: null };
  } catch (err) {
    return {
      manifest: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── deploy.plan ──────────────────────────────────────────────────────

interface DeployPlanInput {
  /**
   * When true, write the next cache to `.mandu/deploy.intent.json`.
   * Default false — agents should review the diff and call again with
   * `apply: true` only after the human sign-off.
   */
  apply?: boolean;
  /** Force re-inference even on unchanged source hashes. */
  reinfer?: boolean;
  /**
   * Wrap the heuristic with the OAuth-backed brain adapter. Falls
   * back to heuristic-only when no cloud token is available — the
   * MCP response surfaces this in `brain_status`.
   */
  use_brain?: boolean;
}

interface DeployPlanResultPayload {
  /** ISO timestamp the inferer wrote into the next cache. */
  generated_at: string;
  /** Identifier of the inferer (e.g. `heuristic`, `openai+heuristic`). */
  brain_model: string;
  /**
   * Diagnostic for `use_brain: true` calls. Tells the agent whether
   * the brain actually ran or the call fell back to heuristic.
   *   - `"used:openai"` / `"used:anthropic"` — brain ran.
   *   - `"unavailable:needs_login"` — call `mandu brain login` first.
   *   - `"unavailable:opted_out"` — telemetryOptOut is set in config.
   *   - `"not_requested"` — `use_brain: false` (default).
   */
  brain_status: string;
  /** Per-route diff suitable for rendering as a table. */
  diff: Array<{
    route_id: string;
    pattern: string;
    kind: PlanDiffEntry["kind"];
    runtime?: DeployIntent["runtime"];
    previous_runtime?: DeployIntent["runtime"];
    rationale?: string;
    source?: "explicit" | "inferred";
  }>;
  /** Validation warnings (intent vs route shape). */
  warnings: string[];
  /** Total intents in the next cache. */
  intent_count: number;
  /** Whether the cache file was actually written. */
  applied: boolean;
}

async function deployPlanHandler(
  projectRoot: string,
  input: DeployPlanInput,
): Promise<DeployPlanResultPayload | { error: string; hint?: string }> {
  const apply = input.apply === true;
  const reinfer = input.reinfer === true;

  const { manifest, error: manifestError } = await resolveManifestForTooling(projectRoot);
  if (!manifest) {
    return {
      error: `Routes manifest could not be resolved: ${manifestError ?? "unknown reason"}`,
      hint: "Run `mandu build` (or ensure `app/` exists with at least one route) before calling deploy tools.",
    };
  }

  let previous: DeployIntentCache;
  try {
    previous = await loadDeployIntentCache(projectRoot);
  } catch (err) {
    return {
      error: `Failed to load .mandu/deploy.intent.json: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Delete or restore the file, then call `mandu.deploy.plan` again.",
    };
  }

  // Resolve the inferer. `use_brain` opts into the cloud refinement
  // path; on missing tokens or telemetryOptOut we fall back silently
  // and tell the agent via `brain_status`.
  let infer: Parameters<typeof planDeploy>[0]["infer"] | undefined;
  let brainModel = "heuristic";
  let brainStatus = "not_requested";
  if (input.use_brain === true) {
    const resolution = await resolveBrainAdapter({
      adapter: "auto",
      projectRoot,
    });
    if (resolution.resolved === "template") {
      brainStatus = resolution.needsLogin ? "unavailable:needs_login" : "unavailable:opted_out";
    } else {
      infer = inferDeployIntentWithBrain({ adapter: resolution.adapter });
      brainModel = `${resolution.resolved}+heuristic`;
      brainStatus = `used:${resolution.resolved}`;
    }
  }

  const result = await planDeploy({
    rootDir: projectRoot,
    manifest,
    previous,
    reinfer,
    brainModel,
    infer,
  });

  // Validate every entry against route shape so agents see the same
  // warnings the CLI surfaces.
  const warnings: string[] = [];
  for (const route of manifest.routes) {
    const entry = result.cache.intents[route.id];
    if (!entry) continue;
    const ctx = await buildDeployInferenceContext(projectRoot, route);
    const validation = isStaticIntentValidFor(entry.intent, {
      isDynamic: ctx.isDynamic,
      hasGenerateStaticParams: ctx.hasGenerateStaticParams,
      kind: ctx.kind,
    });
    if (!validation.ok) {
      warnings.push(`${route.id} (${route.pattern}): ${validation.reason}`);
    }
  }

  if (apply) {
    await saveDeployIntentCache(projectRoot, result.cache);
  }

  return {
    generated_at: result.cache.generatedAt,
    brain_model: result.cache.brainModel,
    brain_status: brainStatus,
    diff: result.diff.map((d) => ({
      route_id: d.routeId,
      pattern: d.pattern,
      kind: d.kind,
      runtime: d.next?.intent.runtime,
      previous_runtime: d.previous?.intent.runtime,
      rationale: d.next?.rationale,
      source: d.next?.source,
    })),
    warnings,
    intent_count: Object.keys(result.cache.intents).length,
    applied: apply,
  };
}

// ─── deploy.compile ───────────────────────────────────────────────────

interface DeployCompileInput {
  /** Adapter target. Only `vercel` is supported in M3. */
  target?: "vercel";
  /** Project name override (Mandu bookkeeping; not emitted into output). */
  project_name?: string;
}

interface DeployCompileResultPayload {
  target: "vercel";
  /** Concrete vercel.json contents the adapter would write. */
  config: VercelCompileResult["config"];
  /** Compile warnings (e.g. #248 runtime gaps). */
  warnings: string[];
  /** Per-route summary the CLI prints in dry-run. */
  per_route: VercelCompileResult["perRoute"];
}

async function deployCompileHandler(
  projectRoot: string,
  input: DeployCompileInput,
): Promise<DeployCompileResultPayload | { error: string; hint?: string; routes?: ReadonlyArray<{ route_id: string; reason: string }> }> {
  const target = input.target ?? "vercel";
  if (target !== "vercel") {
    return {
      error: `Target "${target}" not supported yet. Phase 1 ships the Vercel compiler only.`,
      hint: "Pass target=\"vercel\" or wait for the Fly compiler in Phase 2.",
    };
  }

  const { manifest, error: manifestError } = await resolveManifestForTooling(projectRoot);
  if (!manifest) {
    return {
      error: `Routes manifest could not be resolved: ${manifestError ?? "unknown reason"}`,
      hint: "Run `mandu build` (or ensure `app/` exists with at least one route) before calling deploy tools.",
    };
  }

  let cache: DeployIntentCache;
  try {
    cache = await loadDeployIntentCache(projectRoot);
  } catch (err) {
    return {
      error: `Failed to load .mandu/deploy.intent.json: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Run `mandu.deploy.plan` (with apply=true) first, then re-run `mandu.deploy.compile`.",
    };
  }
  if (Object.keys(cache.intents).length === 0) {
    cache = emptyDeployIntentCache();
    return {
      error: "Intent cache is empty",
      hint: "Run `mandu.deploy.plan` with apply=true to populate .mandu/deploy.intent.json first.",
    };
  }

  const projectName = input.project_name ?? deriveProjectName(projectRoot);
  try {
    const result = compileVercelJson(manifest, cache, { projectName });
    return {
      target: "vercel",
      config: result.config,
      warnings: result.warnings,
      per_route: result.perRoute,
    };
  } catch (err) {
    if (err instanceof VercelCompileError) {
      return {
        error: "Vercel compile failed",
        hint: "Resolve the per-route reasons below — usually by re-running `mandu.deploy.plan` with apply=true after editing the offending route.",
        routes: err.routes.map((r) => ({ route_id: r.routeId, reason: r.reason })),
      };
    }
    throw err;
  }
}

function deriveProjectName(projectRoot: string): string {
  // Mirror the CLI's default — last path segment, sanitised.
  const last = projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? "mandu-project";
  return last.toLowerCase().replace(/[^a-z0-9-_]/g, "-").slice(0, 100);
}

// ─── MCP definitions + handlers ───────────────────────────────────────

export const deployPlanToolDefinitions: Tool[] = [
  {
    name: "mandu.deploy.plan",
    description:
      "Infer DeployIntent for every route via the offline heuristic and (optionally) write `.mandu/deploy.intent.json`. Returns the per-route diff plus validation warnings. Default `apply: false` is read-only — agents should review before persisting. The `reinfer` flag forces re-inference even on unchanged source hashes.",
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        apply: {
          type: "boolean",
          description:
            "When true, atomically write the next cache to `.mandu/deploy.intent.json`. Default false (preview-only).",
        },
        reinfer: {
          type: "boolean",
          description: "Force re-inference even on unchanged source hashes.",
        },
        use_brain: {
          type: "boolean",
          description:
            "Wrap the heuristic with the OAuth-backed brain adapter (issue #250 M4). Falls back to heuristic when no cloud token is reachable; the response's `brain_status` tells you which path actually ran.",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.deploy.compile",
    description:
      "Compile the routes manifest + `.mandu/deploy.intent.json` into a concrete `vercel.json`. Returns the config object, per-route summary, and compile warnings (e.g. runtime gaps from issue #248). Read-only — does not write vercel.json. Phase 1 supports `target: \"vercel\"` only.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["vercel"],
          description: "Adapter target. Phase 1 supports vercel only.",
        },
        project_name: {
          type: "string",
          description:
            "Project name override (Mandu bookkeeping; never emitted into vercel.json). Defaults to the directory name.",
        },
      },
      required: [],
    },
  },
];

export function deployPlanTools(projectRoot: string) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.deploy.plan": async (args) =>
      deployPlanHandler(projectRoot, args as DeployPlanInput),
    "mandu.deploy.compile": async (args) =>
      deployCompileHandler(projectRoot, args as DeployCompileInput),
  };
  return handlers;
}
