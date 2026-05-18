import fs from "fs/promises";
import path from "path";
import {
  CONFIG_FILES,
  loadManduConfig,
  type ManduConfig,
} from "../config";
import { RoutesManifest, type RouteSpec } from "../spec/schema";
import { scanRoutes } from "../router";
import { runExtendedDiagnose } from "../diagnose";
import type {
  AgentArtifactSummary,
  AgentCommandMap,
  AgentContext,
  AgentDiagnostic,
  AgentDiagnosticSeverity,
  AgentEnvFileSummary,
  AgentGitSummary,
  AgentGuardSummary,
  AgentManifest,
  AgentRouteSummary,
  BuildAgentContextOptions,
} from "./types";

const AGENT_MANIFEST_RELATIVE_PATH = path.join(".mandu", "agent-manifest.json");

const COMMANDS: AgentCommandMap = {
  context: "mandu agent context --json",
  manifest: "mandu agent manifest --write",
  plan: "mandu agent plan \"<task>\" --json",
  apply: "mandu agent apply --from .mandu/agent-plan.json",
  verify: "mandu agent verify --changed --json",
  repair: "mandu agent repair --from .mandu/agent-verify.json",
  sync: "mandu agent sync --target all",
};

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readPackageJson(rootDir: string): Promise<Record<string, unknown>> {
  return (await readJson<Record<string, unknown>>(path.join(rootDir, "package.json"))) ?? {};
}

async function detectConfigFile(rootDir: string): Promise<string | null> {
  for (const name of CONFIG_FILES) {
    if (await pathExists(path.join(rootDir, name))) {
      return name;
    }
  }
  return null;
}

