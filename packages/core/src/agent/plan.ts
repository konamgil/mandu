import fs from "fs/promises";
import path from "path";
import type {
  AgentApplyReport,
  AgentDomain,
  AgentPlan,
  AgentPlanRisk,
  AgentSuggestedCommand,
  BuildAgentApplyOptions,
  BuildAgentPlanOptions,
} from "./types";

const DEFAULT_PLAN_PATH = ".mandu/agent-plan.json";

const DOMAIN_KEYWORDS: Array<[AgentDomain, RegExp]> = [
  ["hydration", /\b(hydrat|island|partial|client|counter|interactive|ssr data)\b/i],
  ["contract", /\b(contract|openapi|schema|typed api|rpc)\b/i],
  ["api", /\b(api|endpoint|route handler|server action|post|get|put|delete)\b/i],
  ["slot", /\b(slot|filling|ctx\.|handler chain)\b/i],
  ["guard", /\b(guard|architecture|import boundary|layer|rule)\b/i],
  ["testing", /\b(test|spec|coverage|ate|e2e|playwright)\b/i],
  ["deploy", /\b(deploy|vercel|netlify|fly|render|docker|worker|edge)\b/i],
  ["design", /\b(design|ui|component|style|theme|tailwind|shadcn)\b/i],
  ["docs", /\b(doc|readme|guide|manual|changelog)\b/i],
  ["db", /\b(database|db|migration|seed|sqlite|postgres)\b/i],
  ["route", /\b(page|route|dashboard|screen|layout|fs route)\b/i],
];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function inferDomains(intent: string): AgentDomain[] {
  const domains = DOMAIN_KEYWORDS
    .filter(([, pattern]) => pattern.test(intent))
    .map(([domain]) => domain);

  if (domains.includes("api") && !domains.includes("contract")) {
    domains.push("contract");
  }
  if (domains.includes("hydration") && !domains.includes("route")) {
    domains.push("route");
  }
  if (domains.length === 0) {
    domains.push("unknown");
  }
  return unique(domains);
}

function filesToRead(domains: AgentDomain[]): string[] {
  const out: string[] = ["docs/plans/20_agent_surface_consolidation_plan.md"];
  if (domains.includes("route")) out.push("app/", ".mandu/routes.manifest.json");
  if (domains.includes("api")) out.push("app/api/", "spec/contracts/");
  if (domains.includes("contract")) out.push("spec/contracts/", "docs/resource-architecture.md");
  if (domains.includes("slot")) out.push("spec/slots/", "packages/mcp/src/resources/skills/mandu-slot/SKILL.md");
  if (domains.includes("hydration")) out.push("packages/mcp/src/resources/skills/mandu-hydration/SKILL.md", "app/**/*.partial.tsx");
  if (domains.includes("guard")) out.push("mandu.config.ts", "packages/mcp/src/resources/skills/mandu-guard/SKILL.md");
  if (domains.includes("testing")) out.push("packages/mcp/src/resources/skills/mandu-testing/SKILL.md");
  if (domains.includes("deploy")) out.push(".mandu/deploy.intent.json", "docs/deploy/README.md");
  if (domains.includes("design")) out.push("DESIGN.md", "packages/mcp/src/resources/skills/mandu-ui/SKILL.md");
  if (domains.includes("db")) out.push("spec/resources/", "spec/migrations/");
  return unique(out);
}

function filesToCreate(intent: string, domains: AgentDomain[]): string[] {
  const lower = intent.toLowerCase();
  const out: string[] = [];
  if (domains.includes("route")) {
    if (lower.includes("dashboard")) out.push("app/dashboard/page.tsx");
    else out.push("app/<route>/page.tsx");
  }
  if (domains.includes("api")) out.push("app/api/<name>/route.ts");
  if (domains.includes("contract")) out.push("spec/contracts/<name>.contract.ts");
  if (domains.includes("slot")) out.push("spec/slots/<name>.slot.ts");
  if (domains.includes("hydration")) out.push("app/<route>/<component>.partial.tsx");
  if (domains.includes("testing")) out.push("packages/<target>/__tests__/<feature>.test.ts");
  if (domains.includes("docs")) out.push("docs/<topic>.md");
  return unique(out);
}

function mcpTools(domains: AgentDomain[]): string[] {
  const out = ["mandu.agent.context", "mandu.agent.verify"];
  if (domains.includes("route")) out.push("mandu.route.list", "mandu.generate");
  if (domains.includes("api")) out.push("mandu.generate", "mandu.contract.create");
  if (domains.includes("contract")) out.push("mandu.contract.validate", "mandu.contract.openapi");
  if (domains.includes("slot")) out.push("mandu.slot.validate", "mandu.slot.constraints");
  if (domains.includes("hydration")) out.push("mandu.island.list", "mandu.hydration.set");
  if (domains.includes("guard")) out.push("mandu.guard.check", "mandu.guard.explain");
  if (domains.includes("testing")) out.push("mandu.run.tests", "mandu.ate.generate");
  if (domains.includes("deploy")) out.push("mandu.deploy.plan", "mandu.deploy.compile");
  if (domains.includes("design")) out.push("mandu.design.get", "mandu.design.check");
  return unique(out);
}

