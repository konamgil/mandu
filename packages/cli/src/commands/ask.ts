import {
  getCompactArchitecture,
  getBrain,
  initializeBrain,
  searchDecisions,
  type CompactArchitecture,
} from "@mandujs/core";
import { collectPositionals } from "../util/cli-args";

export interface AskOptions {
  args?: string[];
  json?: boolean;
  useLLM?: boolean;
}

function extractKeywords(question: string): string[] {
  const tokens = question
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/g)
    .filter((token) => token.length >= 3);

  return Array.from(new Set(tokens)).slice(0, 6);
}

function inferSuggestedCommands(question: string): string[] {
  const normalized = question.toLowerCase();
  const commands = new Set<string>();

  if (normalized.includes("auth") || normalized.includes("login") || normalized.includes("jwt")) {
    commands.add("mandu auth init --strategy=jwt");
    commands.add("mandu session init");
  }
  if (normalized.includes("middleware") || normalized.includes("guard")) {
    commands.add("mandu middleware init --preset jwt");
    commands.add("mandu explain layer-violation --from client --to server");
  }
  if (normalized.includes("cache") || normalized.includes("isr")) {
    commands.add("mandu cache stats");
  }
  if (normalized.includes("websocket") || normalized.includes("ws") || normalized.includes("socket")) {
    commands.add("mandu ws chat");
  }
  if (normalized.includes("content") || normalized.includes("markdown") || normalized.includes("blog")) {
    commands.add("mandu collection create blog --schema=markdown");
  }
  if (normalized.includes("review") || normalized.includes("check")) {
    commands.add("mandu review");
    commands.add("mandu doctor");
  }
  if (normalized.includes("generate") || normalized.includes("scaffold") || normalized.includes("dashboard")) {
    commands.add("mandu generate page dashboard --ai analytics");
  }
  if (normalized.includes("deploy") || normalized.includes("production")) {
    commands.add("mandu deploy");
    commands.add("mandu preview");
  }

  if (commands.size === 0) {
    commands.add("mandu info");
    commands.add("mandu guard");
    commands.add("mandu doctor");
  }

  return Array.from(commands);
}

function formatArchitectureSummary(architecture: CompactArchitecture | null): string {
  if (!architecture) {
    return "No saved architecture summary found yet.";
  }

  const rules = architecture.rules.slice(0, 4).map((rule) => `- ${rule}`).join("\n");
  const decisions = architecture.keyDecisions
    .slice(0, 3)
    .map((decision) => `- ${decision.id}: ${decision.title}`)
    .join("\n");

  return [
    `Project: ${architecture.project}`,
    rules ? `Rules:\n${rules}` : "",
    decisions ? `Decisions:\n${decisions}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFallbackAnswer(question: string, commands: string[], architecture: CompactArchitecture | null): string {
  const lines = [
    `Question: ${question}`,
    "",
    "Relevant commands:",
    ...commands.map((command) => `- ${command}`),
  ];

  if (architecture) {
    lines.push("", "Architecture snapshot:", ...formatArchitectureSummary(architecture).split("\n"));
  }

  lines.push("", "If you want a concrete patch, run one of the commands above and then re-run `mandu review`.");
  return lines.join("\n");
}

export async function ask(options: AskOptions = {}): Promise<boolean> {
  const positionals = collectPositionals(options.args ?? []);
  const question = positionals.join(" ").trim();

  if (!question) {
    console.error("Usage: bunx mandu ask \"your question\"");
    return false;
  }

  const rootDir = process.cwd();
  const [architecture, decisions] = await Promise.all([
    getCompactArchitecture(rootDir).catch(() => null),
    searchDecisions(rootDir, extractKeywords(question)).catch(() => ({ decisions: [] })),
  ]);
  const suggestedCommands = inferSuggestedCommands(question);

  let answer = "";
  let llmAvailable = false;

  if (options.useLLM !== false) {
    const enabled = await initializeBrain();
    const brain = getBrain();
    llmAvailable = enabled && await brain.isLLMAvailable();

    if (llmAvailable) {
      const prompt = [
        "You are assisting with the Mandu framework CLI and codebase.",
        "Answer concisely and prioritize actionable guidance.",
        "",
        `Question: ${question}`,
        "",
        "Architecture summary:",
        formatArchitectureSummary(architecture),
        "",
        "Relevant recorded decisions:",
        ...(decisions.decisions ?? []).slice(0, 3).map((decision) => `- ${decision.id}: ${decision.title}`),
        "",
        "Suggested commands:",
        ...suggestedCommands.map((command) => `- ${command}`),
      ].join("\n");

      answer = (await brain.generate(prompt)).trim();
    }
  }

  if (!answer) {
    answer = buildFallbackAnswer(question, suggestedCommands, architecture);
  }

  if (options.json) {
    console.log(JSON.stringify({
      question,
      answer,
      llmAvailable,
      suggestedCommands,
      relatedDecisions: (decisions.decisions ?? []).slice(0, 3).map((decision) => ({
        id: decision.id,
        title: decision.title,
      })),
    }, null, 2));
    return true;
  }

  console.log(answer);
  if ((decisions.decisions ?? []).length > 0) {
    console.log("\nRelated decisions:");
    for (const decision of (decisions.decisions ?? []).slice(0, 3)) {
      console.log(`- ${decision.id}: ${decision.title}`);
    }
  }

  return true;
}