async function loadConfig(rootDir: string): Promise<{
  config: ManduConfig | null;
  configFile: string | null;
  warning?: string;
}> {
  const configFile = await detectConfigFile(rootDir);
  if (!configFile) return { config: null, configFile: null };
  try {
    return { config: await loadManduConfig(rootDir), configFile };
  } catch (err) {
    return {
      config: null,
      configFile,
      warning: `Failed to load ${configFile}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function packageManagerFor(pkg: Record<string, unknown>): string {
  if (typeof pkg.packageManager === "string" && pkg.packageManager.length > 0) {
    return pkg.packageManager;
  }
  // Mandu is Bun-first. Prefer lockfile evidence before falling back.
  return "bun";
}

function summarizeGuard(config: ManduConfig | null): AgentGuardSummary {
  const guard = config?.guard;
  let customRules = 0;
  let ruleOverrides = 0;
  if (Array.isArray(guard?.rules)) {
    customRules = guard.rules.length;
  } else if (guard?.rules && typeof guard.rules === "object") {
    ruleOverrides = Object.keys(guard.rules).length;
  }
  return {
    preset: typeof guard?.preset === "string" ? guard.preset : null,
    customRules,
    ruleOverrides,
  };
}

function summarizeRoute(route: RouteSpec | {
  id: string;
  pattern: string;
  kind: string;
  module: string;
  methods?: string[];
  hydration?: { strategy?: string; priority?: string };
  clientModule?: string;
  contractModule?: string;
  layoutChain?: string[];
  metadataKind?: string;
}): AgentRouteSummary {
  const metadataKind =
    "metadataKind" in route && typeof route.metadataKind === "string"
      ? route.metadataKind
      : undefined;
  return {
    id: route.id,
    pattern: route.pattern,
    kind: route.kind,
    module: route.module,
    ...(Array.isArray(route.methods) ? { methods: route.methods } : {}),
    ...(route.hydration
      ? {
          hydration: {
            strategy: route.hydration.strategy,
            priority: route.hydration.priority,
          },
        }
      : {}),
    hasClientModule: typeof route.clientModule === "string" && route.clientModule.length > 0,
    hasContractModule:
      typeof route.contractModule === "string" && route.contractModule.length > 0,
    layoutDepth: Array.isArray(route.layoutChain) ? route.layoutChain.length : 0,
    ...(metadataKind ? { metadataKind } : {}),
  };
}

async function collectRoutes(rootDir: string, config: ManduConfig | null, warnings: string[]): Promise<{
  source: AgentContext["routeSource"];
  routes: AgentRouteSummary[];
}> {
  const manifestPath = path.join(rootDir, ".mandu", "routes.manifest.json");
  if (await pathExists(manifestPath)) {
    const raw = await readJson<unknown>(manifestPath);
    const parsed = RoutesManifest.safeParse(raw);
    if (parsed.success) {
      return {
        source: "manifest",
        routes: parsed.data.routes.map(summarizeRoute),
      };
    }
    warnings.push(
      `Route manifest exists but is invalid; falling back to scanner (${parsed.error.issues[0]?.message ?? "schema error"}).`,
    );
  }

  const routesDir = config?.fsRoutes?.routesDir ?? "app";
  const appDir = path.join(rootDir, routesDir);
  if (!(await pathExists(appDir))) {
    return { source: "none", routes: [] };
  }

  try {
    const scan = await scanRoutes(rootDir, config?.fsRoutes);
    return {
      source: "scanner",
      routes: scan.routes.map((route) => summarizeRoute(route)),
    };
  } catch (err) {
    warnings.push(`Failed to scan routes: ${err instanceof Error ? err.message : String(err)}`);
    return { source: "none", routes: [] };
  }
}

type ArtifactKind = AgentArtifactSummary["kind"];

const ARTIFACT_RULES: Array<{
  kind: ArtifactKind;
  roots: string[];
  suffixes: string[];
}> = [
  { kind: "partial", roots: ["app", "src"], suffixes: [".partial.tsx", ".partial.ts", ".partial.jsx", ".partial.js"] },
  { kind: "island", roots: ["app", "src"], suffixes: [".island.tsx", ".island.ts", ".island.jsx", ".island.js"] },
  { kind: "slot", roots: [path.join("spec", "slots"), "app"], suffixes: [".slot.ts", ".slot.tsx", ".slot.js", ".slot.jsx"] },
  { kind: "contract", roots: [path.join("spec", "contracts"), "app"], suffixes: [".contract.ts", ".contract.tsx", ".contract.js", ".contract.jsx"] },
];

async function walk(root: string, out: string[], maxFiles = 3000): Promise<void> {
  if (out.length >= maxFiles || !(await pathExists(root))) return;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= maxFiles) return;
    if (entry.name === "node_modules" || entry.name === ".mandu" || entry.name === ".git") {
      continue;
    }
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, out, maxFiles);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
}

async function collectArtifacts(rootDir: string): Promise<Record<ArtifactKind, AgentArtifactSummary[]>> {
  const result: Record<ArtifactKind, AgentArtifactSummary[]> = {
    partial: [],
    island: [],
    slot: [],
    contract: [],
  };

  for (const rule of ARTIFACT_RULES) {
    const files: string[] = [];
    for (const root of rule.roots) {
      await walk(path.join(rootDir, root), files);
    }
    const seen = new Set<string>();
    for (const abs of files) {
      if (!rule.suffixes.some((suffix) => abs.endsWith(suffix))) continue;
      const rel = toPosix(path.relative(rootDir, abs));
      if (seen.has(rel)) continue;
      seen.add(rel);
      result[rule.kind].push({ path: rel, kind: rule.kind });
    }
    result[rule.kind].sort((a, b) => a.path.localeCompare(b.path));
  }

  return result;
}

async function collectEnv(rootDir: string): Promise<AgentEnvFileSummary[]> {
  const candidates: Array<[string, AgentEnvFileSummary["kind"]]> = [
    [".env", "local"],
    [".env.local", "local"],
    [".env.development", "local"],
    [".env.test", "test"],
    [".env.production", "production"],
    [".env.example", "template"],
    [".env.sample", "template"],
  ];

  const out: AgentEnvFileSummary[] = [];
  for (const [name, kind] of candidates) {
    if (await pathExists(path.join(rootDir, name))) {
      out.push({ path: name, kind, redacted: true });
    }
  }
  return out;
}

async function collectDeploy(rootDir: string): Promise<AgentContext["deploy"]> {
  const intentPath = path.join(".mandu", "deploy.intent.json");
  const targets: string[] = [];
  for (const [file, target] of [
    ["vercel.json", "vercel"],
    ["netlify.toml", "netlify"],
    ["fly.toml", "fly"],
    ["render.yaml", "render"],
    ["wrangler.toml", "workers"],
    ["Dockerfile", "docker"],
    ["docker-compose.yml", "docker-compose"],
  ] as const) {
    if (await pathExists(path.join(rootDir, file))) {
      targets.push(target);
    }
  }
  return {
    intentFile: (await pathExists(path.join(rootDir, intentPath))) ? intentPath : null,
    targets,
  };
}

function mapSeverity(severity: "error" | "warning" | "info" | undefined): AgentDiagnosticSeverity {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

function diagnosticsFromDiagnose(report: Awaited<ReturnType<typeof runExtendedDiagnose>>): AgentDiagnostic[] {
  return report.checks
    .filter((check) => !check.ok)
    .map((check) => ({
      code: `MANDU_DIAGNOSE_${check.rule.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
      severity: mapSeverity(check.severity),
      title: check.rule,
      cause: check.message,
      ...(check.suggestion
        ? {
            suggestedFix: {
              type: "manual" as const,
              description: check.suggestion,
            },
          }
        : {}),
      docs: "docs/plans/20_agent_surface_consolidation_plan.md",
      repairable: Boolean(check.suggestion),
      source: "diagnose",
    }));
}

