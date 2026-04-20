/**
 * Mandu MCP - Composite Tools
 * Multi-step workflow tools combining existing handlers into single-call operations.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getProjectPaths } from "../utils/project.js";
import { specTools } from "./spec.js";
import { guardTools } from "./guard.js";
import { negotiateTools } from "./negotiate.js";
import { contractTools } from "./contract.js";
import { generateTools } from "./generate.js";
import { kitchenTools } from "./kitchen.js";
import { ateTools } from "./ate.js";
import { requestRuntimeCache } from "../utils/runtime-control.js";
import { requireLock } from "../tx-lock.js";
import { runExtendedDiagnose, buildReport, type DiagnoseCheckResult } from "@mandujs/core/diagnose";
import path from "path";
import fs from "fs/promises";

export const compositeToolDefinitions: Tool[] = [
  {
    name: "mandu.feature.create",
    description:
      "Create a complete feature: route + contract + slot + island scaffold in one call. " +
      "Sequentially runs: negotiate -> add_route -> create_contract -> generate -> guard_check.",
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Feature name (English kebab-case)" },
        description: { type: "string", description: "Feature description" },
        kind: { type: "string", enum: ["page", "api", "both"], description: "Route kind (default: both)" },
        methods: { type: "array", items: { type: "string" }, description: "HTTP methods (default: ['GET', 'POST'])" },
        withContract: { type: "boolean", description: "Create Zod contract file (default: true)" },
        withIsland: { type: "boolean", description: "Create island component (default: false)" },
      },
      required: ["name", "description"],
    },
  },
  {
    name: "mandu.diagnose",
    description:
      "Run all diagnostic checks in parallel and return a unified health report. " +
      "Legacy checks: kitchen_errors + guard_check + validate_contracts + validate_manifest. " +
      "Extended checks (Issue #215): manifest_freshness, prerender_pollution, cloneelement_warnings, " +
      "dev_artifacts_in_prod, package_export_gaps. Every check uses the unified " +
      "{ ok, rule, severity, message, suggestion?, details? } shape. " +
      "`healthy: false` when any check has severity='error'; warnings do not block.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        autoFix: { type: "boolean", description: "Attempt automatic fixes for guard violations (default: false)" },
      },
    },
  },
  {
    name: "mandu.island.add",
    description:
      "Create an island component with correct @mandujs/core/client imports and hydration strategy. " +
      "Generates a .island.tsx file in app/{route}/ with the island() wrapper.",
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Island component name (PascalCase)" },
        route: { type: "string", description: "Route path to attach to (e.g. 'blog/[slug]')" },
        strategy: { type: "string", enum: ["load", "idle", "visible", "media", "never"], description: "Hydration strategy (default: visible)" },
      },
      required: ["name", "route"],
    },
  },
  {
    name: "mandu.middleware.add",
    description:
      "Create a middleware.ts file from a preset template (jwt, cors, auth, default). " +
      "Checks if middleware.ts already exists before writing to avoid overwriting.",
    annotations: {
      destructiveHint: false,
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: ["jwt", "cors", "auth", "default"], description: "Middleware preset template" },
        options: { type: "object", additionalProperties: { type: "string" }, description: "Extra options passed into the template" },
      },
      required: ["preset"],
    },
  },
  {
    name: "mandu.test.route",
    description:
      "Run the ATE test pipeline on a single route: extract -> generate -> run -> report. " +
      "Set quick=true to skip extraction and use cached data.",
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        routeId: { type: "string", description: "Route ID to test (e.g. 'api-users', 'blog-slug')" },
        quick: { type: "boolean", description: "Skip extraction, reuse cached graph (default: false)" },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu.deploy.check",
    description:
      "Pre-deployment validation: runs guard, contract, and manifest checks in parallel. " +
      "Returns a structured readiness report with pass/fail per check and any blockers.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["bun", "docker", "node"], description: "Deployment target (informational, default: bun)" },
      },
    },
  },
  {
    name: "mandu.cache.manage",
    description:
      "Cache management operations. 'stats' reads cache info from Kitchen endpoint. " +
      "'clear' explains that runtime cache requires server restart or revalidatePath/Tag.",
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["stats", "clear"], description: "Cache operation" },
        path: { type: "string", description: "Route path to target (for selective clear)" },
        tag: { type: "string", description: "Cache tag to target (for tag-based clear)" },
      },
      required: ["action"],
    },
  },
];

/** Extract an error message from an unknown thrown value. */
function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function compositeTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);
  const spec = specTools(projectRoot);
  const guard = guardTools(projectRoot);
  const neg = negotiateTools(projectRoot);
  const contract = contractTools(projectRoot);
  const generate = generateTools(projectRoot);
  const kitchen = kitchenTools(projectRoot);
  const ate = ateTools(projectRoot);

  return {
    "mandu.feature.create": async (args: Record<string, unknown>) => {
      const lockCheck = requireLock(args.lockId as string | undefined);
      if (!lockCheck.allowed) {
        return { error: lockCheck.error, hint: "Use mandu.tx.begin to acquire a lock first" };
      }
      const { name, description, kind = "both", methods = ["GET", "POST"],
        withContract = true, withIsland = false,
      } = args as {
        name: string; description: string; kind?: "page" | "api" | "both";
        methods?: string[]; withContract?: boolean; withIsland?: boolean;
      };
      const steps: Array<{ step: string; success: boolean; result?: unknown; error?: string }> = [];
      const kinds: Array<"page" | "api"> = kind === "both" ? ["api", "page"] : [kind];

      // Step 1: negotiate architecture
      try {
        const result = await neg["mandu.negotiate"]({ intent: description, featureName: name });
        steps.push({ step: "negotiate", success: true, result });
      } catch (e) {
        steps.push({ step: "negotiate", success: false, error: toErrorMessage(e) });
        return { success: false, feature: name, steps, failedAt: "negotiate" };
      }

      // Step 2-3: add routes + contracts
      for (const k of kinds) {
        const routePath = k === "api" ? `api/${name}` : name;
        const stepName = `add_route(${k})`;

        try {
          const result = await spec["mandu.route.add"]({ path: routePath, kind: k, withSlot: true, withContract: false });
          steps.push({ step: stepName, success: true, result });
        } catch (e) {
          steps.push({ step: stepName, success: false, error: toErrorMessage(e) });
          return { success: false, feature: name, steps, failedAt: stepName };
        }

        if (withContract && k === "api") {
          const routeId = routePath.replace(/\//g, "-").replace(/[\[\]\.]/g, "");
          try {
            const result = await contract["mandu.contract.create"]({ routeId, description, methods });
            steps.push({ step: "create_contract", success: true, result });
          } catch (e) {
            steps.push({ step: "create_contract", success: false, error: toErrorMessage(e) });
            return { success: false, feature: name, steps, failedAt: "create_contract" };
          }
        }
      }

      // Step 4: generate
      try {
        const result = await generate["mandu.generate"]({ dryRun: false });
        steps.push({ step: "generate", success: true, result });
      } catch (e) {
        steps.push({ step: "generate", success: false, error: toErrorMessage(e) });
        return { success: false, feature: name, steps, failedAt: "generate" };
      }

      // Step 5: guard_check
      try {
        const result = await guard["mandu.guard.check"]({ autoCorrect: false });
        steps.push({ step: "guard_check", success: true, result });
      } catch (e) {
        steps.push({ step: "guard_check", success: false, error: toErrorMessage(e) });
        return { success: false, feature: name, steps, failedAt: "guard_check" };
      }

      // Step 6 (optional): create island
      if (withIsland && kinds.includes("page")) {
        const pc = toPascalCase(name);
        const islandFile = path.join(paths.appDir, name, `${pc}.island.tsx`);
        try {
          await fs.mkdir(path.dirname(islandFile), { recursive: true });
          await Bun.write(islandFile, generateIslandSource(pc, "visible"));
          steps.push({ step: "create_island", success: true, result: { file: `app/${name}/${pc}.island.tsx` } });
        } catch (e) {
          steps.push({ step: "create_island", success: false, error: toErrorMessage(e) });
          return { success: false, feature: name, steps, failedAt: "create_island" };
        }
      }

      return { success: true, feature: name, description, steps,
        summary: { routesCreated: kinds.length, contractCreated: withContract, islandCreated: withIsland && kinds.includes("page") } };
    },

    "mandu.diagnose": async (args: Record<string, unknown>) => {
      const { autoFix = false } = args as { autoFix?: boolean };

      // Run legacy (structural) checks + extended (#215) checks in parallel.
      const [kitchenResult, guardResult, contractResult, manifestResult, extendedReport] = await Promise.all([
        kitchen["mandu.kitchen.errors"]({ clear: false }).catch((e: Error) => ({ error: e.message })),
        guard["mandu.guard.check"]({ autoCorrect: autoFix }).catch((e: Error) => ({ error: e.message })),
        contract["mandu.contract.validate"]({}).catch((e: Error) => ({ error: e.message })),
        spec["mandu.manifest.validate"]({}).catch((e: Error) => ({ error: e.message })),
        runExtendedDiagnose(projectRoot).catch((e: Error) => ({
          healthy: false,
          errorCount: 1,
          warningCount: 0,
          checks: [{ ok: false, rule: "diagnose_internal_error", severity: "error" as const, message: e.message }],
          summary: { total: 1, passed: 0, failed: 1 },
        })),
      ]);

      // Normalize each legacy check into the unified shape.
      const normalizeLegacy = (rule: string, result: unknown): DiagnoseCheckResult => {
        const r = (typeof result === "object" && result !== null) ? result as Record<string, unknown> : {};
        const errorMsg = typeof r.error === "string" ? r.error : undefined;
        const failed =
          !!errorMsg || r.passed === false || r.valid === false;
        if (!failed) {
          return {
            ok: true,
            rule,
            message: `${rule} passed`,
            details: r,
          };
        }
        return {
          ok: false,
          rule,
          severity: "error",
          message: errorMsg ?? `${rule} failed`,
          details: r,
        };
      };

      const legacyChecks: DiagnoseCheckResult[] = [
        normalizeLegacy("kitchen_errors", kitchenResult),
        normalizeLegacy("guard_check", guardResult),
        normalizeLegacy("contract_validation", contractResult),
        normalizeLegacy("manifest_validation", manifestResult),
      ];

      // Tighten manifest_validation by cross-checking against the fresh
      // bundle-manifest check. Legacy manifest_validation only inspects
      // the FS-routes manifest; it passes even when the bundle manifest
      // is stale (the #211 gap). If manifest_freshness is unhealthy,
      // legacy manifest_validation's pass is misleading — downgrade it.
      const freshness = extendedReport.checks.find((c) => c.rule === "manifest_freshness");
      if (freshness && !freshness.ok && freshness.severity === "error") {
        const legacyMv = legacyChecks.find((c) => c.rule === "manifest_validation");
        if (legacyMv && legacyMv.ok) {
          legacyMv.ok = false;
          legacyMv.severity = "warning";
          legacyMv.message = "FS-routes manifest loaded, but bundle manifest is stale (see manifest_freshness).";
          legacyMv.suggestion = "Run `mandu build` to regenerate the bundle manifest.";
        }
      }

      const allChecks: DiagnoseCheckResult[] = [...legacyChecks, ...extendedReport.checks];
      const report = buildReport(allChecks);

      return {
        healthy: report.healthy,
        autoFix,
        errorCount: report.errorCount,
        warningCount: report.warningCount,
        checks: report.checks,
        summary: report.summary,
      };
    },

    "mandu.island.add": async (args: Record<string, unknown>) => {
      const lockCheck = requireLock(args.lockId as string | undefined);
      if (!lockCheck.allowed) {
        return { error: lockCheck.error, hint: "Use mandu.tx.begin to acquire a lock first" };
      }
      const { name, route, strategy = "visible" } = args as {
        name: string; route: string; strategy?: "load" | "idle" | "visible" | "media" | "never";
      };
      const islandFileName = `${name}.island.tsx`;
      const islandRelPath = `app/${route}/${islandFileName}`;
      const islandFullPath = path.join(paths.appDir, route, islandFileName);

      try { await fs.access(islandFullPath); return { success: false, error: `Island file already exists: ${islandRelPath}` }; } catch { /* proceed */ }

      await fs.mkdir(path.dirname(islandFullPath), { recursive: true });
      await Bun.write(islandFullPath, generateIslandSource(name, strategy));
      return {
        success: true, file: islandRelPath, component: name, strategy,
        nextSteps: [`Import <${name} /> in app/${route}/page.tsx`, "Run mandu_build to compile the client bundle", `Island hydrates on '${strategy}'`],
      };
    },

    "mandu.middleware.add": async (args: Record<string, unknown>) => {
      const { preset, options = {} } = args as { preset: "jwt" | "cors" | "auth" | "default"; options?: Record<string, string> };
      const mwPath = path.join(paths.appDir, "middleware.ts");
      try { await fs.access(mwPath); return { created: false, error: "middleware.ts already exists", path: "app/middleware.ts" }; } catch { /* proceed */ }
      await fs.mkdir(path.dirname(mwPath), { recursive: true });
      await Bun.write(mwPath, generateMiddlewareSource(preset, options));
      return { created: true, path: "app/middleware.ts", preset };
    },

    "mandu.test.route": async (args: Record<string, unknown>) => {
      const { routeId, quick = false } = args as { routeId: string; quick?: boolean };
      const steps: { step: string; result: unknown }[] = [];
      if (!quick) {
        steps.push({ step: "extract", result: await ate["mandu.ate.extract"]({ repoRoot: projectRoot, routeGlobs: [`app/${routeId.replace(/-/g, "/")}/**`] }) });
      }
      steps.push({ step: "generate", result: await ate["mandu.ate.generate"]({ repoRoot: projectRoot, oracleLevel: "L1", onlyRoutes: [routeId] }) });
      const runResult = await ate["mandu.ate.run"]({ repoRoot: projectRoot }) as { runId?: string; startedAt?: string; finishedAt?: string; exitCode?: number };
      steps.push({ step: "run", result: runResult });
      const report = await ate["mandu.ate.report"]({
        repoRoot: projectRoot, runId: runResult.runId ?? "unknown",
        startedAt: runResult.startedAt ?? new Date().toISOString(), finishedAt: runResult.finishedAt ?? new Date().toISOString(),
        exitCode: runResult.exitCode ?? 1,
      });
      steps.push({ step: "report", result: report });
      const passed = runResult.exitCode === 0;
      let healSuggestions: unknown | undefined;
      if (!passed && runResult.runId) {
        healSuggestions = await ate["mandu.ate.heal"]({ repoRoot: projectRoot, runId: runResult.runId }).catch(() => undefined);
      }
      return { passed, routeId, results: steps, ...(healSuggestions ? { healSuggestions } : {}) };
    },

    "mandu.deploy.check": async (args: Record<string, unknown>) => {
      const { target = "bun" } = args as { target?: "bun" | "docker" | "node" };
      const [guardResult, contractResult, manifestResult] = await Promise.all([
        guard["mandu.guard.check"]({ autoCorrect: false }).catch((e: Error) => ({ error: e.message })),
        contract["mandu.contract.validate"]({}).catch((e: Error) => ({ error: e.message })),
        spec["mandu.manifest.validate"]({}).catch((e: Error) => ({ error: e.message })),
      ]);
      const status = (r: Record<string, unknown>): "pass" | "fail" => (r.error || r.passed === false || r.valid === false) ? "fail" : "pass";
      const checks = { guard: status(guardResult as Record<string, unknown>), contracts: status(contractResult as Record<string, unknown>), manifest: status(manifestResult as Record<string, unknown>) };
      const blockers: string[] = [];
      const warnings: string[] = [];
      if (checks.guard === "fail") blockers.push("Guard check failed — fix structural violations before deploying");
      if (checks.contracts === "fail") blockers.push("Contract validation failed — fix schema mismatches");
      if (checks.manifest === "fail") warnings.push("Manifest validation has issues — regenerate with mandu.generate");
      if (target === "docker") warnings.push("Ensure Dockerfile copies .mandu/generated/ into the image");
      if (target === "node") warnings.push("Node target requires Bun APIs to be polyfilled or avoided");
      return { ready: blockers.length === 0, target, checks, blockers, warnings };
    },

    "mandu.cache.manage": async (args: Record<string, unknown>) => {
      const { action, path: routePath, tag } = args as { action: "stats" | "clear"; path?: string; tag?: string };
      const kitchenResult = await kitchen["mandu.kitchen.errors"]({ clear: false }).catch(() => null);
      const kitchenInfo = isRecord(kitchenResult) ? kitchenResult : null;
      const runtimeResult = await requestRuntimeCache(projectRoot, action, {
        ...(routePath ? { path: routePath } : {}),
        ...(tag ? { tag } : {}),
        ...(action === "clear" && !routePath && !tag ? { all: true } : {}),
      }).catch(() => null);
      const runtimeBody = isRecord(runtimeResult?.body) ? runtimeResult.body : null;
      const serverStatus = runtimeResult?.response.ok ? "up" : kitchenInfo?.success === true ? "up" : "down";

      if (action === "stats") {
        return {
          action: "stats",
          serverStatus,
          mode: runtimeResult?.control.mode ?? null,
          stats: runtimeBody?.stats ?? null,
          kitchen: kitchenInfo,
          message: typeof runtimeBody?.message === "string"
            ? runtimeBody.message
            : typeof kitchenInfo?.message === "string"
              ? kitchenInfo.message
            : serverStatus === "up"
              ? "Runtime cache endpoint reachable — server is running."
              : "Runtime cache endpoint unreachable — start `mandu dev` or `mandu start` first.",
          hint: serverStatus === "up"
            ? "Use `mandu cache clear <path>` or `mandu cache clear --tag=<tag>` to invalidate runtime cache."
            : "Start `mandu dev` or `mandu start` before requesting cache diagnostics.",
        };
      }

      const target = routePath ? `path=${routePath}` : tag ? `tag=${tag}` : "all";
      return {
        action: "clear",
        target,
        serverStatus,
        mode: runtimeResult?.control.mode ?? null,
        cleared: typeof runtimeBody?.cleared === "number" ? runtimeBody.cleared : null,
        stats: runtimeBody?.stats ?? null,
        kitchen: kitchenInfo,
        message: typeof runtimeBody?.error === "string"
          ? runtimeBody.error
          : typeof runtimeBody?.message === "string"
            ? runtimeBody.message
            : runtimeResult?.response.ok
              ? "Runtime cache cleared successfully."
              : "Runtime cache endpoint is unavailable.",
        hint: serverStatus === "up"
          ? "Clear by path or tag against the running local server."
          : "Start the dev or production server first, then trigger revalidation or restart the process.",
      };
    },
  };
}