function risks(domains: AgentDomain[]): AgentPlanRisk[] {
  const out: AgentPlanRisk[] = [];
  if (domains.includes("db")) out.push({ level: "high", reason: "Database changes can affect persistent data." });
  if (domains.includes("deploy")) out.push({ level: "high", reason: "Deploy artifacts may affect production behavior." });
  if (domains.includes("guard")) out.push({ level: "medium", reason: "Architecture rule changes can hide future violations." });
  if (domains.includes("hydration")) out.push({ level: "medium", reason: "SSR/client boundaries can regress hydration." });
  if (domains.includes("api") || domains.includes("contract")) {
    out.push({ level: "medium", reason: "API and contract changes must stay synchronized." });
  }
  if (out.length === 0) out.push({ level: "low", reason: "No high-risk domain detected by deterministic planner." });
  return out;
}

function verification(domains: AgentDomain[]): AgentSuggestedCommand[] {
  const out: AgentSuggestedCommand[] = [
    {
      command: "mandu agent verify --changed --json --write",
      reason: "Canonical post-change verification gate.",
      required: true,
    },
    {
      command: "bun run typecheck",
      reason: "Type boundary check for generated or edited TypeScript.",
      required: true,
    },
  ];
  if (domains.includes("hydration") || domains.includes("route")) {
    out.push({
      command: "bun test packages/core/src/bundler packages/core/tests/client",
      reason: "Route and hydration changes can affect bundling and client runtime.",
      required: true,
    });
  }
  if (domains.includes("api") || domains.includes("contract") || domains.includes("slot")) {
    out.push({
      command: "bun test packages/core/src/contract packages/core/src/slot packages/core/tests/routes",
      reason: "API, contract, and slot changes need framework contract coverage.",
      required: true,
    });
  }
  if (domains.includes("deploy")) {
    out.push({
      command: "mandu deploy:plan --dry-run",
      reason: "Deploy intent should be inspected before writing provider artifacts.",
      required: true,
    });
  }
  return unique(out.map((item) => JSON.stringify(item))).map((item) => JSON.parse(item) as AgentSuggestedCommand);
}

export function buildAgentPlan(options: BuildAgentPlanOptions): AgentPlan {
  const intent = options.intent.trim();
  const domains = inferDomains(intent);
  return {
    schemaVersion: 1,
    framework: "mandu",
    generatedAt: new Date().toISOString(),
    intent,
    domains,
    filesToRead: filesToRead(domains),
    filesToCreate: filesToCreate(intent, domains),
    filesToModify: [],
    mcpTools: mcpTools(domains),
    risks: risks(domains),
    verification: verification(domains),
    notes: [
      "This deterministic plan is intentionally conservative. It does not execute edits.",
      "Prefer MCP/domain tools before direct file edits, then run agent verify.",
    ],
    executable: false,
  };
}

export function agentPlanPath(rootDir: string): string {
  return path.join(rootDir, ".mandu", "agent-plan.json");
}

export async function writeAgentPlan(rootDir: string, plan: AgentPlan): Promise<{ path: string; plan: AgentPlan }> {
  const outPath = agentPlanPath(rootDir);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return { path: outPath, plan };
}

async function readAgentPlan(filePath: string): Promise<AgentPlan | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as AgentPlan;
    if (parsed?.framework !== "mandu" || !Array.isArray(parsed.domains)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resolveInside(rootDir: string, value: string): string {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("agent apply input must stay inside the project root");
  }
  return resolved;
}

export async function buildAgentApplyReport(
  rootDir: string = process.cwd(),
  options: BuildAgentApplyOptions = {},
): Promise<AgentApplyReport> {
  const sourceRel = options.from ?? DEFAULT_PLAN_PATH;
  const sourcePath = resolveInside(rootDir, sourceRel);
  const plan = await readAgentPlan(sourcePath);
  if (!plan) {
    return {
      schemaVersion: 1,
      framework: "mandu",
      generatedAt: new Date().toISOString(),
      ok: false,
      dryRun: true,
      sourcePlan: sourceRel,
      intent: "",
      domains: ["unknown"],
      actions: [
        {
          kind: "verify",
          description: "Create an agent plan first.",
          command: "mandu agent plan \"<task>\" --json --write",
          applied: false,
        },
      ],
      warnings: [`Could not read ${sourceRel}.`],
      nextVerifyCommand: "mandu agent verify --changed --json --write",
    };
  }

  return {
    schemaVersion: 1,
    framework: "mandu",
    generatedAt: new Date().toISOString(),
    ok: true,
    dryRun: options.dryRun !== false,
    sourcePlan: sourceRel,
    intent: plan.intent,
    domains: plan.domains,
    actions: [
      ...plan.filesToRead.map((file) => ({
        kind: "read_file" as const,
        description: `Read ${file} before editing.`,
        file,
        applied: false as const,
      })),
      ...plan.mcpTools.map((tool) => ({
        kind: "mcp_tool" as const,
        description: `Consider ${tool} for this plan.`,
        tool,
        applied: false as const,
      })),
      ...plan.filesToCreate.map((file) => ({
        kind: "manual_edit" as const,
        description: `Create ${file} only after confirming the local pattern.`,
        file,
        applied: false as const,
      })),
      ...plan.verification.map((item) => ({
        kind: "verify" as const,
        description: item.reason,
        command: item.command,
        applied: false as const,
      })),
    ],
    warnings: [
      "Agent apply is dry-run only until typed operation payloads are introduced.",
      "No filesystem changes were made by this report.",
    ],
    nextVerifyCommand: "mandu agent verify --changed --json --write",
  };
}

export async function writeAgentApplyReport(
  rootDir: string,
  report: AgentApplyReport,
): Promise<{ path: string; report: AgentApplyReport }> {
  const outPath = path.join(rootDir, ".mandu", "agent-apply.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { path: outPath, report };
}