async function runGit(
  rootDir: string,
  args: string[],
  timeoutMs = 3000,
): Promise<string | null> {
  if (typeof Bun === "undefined") return null;
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // ignore
        }
        resolve(null);
      }, timeoutMs);
    });
    const output = new Response(proc.stdout).text();
    const result = await Promise.race([output, timeout]);
    const exit = await proc.exited.catch(() => 1);
    if (result === null || exit !== 0) return null;
    return result.trim();
  } catch {
    return null;
  }
}

async function collectGit(rootDir: string, includeGit: boolean): Promise<AgentGitSummary> {
  if (!includeGit) {
    return { branch: null, changedFiles: [], statusAvailable: false };
  }

  const branch = await runGit(rootDir, ["branch", "--show-current"]);
  const status = await runGit(rootDir, ["status", "--short"]);
  if (branch === null && status === null) {
    return { branch: null, changedFiles: [], statusAvailable: false };
  }
  const changedFiles =
    status
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[ MADRCU?!]{1,2}\s+/, ""))
      .slice(0, 200) ?? [];

  return {
    branch: branch || null,
    changedFiles,
    statusAvailable: true,
  };
}

function buildWorkflow(): AgentContext["agentWorkflow"] {
  return {
    canonical: ["context", "plan", "apply", "verify", "repair"],
    recommended: [
      {
        step: "context",
        command: COMMANDS.context,
        purpose: "Understand the project before selecting tools or editing files.",
      },
      {
        step: "plan",
        command: COMMANDS.plan,
        purpose: "Map the user's intent to domains, files, risks, and verification gates.",
      },
      {
        step: "apply",
        command: COMMANDS.apply,
        purpose: "Run planned intent-level changes before falling back to direct file edits.",
      },
      {
        step: "verify",
        command: COMMANDS.verify,
        purpose: "Collapse guard, diagnose, contract, and test signals into one agent-facing report.",
      },
      {
        step: "repair",
        command: COMMANDS.repair,
        purpose: "Convert verification failures into safe next actions or patch candidates.",
      },
    ],
  };
}

export function agentManifestPath(rootDir: string): string {
  return path.join(rootDir, AGENT_MANIFEST_RELATIVE_PATH);
}

