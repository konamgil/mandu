import { buildAgentPlan, writeAgentPlan } from "@mandujs/core/compat/agent/index";
import { getRootDir } from "../util/fs";

export interface GenerateAiOptions {
  kind?: string;
  name?: string;
  prompt?: string;
  methods?: string;
  dryRun?: boolean;
  withContract?: boolean;
  withIsland?: boolean;
}

type FeatureKind = "page" | "api" | "both";

function normalizeKind(value?: string): FeatureKind {
  if (value === "page" || value === "api") return value;
  return "both";
}

function slugifyFeatureName(value?: string): string {
  const normalized = (value ?? "feature")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "feature";
}

/**
 * `generate --ai` is now a compatibility entry into the deterministic Core
 * agent workflow. Planning is product functionality; model/provider chat and
 * autonomous generation remain optional Labs concerns.
 */
export async function generateAi(options: GenerateAiOptions = {}): Promise<boolean> {
  const prompt = options.prompt?.trim();
  if (!prompt) {
    console.error("Usage: bunx mandu generate <page|api|feature> <name> --ai \"description\"");
    return false;
  }

  const kind = normalizeKind(options.kind);
  const name = slugifyFeatureName(options.name ?? prompt.split(/\s+/).slice(0, 3).join("-"));
  const qualifiers = [
    options.methods ? `HTTP methods ${options.methods}` : null,
    options.withContract ? "with a contract" : null,
    options.withIsland ? "with an island" : null,
  ].filter((value): value is string => Boolean(value));
  const intent = `Create Mandu ${kind} feature \"${name}\": ${prompt}${qualifiers.length > 0 ? ` (${qualifiers.join(", ")})` : ""}`;
  const plan = buildAgentPlan({ intent });

  console.log("AI Generation Plan");
  console.log(`Feature: ${name}`);
  console.log(`Kind: ${kind}`);
  console.log(`Domains: ${plan.domains.join(", ")}`);

  if (plan.filesToCreate.length > 0) {
    console.log("\nPlanned files:");
    for (const file of plan.filesToCreate) console.log(`- ${file}`);
  }

  if (options.dryRun) {
    console.log("\nDry-run only. No files were written.");
    return true;
  }

  const result = await writeAgentPlan(getRootDir(), plan);
  console.log(`\nPlan written: ${result.path}`);
  console.log("Next: review the plan, then run `mandu agent apply --from .mandu/agent-plan.json --json`.");
  return true;
}
