import { readFile } from "fs/promises";
import { z } from "zod";

const baselinePath = new URL("../tests/perf/perf-baseline.json", import.meta.url);

const MetricDefinitionSchema = z.object({
  unit: z.enum(["ms", "kb", "count"]),
  direction: z.enum(["lower-is-better", "higher-is-better"]),
  description: z.string().min(1),
});

const BudgetEntrySchema = z.object({
  budget: z.number().nonnegative(),
  warningThresholdPct: z.number().min(0).max(100),
  baseline: z.number().nonnegative().nullable(),
});

const ScenarioSchema = z.object({
  id: z.string().min(1),
  app: z.string().min(1),
  status: z.enum(["active", "planned"]),
  mode: z.enum(["dev", "prod", "build"]),
  url: z.string().min(1),
  runner: z.string().min(1),
  measuredMetrics: z.array(z.string().min(1)).min(1),
  budgets: z.record(BudgetEntrySchema),
  notes: z.string().min(1),
});

const PerfBaselineSchema = z.object({
  version: z.number().int().positive(),
  lastReviewed: z.string().min(1),
  metrics: z.record(MetricDefinitionSchema),
  scenarios: z.array(ScenarioSchema).min(1),
  notes: z.array(z.string().min(1)).min(1),
});

type PerfBaseline = z.infer<typeof PerfBaselineSchema>;

function validateCrossReferences(config: PerfBaseline): void {
  const metricKeys = new Set(Object.keys(config.metrics));

  for (const scenario of config.scenarios) {
    for (const metric of scenario.measuredMetrics) {
      if (!metricKeys.has(metric)) {
        throw new Error(`Unknown metric '${metric}' referenced by scenario '${scenario.id}'`);
      }
    }

    for (const metric of Object.keys(scenario.budgets)) {
      if (!metricKeys.has(metric)) {
        throw new Error(`Unknown budget metric '${metric}' referenced by scenario '${scenario.id}'`);
      }
    }

    for (const metric of scenario.measuredMetrics) {
      if (!(metric in scenario.budgets)) {
        throw new Error(`Scenario '${scenario.id}' measures '${metric}' but has no budget entry`);
      }
    }
  }
}

function printSummary(config: PerfBaseline): void {
  const metricCount = Object.keys(config.metrics).length;
  const activeScenarios = config.scenarios.filter((scenario) => scenario.status === "active");
  const plannedScenarios = config.scenarios.filter((scenario) => scenario.status === "planned");
  const missingBaselines = config.scenarios.flatMap((scenario) =>
    Object.entries(scenario.budgets)
      .filter(([, budget]) => budget.baseline === null)
      .map(([metric]) => `${scenario.id}:${metric}`)
  );

  console.log("Performance baseline schema is valid.");
  console.log(`Metrics: ${metricCount}`);
  console.log(`Active scenarios: ${activeScenarios.length}`);
  console.log(`Planned scenarios: ${plannedScenarios.length}`);

  if (missingBaselines.length > 0) {
    console.log(`Baseline values pending freeze: ${missingBaselines.length}`);
  }
}

async function main(): Promise<void> {
  const file = await readFile(baselinePath, "utf8");
  const parsed = PerfBaselineSchema.parse(JSON.parse(file));
  validateCrossReferences(parsed);
  printSummary(parsed);
}

await main();