function toPascalCase(kebab: string): string {
  return kebab.split(/[-_]/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
}

function generateMiddlewareSource(preset: string, options: Record<string, string>): string {
  const templates: Record<string, string> = {
    jwt: `import type { MiddlewareHandler } from "@mandujs/core";\n\nexport const middleware: MiddlewareHandler = async (req, next) => {\n  const token = req.headers.get("Authorization")?.replace("Bearer ", "");\n  if (!token) return new Response("Unauthorized", { status: 401 });\n  // TODO: verify JWT token with your secret\n  return next(req);\n};\n`,
    cors: `import type { MiddlewareHandler } from "@mandujs/core";\n\nconst ALLOWED_ORIGINS = ${JSON.stringify(options.origins?.split(",") ?? ["*"])};\n\nexport const middleware: MiddlewareHandler = async (req, next) => {\n  const origin = req.headers.get("Origin") ?? "";\n  const res = await next(req);\n  if (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {\n    res.headers.set("Access-Control-Allow-Origin", origin || "*");\n    res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");\n    res.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");\n  }\n  return res;\n};\n`,
    auth: `import type { MiddlewareHandler } from "@mandujs/core";\n\nconst PUBLIC_PATHS = ["/", "/login", "/api/auth"];\n\nexport const middleware: MiddlewareHandler = async (req, next) => {\n  const url = new URL(req.url);\n  if (PUBLIC_PATHS.some((p) => url.pathname.startsWith(p))) return next(req);\n  const session = req.headers.get("Cookie")?.includes("session=");\n  if (!session) return Response.redirect(new URL("/login", req.url));\n  return next(req);\n};\n`,
    default: `import type { MiddlewareHandler } from "@mandujs/core";\n\nexport const middleware: MiddlewareHandler = async (req, next) => {\n  const start = Date.now();\n  const res = await next(req);\n  res.headers.set("X-Response-Time", \`\${Date.now() - start}ms\`);\n  return res;\n};\n`,
  };
  return templates[preset] ?? templates.default;
}

function generateIslandSource(name: string, strategy: string): string {
  return `"use client";
import { island } from "@mandujs/core/client";
import { useState } from "react";

interface ${name}Props {
  [key: string]: unknown;
}

function ${name}Inner(props: ${name}Props) {
  const [count, setCount] = useState(0);
  return (
    <div data-island="${name}">
      <p>Island: ${name}</p>
      <button onClick={() => setCount((c) => c + 1)}>Count: {count}</button>
    </div>
  );
}

export default island("${strategy}", ${name}Inner);
`;
}