export function toAgentManifest(context: AgentContext): AgentManifest {
  return {
    schemaVersion: context.schemaVersion,
    framework: context.framework,
    generatedAt: context.generatedAt,
    project: context.project,
    routeSource: context.routeSource,
    routes: context.routes,
    apis: context.apis,
    layouts: [],
    partials: context.partials,
    islands: context.islands,
    slots: context.slots,
    contracts: context.contracts,
    guards: context.guards,
    env: context.env,
    deploy: context.deploy,
    commands: context.commands,
    agentWorkflow: context.agentWorkflow,
    warnings: context.warnings,
  };
}

export async function buildAgentContext(
  rootDir: string = process.cwd(),
  options: BuildAgentContextOptions = {},
): Promise<AgentContext> {
  const includeDiagnose = options.includeDiagnose !== false;
  const includeGit = options.includeGit !== false;
  const root = path.resolve(rootDir);
  const warnings: string[] = [];
  const diagnostics: AgentDiagnostic[] = [];

  const pkg = await readPackageJson(root);
  const { config, configFile, warning } = await loadConfig(root);
  if (warning) warnings.push(warning);

  const [routeResult, artifacts, env, deploy, git] = await Promise.all([
    collectRoutes(root, config, warnings),
    collectArtifacts(root),
    collectEnv(root),
    collectDeploy(root),
    collectGit(root, includeGit),
  ]);

  let diagnose: AgentContext["diagnose"] | undefined;
  if (includeDiagnose) {
    try {
      const report = await runExtendedDiagnose(root);
      diagnose = {
        healthy: report.healthy,
        errorCount: report.errorCount,
        warningCount: report.warningCount,
        summary: report.summary,
      };
      diagnostics.push(...diagnosticsFromDiagnose(report));
    } catch (err) {
      diagnostics.push({
        code: "MANDU_DIAGNOSE_UNAVAILABLE",
        severity: "warning",
        title: "Diagnose unavailable",
        cause: err instanceof Error ? err.message : String(err),
        suggestedFix: {
          type: "manual",
          description: "Run `mandu diagnose --json` directly for more detail.",
        },
        docs: "docs/plans/20_agent_surface_consolidation_plan.md",
        repairable: false,
        source: "agent.context",
      });
    }
  }

  const routes = routeResult.routes;
  return {
    schemaVersion: 1,
    framework: "mandu",
    generatedAt: new Date().toISOString(),
    project: {
      name: typeof pkg.name === "string" ? pkg.name : null,
      version: typeof pkg.version === "string" ? pkg.version : null,
      root,
      packageManager: packageManagerFor(pkg),
      configFile,
    },
    routeSource: routeResult.source,
    routes,
    pages: routes.filter((route) => route.kind === "page"),
    apis: routes.filter((route) => route.kind === "api"),
    metadataRoutes: routes.filter((route) => route.kind === "metadata"),
    partials: artifacts.partial,
    islands: artifacts.island,
    slots: artifacts.slot,
    contracts: artifacts.contract,
    guards: summarizeGuard(config),
    env,
    deploy,
    commands: COMMANDS,
    agentWorkflow: buildWorkflow(),
    ...(diagnose ? { diagnose } : {}),
    diagnostics,
    git,
    warnings,
  };
}

export async function writeAgentManifest(
  rootDir: string = process.cwd(),
  contextOrManifest?: AgentContext | AgentManifest,
): Promise<{ path: string; manifest: AgentManifest }> {
  const manifest =
    contextOrManifest && "project" in contextOrManifest && "agentWorkflow" in contextOrManifest
      ? "diagnostics" in contextOrManifest
        ? toAgentManifest(contextOrManifest as AgentContext)
        : (contextOrManifest as AgentManifest)
      : toAgentManifest(await buildAgentContext(rootDir));

  const outPath = agentManifestPath(rootDir);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { path: outPath, manifest };
}

export async function readAgentManifest(rootDir: string = process.cwd()): Promise<AgentManifest | null> {
  return readJson<AgentManifest>(agentManifestPath(rootDir));
}
