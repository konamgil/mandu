import fs from "fs/promises";
import path from "path";
import { createServer } from "node:net";

const repoRoot = path.resolve(import.meta.dir, "..");
const baselinePath = path.join(repoRoot, "tests", "perf", "perf-baseline.json");
const benchmarkEntry = path.join(repoRoot, "packages", "core", "benchmark", "hydration-benchmark.ts");
const cliEntry = path.join(repoRoot, "packages", "cli", "src", "main.ts");
const outputRoot = path.join(repoRoot, ".perf", "latest");

interface CompletedCommand {
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RunningCommand {
  args: string[];
  cwd: string;
  proc: Bun.Subprocess<"pipe", "pipe", "inherit">;
  stdoutPromise: Promise<string>;
  stderrPromise: Promise<string>;
}

interface PerfBudgetEntry {
  budget: number;
  warningThresholdPct: number;
  baseline: number | null;
}

interface PerfScenario {
  id: string;
  app: string;
  status: "active" | "planned";
  mode: "dev" | "prod" | "build";
  url: string;
  runner: string;
  measuredMetrics: string[];
  budgets: Record<string, PerfBudgetEntry>;
  notes: string;
}

interface PerfBaseline {
  version: number;
  lastReviewed: string;
  metrics: Record<string, { unit: string; direction: string; description: string }>;
  scenarios: PerfScenario[];
  notes: string[];
}

interface BenchmarkStats {
  ttfb: { avg: number; min: number; max: number; p95: number };
  hydration: { avg: number; min: number; max: number; p95: number };
  bundleSize: { avg: number };
}

interface BenchmarkJson {
  timestamp: string;
  config: {
    url: string;
    runs: number;
    warmupRuns: number;
    throttle: "3G" | "4G" | "none";
  };
  stats: BenchmarkStats;
  raw: Array<Record<string, unknown>>;
}

interface ScenarioMetrics {
  ssr_ttfb_p95_ms?: number;
  hydration_p95_ms?: number;
  initial_js_bundle_kb?: number;
}

interface MetricResult {
  metric: string;
  measured: number | null;
  budget: number;
  baseline: number | null;
  deltaFromBudget: number | null;
  status: "pass" | "warn" | "fail" | "unsupported";
}

interface ScenarioResult {
  scenarioId: string;
  app: string;
  mode: string;
  url: string;
  benchmarkFile: string;
  warnings: string[];
  results: MetricResult[];
}

function parseArgs(argv: string[]): {
  scenarioIds: string[];
  runs: number;
  warmup: number;
  enforce: boolean;
} {
  const scenarioIds: string[] = [];
  let runs = 3;
  let warmup = 1;
  let enforce = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scenario") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--scenario requires a scenario id");
      }
      scenarioIds.push(value);
      i += 1;
      continue;
    }
    if (arg === "--runs") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--runs requires a number");
      }
      runs = parseInt(value);
      i += 1;
      continue;
    }
    if (arg === "--warmup") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--warmup requires a number");
      }
      warmup = parseInt(value);
      i += 1;
      continue;
    }
    if (arg === "--enforce") {
      enforce = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { scenarioIds, runs, warmup, enforce };
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function readStreamWithTimeout(promise: Promise<string>, timeoutMs = 2000): Promise<string> {
  return await Promise.race([
    promise,
    Bun.sleep(timeoutMs).then(() => "[stream capture timed out]"),
  ]);
}

async function killProcessTree(pid: number): Promise<void> {
  if (Bun.platform === "win32") {
    const killer = Bun.spawn(["taskkill", "/PID", String(pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await killer.exited;
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore
  }
}

async function cleanupWindowsProcessesByCommandFragments(fragments: string[]): Promise<void> {
  if (Bun.platform !== "win32" || fragments.length === 0) {
    return;
  }

  const conditions = fragments
    .map((fragment) => {
      const escaped = fragment.replace(/'/g, "''").replace(/\\/g, "\\\\");
      return `$_.CommandLine -like '*${escaped}*'`;
    })
    .join(" -or ");

  const script = [
    `$targets = Get-CimInstance Win32_Process | Where-Object { ${conditions} }`,
    "foreach ($target in $targets) {",
    "  try { taskkill /PID $target.ProcessId /T /F | Out-Null } catch {}",
    "}",
  ].join("; ");

  const proc = Bun.spawn(["powershell", "-NoLogo", "-NoProfile", "-Command", script], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}

async function runCommand(
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
): Promise<CompletedCommand> {
  const proc = Bun.spawn(args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  const result: CompletedCommand = { args, cwd, exitCode, stdout, stderr };

  if (exitCode !== 0) {
    throw new Error(formatCommandFailure("Command failed", result));
  }

  return result;
}

function startCommand(
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
): RunningCommand {
  const proc = Bun.spawn(args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    args,
    cwd,
    proc,
    stdoutPromise: readStream(proc.stdout),
    stderrPromise: readStream(proc.stderr),
  };
}

async function stopCommand(command: RunningCommand): Promise<CompletedCommand> {
  await killProcessTree(command.proc.pid);

  const exitCode = await Promise.race([
    command.proc.exited,
    Bun.sleep(5000).then(() => -1),
  ]);
  const [stdout, stderr] = await Promise.all([
    readStreamWithTimeout(command.stdoutPromise),
    readStreamWithTimeout(command.stderrPromise),
  ]);

  return { args: command.args, cwd: command.cwd, exitCode, stdout, stderr };
}

function formatCommandFailure(prefix: string, result: CompletedCommand): string {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  return [
    prefix,
    `cwd: ${result.cwd}`,
    `command: ${result.args.join(" ")}`,
    `exitCode: ${result.exitCode}`,
    stdout ? `stdout:\n${stdout}` : "stdout:\n<empty>",
    stderr ? `stderr:\n${stderr}` : "stderr:\n<empty>",
  ].join("\n\n");
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close();
        reject(new Error("Failed to resolve a free port"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHttp(
  url: string,
  label: string,
  assertResponse: (response: Response) => Promise<void>,
  timeoutMs = 60_000
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      await assertResponse(response);
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(500);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} did not become ready in ${timeoutMs}ms: ${reason}`);
}

async function assertHealthEndpoint(url: string): Promise<void> {
  await waitForHttp(url, "health endpoint", async (response) => {
    if (!response.ok) {
      throw new Error(`Expected 200 response, got ${response.status}`);
    }

    const data = await response.json() as { status?: string; framework?: string };
    if (data.status !== "ok" || data.framework !== "Mandu") {
      throw new Error(`Unexpected health payload: ${JSON.stringify(data)}`);
    }
  });
}

function resolveScenarioUrl(baseOrigin: string, scenarioUrl: string): string {
  if (scenarioUrl.startsWith("http://") || scenarioUrl.startsWith("https://")) {
    const parsed = new URL(scenarioUrl);
    return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, baseOrigin).toString();
  }

  return new URL(scenarioUrl, baseOrigin).toString();
}

function normalizeMetrics(benchmarkJson: BenchmarkJson): ScenarioMetrics {
  return {
    ssr_ttfb_p95_ms: benchmarkJson.stats.ttfb.p95,
    hydration_p95_ms: benchmarkJson.stats.hydration.p95,
    initial_js_bundle_kb: benchmarkJson.stats.bundleSize.avg,
  };
}

function calculateP95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0;
}

function extractInitialJsUrls(html: string, pageUrl: string): string[] {
  const resourceUrls = new Set<string>();
  const patterns = [
    /<script[^>]+src="([^"]+)"/g,
    /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const rawUrl = match[1];
      if (!rawUrl || !rawUrl.includes(".js")) continue;
      resourceUrls.add(new URL(rawUrl, pageUrl).toString());
    }
  }

  return [...resourceUrls];
}

async function measureHttpMetrics(url: string, runs: number): Promise<ScenarioMetrics> {
  const ttfbSamples: number[] = [];

  for (let i = 0; i < runs; i++) {
    const startedAt = performance.now();
    const response = await fetch(url, {
      headers: { "Cache-Control": "no-cache" },
    });

    if (!response.ok) {
      throw new Error(`Expected ${url} to return 200, got ${response.status}`);
    }

    ttfbSamples.push(performance.now() - startedAt);
    await response.text();
  }

  const htmlResponse = await fetch(url, {
    headers: { "Cache-Control": "no-cache" },
  });
  const html = await htmlResponse.text();
  const scriptUrls = extractInitialJsUrls(html, url);

  let bundleBytes = 0;
  for (const scriptUrl of scriptUrls) {
    const response = await fetch(scriptUrl, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) continue;
    const body = await response.arrayBuffer();
    bundleBytes += body.byteLength;
  }

  return {
    ssr_ttfb_p95_ms: calculateP95(ttfbSamples),
    initial_js_bundle_kb: bundleBytes / 1024,
  };
}

function compareScenarioMetrics(
  scenario: PerfScenario,
  metrics: ScenarioMetrics,
): MetricResult[] {
  return scenario.measuredMetrics.map((metric) => {
    const measured = metrics[metric as keyof ScenarioMetrics];
    const budgetEntry = scenario.budgets[metric];
    if (typeof measured !== "number" || Number.isNaN(measured)) {
      return {
        metric,
        measured: null,
        budget: budgetEntry.budget,
        baseline: budgetEntry.baseline,
        deltaFromBudget: null,
        status: "unsupported",
      };
    }

    const warningBudget = budgetEntry.budget * (1 - budgetEntry.warningThresholdPct / 100);

    let status: MetricResult["status"] = "pass";
    if (measured > budgetEntry.budget) {
      status = "fail";
    } else if (measured > warningBudget) {
      status = "warn";
    }

    return {
      metric,
      measured,
      budget: budgetEntry.budget,
      baseline: budgetEntry.baseline,
      deltaFromBudget: measured - budgetEntry.budget,
      status,
    };
  });
}

function renderMarkdownReport(results: ScenarioResult[], generatedAt: string): string {
  const lines: string[] = [
    "# Mandu Performance Report",
    "",
    `Generated: ${generatedAt}`,
    "",
  ];

  for (const result of results) {
    lines.push(`## ${result.scenarioId}`);
    lines.push("");
    lines.push(`- App: \`${result.app}\``);
    lines.push(`- Mode: \`${result.mode}\``);
    lines.push(`- URL: \`${result.url}\``);
    lines.push(`- Benchmark JSON: \`${result.benchmarkFile}\``);
    for (const warning of result.warnings) {
      lines.push(`- Warning: ${warning}`);
    }
    lines.push("");
    lines.push("| Metric | Measured | Budget | Status |");
    lines.push("|---|---:|---:|---|");

    for (const metric of result.results) {
      lines.push(
        `| \`${metric.metric}\` | ${metric.measured === null ? "n/a" : metric.measured.toFixed(1)} | ${metric.budget.toFixed(1)} | ${metric.status} |`
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

async function runScenarioBenchmark(
  scenario: PerfScenario,
  demoDir: string,
  runs: number,
  warmup: number,
): Promise<ScenarioResult> {
  const port = await getFreePort();
  const origin = `http://localhost:${port}`;
  const scenarioUrl = resolveScenarioUrl(origin, scenario.url);
  const scenarioOutputDir = path.join(outputRoot, scenario.id);
  const benchmarkJsonPath = path.join(scenarioOutputDir, "benchmark.json");
  const browserErrorPath = path.join(scenarioOutputDir, "browser-error.txt");
  const warnings: string[] = [];

  await fs.mkdir(scenarioOutputDir, { recursive: true });

  if (scenario.mode === "prod") {
    console.log(`  build ${scenario.id}`);
    await runCommand(["bun", "run", cliEntry, "build"], demoDir, { PORT: String(port) });
  }

  const commandName = scenario.mode === "prod" ? "start" : "dev";
  console.log(`  start ${scenario.id} (${commandName}) on ${origin}`);
  const serverCommand = startCommand(["bun", "run", cliEntry, commandName], demoDir, {
    PORT: String(port),
  });

  try {
    await assertHealthEndpoint(`${origin}/api/health`);
    console.log(`  benchmark ${scenario.id} -> ${scenarioUrl}`);

    const httpMetrics = await measureHttpMetrics(scenarioUrl, runs);
    let browserMetrics: ScenarioMetrics = {};

    try {
      await runCommand(
        [
          "bun",
          "run",
          benchmarkEntry,
          scenarioUrl,
          String(runs),
          "none",
          "--warmup",
          String(warmup),
          "--wait-until",
          "load",
          "--json-out",
          benchmarkJsonPath,
        ],
        repoRoot,
      );
      console.log(`  benchmark complete ${scenario.id}`);
      const benchmarkJson = JSON.parse(await fs.readFile(benchmarkJsonPath, "utf8")) as BenchmarkJson;
      browserMetrics = normalizeMetrics(benchmarkJson);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push("Browser benchmark fallback was unavailable; hydration metric is unsupported in this run.");
      await fs.writeFile(browserErrorPath, `${message}\n`, "utf8");
      console.warn(`  browser benchmark unavailable for ${scenario.id}`);
    }

    const result = await stopCommand(serverCommand);
    await cleanupWindowsProcessesByCommandFragments([demoDir]);
    if (result.exitCode === -1) {
      warnings.push("Dev server process tree did not report a clean exit after perf collection.");
    }

    return {
      scenarioId: scenario.id,
      app: scenario.app,
      mode: scenario.mode,
      url: scenarioUrl,
      benchmarkFile: benchmarkJsonPath,
      warnings,
      results: compareScenarioMetrics(scenario, {
        ...httpMetrics,
        ...browserMetrics,
      }),
    };
  } catch (error) {
    const result = await stopCommand(serverCommand);
    await cleanupWindowsProcessesByCommandFragments([demoDir]);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n\n${formatCommandFailure(
        "Perf server logs",
        result,
      )}`,
    );
  }
}

async function main(): Promise<number> {
  const { scenarioIds, runs, warmup, enforce } = parseArgs(process.argv.slice(2));
  const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8")) as PerfBaseline;
  const scenarios = baseline.scenarios.filter((scenario) => scenario.status === "active");
  const selectedScenarios = scenarioIds.length > 0
    ? scenarios.filter((scenario) => scenarioIds.includes(scenario.id))
    : scenarios;

  if (selectedScenarios.length === 0) {
    throw new Error("No active scenarios matched the requested filters");
  }

  const results: ScenarioResult[] = [];

  for (const scenario of selectedScenarios) {
    if (scenario.app !== "todo-list-mandu") {
      throw new Error(`Active scenario '${scenario.id}' points to unsupported local app '${scenario.app}'`);
    }

    const demoDir = path.join(repoRoot, "demo", scenario.app);
    console.log(`Running perf scenario: ${scenario.id}`);
    const result = await runScenarioBenchmark(scenario, demoDir, runs, warmup);
    results.push(result);
  }

  await fs.mkdir(outputRoot, { recursive: true });
  const reportPath = path.join(outputRoot, "report.md");
  const summaryPath = path.join(outputRoot, "summary.json");
  const generatedAt = new Date().toISOString();
  const summary = {
    generatedAt,
    runs,
    warmup,
    enforce,
    scenarios: results,
  };

  await fs.writeFile(reportPath, `${renderMarkdownReport(results, generatedAt)}\n`, "utf8");
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  let hasFailure = false;
  for (const scenario of results) {
    for (const metric of scenario.results) {
      console.log(
        `${scenario.scenarioId} ${metric.metric}: ${metric.measured === null ? "n/a" : metric.measured.toFixed(1)} (budget ${metric.budget.toFixed(1)}) -> ${metric.status}`,
      );
      if (metric.status === "fail") {
        hasFailure = true;
      }
    }
  }

  console.log(`Saved perf summary to ${summaryPath}`);
  console.log(`Saved perf report to ${reportPath}`);

  if (enforce && hasFailure) {
    return 1;
  }

  return 0;
}

const exitCode = await main();
process.exit(exitCode);
