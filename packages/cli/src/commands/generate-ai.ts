import { executeMcpTool } from "./mcp";

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
  switch ((value ?? "").toLowerCase()) {
    case "page":
      return "page";
    case "api":
      return "api";
    case "feature":
    case "both":
      return "both";
    default:
      return "both";
  }
}

function slugifyFeatureName(value?: string): string {
  if (!value) {
    return "feature";
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "feature";
}

function parseMethods(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const methods = value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  return methods.length > 0 ? methods : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function generateAi(options: GenerateAiOptions = {}): Promise<boolean> {
  const prompt = options.prompt?.trim();
  if (!prompt) {
    console.error("Usage: bunx mandu generate <page|api|feature> <name> --ai \"description\"");
    return false;
  }

  const kind = normalizeKind(options.kind);
  const name = slugifyFeatureName(options.name ?? prompt.split(/\s+/).slice(0, 3).join("-"));
  const methods = parseMethods(options.methods);

  if (options.dryRun) {
    const result = await executeMcpTool("mandu.negotiate", {
      intent: prompt,
      featureName: name,
    });

    if (!isRecord(result)) {
      console.log(JSON.stringify(result, null, 2));
      return true;
    }

    const structure = Array.isArray(result.structure) ? result.structure : [];
    const recommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const nextSteps = Array.isArray(result.nextSteps) ? result.nextSteps : [];

    console.log("AI Generation Plan");
    console.log(`Feature: ${name}`);
    console.log(`Kind: ${kind}`);

    if (structure.length > 0) {
      console.log("\nPlanned files:");
      for (const directory of structure) {
        if (!isRecord(directory)) continue;
        const dirPath = typeof directory.path === "string" ? directory.path : "";
        const files = Array.isArray(directory.files) ? directory.files : [];
        for (const file of files) {
          if (!isRecord(file)) continue;
          const fileName = typeof file.name === "string" ? file.name : "";
          if (!dirPath || !fileName) continue;
          console.log(`- ${dirPath}/${fileName}`);
        }
      }
    }

    if (recommendations.length > 0) {
      console.log("\nRecommendations:");
      for (const recommendation of recommendations) {
        console.log(`- ${String(recommendation)}`);
      }
    }

    if (warnings.length > 0) {
      console.log("\nWarnings:");
      for (const warning of warnings) {
        console.log(`- ${String(warning)}`);
      }
    }

    if (nextSteps.length > 0) {
      console.log("\nNext steps:");
      for (const step of nextSteps) {
        console.log(`- ${String(step)}`);
      }
    }

    return true;
  }

  const result = await executeMcpTool("mandu.feature.create", {
    name,
    description: prompt,
    kind,
    methods,
    withContract: options.withContract ?? kind !== "page",
    withIsland: options.withIsland ?? kind !== "api",
  });

  if (!isRecord(result)) {
    console.log(JSON.stringify(result, null, 2));
    return true;
  }

  if (result.success === false) {
    console.error(typeof result.error === "string" ? result.error : "AI generation failed");
    return false;
  }

  console.log(`Generated AI scaffold for ${name}`);
  console.log(`Kind: ${kind}`);

  const steps = Array.isArray(result.steps) ? result.steps : [];
  if (steps.length > 0) {
    console.log("\nPipeline:");
    for (const step of steps) {
      if (!isRecord(step)) continue;
      const label = typeof step.step === "string" ? step.step : "step";
      console.log(`- ${label}`);
    }
  }

  const summary = isRecord(result.summary) ? result.summary : null;
  if (summary) {
    console.log("\nSummary:");
    for (const [key, value] of Object.entries(summary)) {
      console.log(`- ${key}: ${String(value)}`);
    }
  }

  console.log("\nNext: run `mandu review` or `mandu guard` to validate the generated files.");
  return true;
}
