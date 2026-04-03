import fs from "fs/promises";
import path from "path";
import { z } from "zod";

const defaultSummaryPath = path.resolve(import.meta.dir, "..", ".perf", "latest", "summary.json");

const MetricResultSchema = z.object({
  metric: z.string().min(1),
  measured: z.number().nullable(),
  budget: z.number().nonnegative(),
  baseline: z.number().nonnegative().nullable(),
  deltaFromBudget: z.number().nullable(),
  status: z.enum(["pass", "warn", "fail", "unsupported"]),
});

const ScenarioResultSchema = z.object({
  scenarioId: z.string().min(1),
  app: z.string().min(1),
  mode: z.string().min(1),
  url: z.string().min(1),
  benchmarkFile: z.string().min(1),
  warnings: z.array(z.string()),
  results: z.array(MetricResultSchema),
});

const PerfSummarySchema = z.object({
  generatedAt: z.string().min(1),
  runs: z.number().int().nonnegative(),
  warmup: z.number().int().nonnegative(),
  enforce: z.boolean(),
  scenarios: z.array(ScenarioResultSchema),
});

type PerfSummary = z.infer<typeof PerfSummarySchema>;
type MetricResult = z.infer<typeof MetricResultSchema>;

function parseArgs(argv: string[]): {
  summaryPath: string;
  enforce: boolean;
  failOnUnsupported: boolean;
  markdownOut: string | null;
} {
  let summaryPath = defaultSummaryPath;
  let enforce = false;
  let failOnUnsupported = false;
  let markdownOut: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--summary") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--summary requires a file path");
      }
      summaryPath = path.resolve(value);
      i += 1;
      continue;
    }

    if (arg === "--markdown-out") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--markdown-out requires a file path");
      }
      markdownOut = path.resolve(value);
      i += 1;
      continue;
    }

    if (arg === "--enforce") {
      enforce = true;
      continue;
    }

    if (arg === "--fail-on-unsupported") {
      failOnUnsupported = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { summaryPath, enforce, failOnUnsupported, markdownOut };
}

function toGithubAnnotation(level: "warning" | "error", title: string, message: string): void {
  if (!process.env.GITHUB_ACTIONS) return;
  const escaped = message.replace(/\r?\n/g, "%0A");
  console.log(`::${level} title=${title}::${escaped}`);
}

function formatMetricLine(scenarioId: string, result: MetricResult): string {
  const measured = result.measured === null ? "n/a" : result.measured.toFixed(1);
  return `${scenarioId} ${result.metric}: measured=${measured}, budget=${result.budget.toFixed(1)}, status=${result.status}`;
}

function renderMarkdown(summary: PerfSummary): string {
  const lines: string[] = [
    "# Performance Budget Check",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
  ];

  for (const scenario of summary.scenarios) {
    lines.push(`## ${scenario.scenarioId}`);
    lines.push("");
    lines.push(`- App: \`${scenario.app}\``);
    lines.push(`- Mode: \`${scenario.mode}\``);
    lines.push(`- URL: \`${scenario.url}\``);

    for (const warning of scenario.warnings) {
      lines.push(`- Warning: ${warning}`);
    }

    lines.push("");
    lines.push("| Metric | Measured | Budget | Status |");
    lines.push("|---|---:|---:|---|");

    for (const result of scenario.results) {
      lines.push(
        `| \`${result.metric}\` | ${result.measured === null ? "n/a" : result.measured.toFixed(1)} | ${result.budget.toFixed(1)} | ${result.status} |`
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

function summarize(summary: PerfSummary): {
  passes: MetricResult[];
  warnings: Array<{ scenarioId: string; result: MetricResult }>;
  failures: Array<{ scenarioId: string; result: MetricResult }>;
  unsupported: Array<{ scenarioId: string; result: MetricResult }>;
} {
  const passes: MetricResult[] = [];
  const warnings: Array<{ scenarioId: string; result: MetricResult }> = [];
  const failures: Array<{ scenarioId: string; result: MetricResult }> = [];
  const unsupported: Array<{ scenarioId: string; result: MetricResult }> = [];

  for (const scenario of summary.scenarios) {
    for (const result of scenario.results) {
      if (result.status === "pass") {
        passes.push(result);
        continue;
      }
      if (result.status === "warn") {
        warnings.push({ scenarioId: scenario.scenarioId, result });
        continue;
      }
      if (result.status === "fail") {
        failures.push({ scenarioId: scenario.scenarioId, result });
        continue;
      }
      unsupported.push({ scenarioId: scenario.scenarioId, result });
    }
  }

  return { passes, warnings, failures, unsupported };
}

async function main(): Promise<number> {
  const { summaryPath, enforce, failOnUnsupported, markdownOut } = parseArgs(process.argv.slice(2));
  const content = await fs.readFile(summaryPath, "utf8");
  const summary = PerfSummarySchema.parse(JSON.parse(content));
  const { passes, warnings, failures, unsupported } = summarize(summary);

  console.log(`Performance budget summary: ${summary.scenarios.length} scenarios`);
  console.log(`Pass: ${passes.length}`);
  console.log(`Warn: ${warnings.length}`);
  console.log(`Fail: ${failures.length}`);
  console.log(`Unsupported: ${unsupported.length}`);

  for (const entry of warnings) {
    const line = formatMetricLine(entry.scenarioId, entry.result);
    console.log(`WARN ${line}`);
    toGithubAnnotation("warning", "Performance budget warning", line);
  }

  for (const entry of failures) {
    const line = formatMetricLine(entry.scenarioId, entry.result);
    console.log(`FAIL ${line}`);
    toGithubAnnotation(enforce ? "error" : "warning", "Performance budget exceeded", line);
  }

  for (const entry of unsupported) {
    const line = formatMetricLine(entry.scenarioId, entry.result);
    console.log(`UNSUPPORTED ${line}`);
    toGithubAnnotation(failOnUnsupported ? "error" : "warning", "Performance metric unsupported", line);
  }

  if (markdownOut) {
    await fs.mkdir(path.dirname(markdownOut), { recursive: true });
    await fs.writeFile(markdownOut, `${renderMarkdown(summary)}\n`, "utf8");
    console.log(`Saved perf budget markdown to ${markdownOut}`);
  }

  if (enforce && failures.length > 0) {
    return 1;
  }

  if (failOnUnsupported && unsupported.length > 0) {
    return 1;
  }

  return 0;
}

const exitCode = await main();
process.exit(exitCode);
