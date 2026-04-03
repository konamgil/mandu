/**
 * Mandu Hydration Benchmark
 * Playwright 기반 하이드레이션 성능 측정
 */

import { chromium, type Browser, type Page } from "playwright";
import fs from "fs/promises";
import path from "path";
import { createServer } from "node:net";

interface BenchmarkResult {
  name: string;
  ttfb: number;          // Time to First Byte (ms)
  fcp: number;           // First Contentful Paint (ms)
  tti: number;           // Time to Interactive (ms)
  hydrationTime: number; // Island hydration 완료 시간 (ms)
  bundleSize: number;    // Total JS bundle size (KB)
  memoryUsage: number;   // Peak memory usage (MB)
  islandCount: number;   // Number of islands hydrated
}

interface BenchmarkConfig {
  url: string;
  runs: number;
  warmupRuns: number;
  throttle?: "3G" | "4G" | "none";
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
}

const NETWORK_CONDITIONS = {
  "3G": {
    offline: false,
    downloadThroughput: (500 * 1024) / 8, // 500 Kbps
    uploadThroughput: (500 * 1024) / 8,
    latency: 400,
  },
  "4G": {
    offline: false,
    downloadThroughput: (4 * 1024 * 1024) / 8, // 4 Mbps
    uploadThroughput: (3 * 1024 * 1024) / 8,
    latency: 20,
  },
  none: null,
};

interface BrowserSession {
  browser: Browser;
  cleanup: () => Promise<void>;
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

async function resolveExistingWindowsBrowser(preferred: "chrome" | "msedge"): Promise<string | null> {
  const candidates = preferred === "chrome"
    ? [
        path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      ]
    : [
        path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
      ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep searching
    }
  }

  return null;
}

async function waitForCdpUrl(port: number, timeoutMs = 15_000): Promise<string> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (!response.ok) {
        throw new Error(`CDP endpoint returned ${response.status}`);
      }
      const data = await response.json() as { webSocketDebuggerUrl?: string };
      if (!data.webSocketDebuggerUrl) {
        throw new Error("CDP endpoint did not return webSocketDebuggerUrl");
      }
      return data.webSocketDebuggerUrl;
    } catch (error) {
      lastError = error;
      await Bun.sleep(250);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function terminateBrowserProcess(proc: Bun.Subprocess<"ignore", "ignore", "ignore">): Promise<void> {
  if (process.platform === "win32") {
    const killer = Bun.spawn(["taskkill", "/PID", String(proc.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await killer.exited;
    return;
  }

  try {
    proc.kill("SIGKILL");
  } catch {
    // ignore
  }
}

async function launchBrowserViaCdp(preferred: "chrome" | "msedge"): Promise<BrowserSession> {
  const executable = await resolveExistingWindowsBrowser(preferred);
  if (!executable) {
    throw new Error(`System ${preferred} executable not found`);
  }

  const port = await getFreePort();
  const userDataDir = await fs.mkdtemp(path.join(process.env.TEMP || process.cwd(), `mandu-perf-${preferred}-`));
  const proc = Bun.spawn(
    [
      executable,
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    {
      stdout: "ignore",
      stderr: "ignore",
    }
  );

  try {
    const wsUrl = await waitForCdpUrl(port);
    const browser = await chromium.connectOverCDP(wsUrl);

    return {
      browser,
      cleanup: async () => {
        try {
          await browser.close();
        } catch {
          // ignore
        }
        await terminateBrowserProcess(proc);
        try {
          await proc.exited;
        } catch {
          // ignore
        }
        try {
          await fs.rm(userDataDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      },
    };
  } catch (error) {
    await terminateBrowserProcess(proc);
    try {
      await proc.exited;
    } catch {
      // ignore
    }
    try {
      await fs.rm(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    throw error;
  }
}

async function launchBenchmarkBrowser(): Promise<BrowserSession> {
  const attempts: Array<{
    label: string;
    run: () => Promise<BrowserSession>;
  }> = [
    {
      label: "bundled chromium",
      run: async () => {
        const browser = await chromium.launch({ headless: true, timeout: 45_000 });
        return {
          browser,
          cleanup: async () => {
            await browser.close();
          },
        };
      },
    },
  ];

  if (process.platform === "win32") {
    attempts.push(
      {
        label: "system chrome over CDP",
        run: () => launchBrowserViaCdp("chrome"),
      },
      {
        label: "system msedge over CDP",
        run: () => launchBrowserViaCdp("msedge"),
      },
    );
  }

  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      console.log(`   Browser launch attempt: ${attempt.label}`);
      return await attempt.run();
    } catch (error) {
      lastError = error;
      console.warn(`   Browser launch failed: ${attempt.label}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function measureHydration(page: Page): Promise<{
  hydrationTime: number;
  islandCount: number;
}> {
  return page.evaluate(() => {
    return new Promise((resolve) => {
      const startTime = performance.now();
      let hydratedCount = 0;
      const totalIslands = document.querySelectorAll("[data-mandu-island]").length;

      if (totalIslands === 0) {
        resolve({ hydrationTime: 0, islandCount: 0 });
        return;
      }

      // 모든 Island hydration 완료 대기
      const checkInterval = setInterval(() => {
        const hydrated = document.querySelectorAll("[data-mandu-hydrated]").length;
        if (hydrated >= totalIslands) {
          clearInterval(checkInterval);
          const endTime = performance.now();
          resolve({
            hydrationTime: endTime - startTime,
            islandCount: hydrated,
          });
        }
      }, 10);

      // 타임아웃 (10초)
      setTimeout(() => {
        clearInterval(checkInterval);
        const hydrated = document.querySelectorAll("[data-mandu-hydrated]").length;
        resolve({
          hydrationTime: performance.now() - startTime,
          islandCount: hydrated,
        });
      }, 10000);
    });
  });
}

async function measurePerformanceMetrics(page: Page): Promise<{
  ttfb: number;
  fcp: number;
  tti: number;
}> {
  const metrics = await page.evaluate(() => {
    return new Promise<{ ttfb: number; fcp: number; tti: number }>((resolve) => {
      const navigationEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const ttfb = navigationEntry?.responseStart || 0;

      // FCP 측정
      const paintEntries = performance.getEntriesByType("paint");
      const fcpEntry = paintEntries.find((e) => e.name === "first-contentful-paint");
      const fcp = fcpEntry?.startTime || 0;

      // TTI 근사값 (Long Tasks 기반)
      let tti = fcp;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "longtask") {
            tti = Math.max(tti, entry.startTime + entry.duration);
          }
        }
      });

      try {
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        // longtask not supported
      }

      // 안정화 대기 후 반환
      setTimeout(() => {
        observer.disconnect();
        resolve({ ttfb, fcp, tti });
      }, 2000);
    });
  });

  return metrics;
}

async function measureBundleSize(page: Page): Promise<number> {
  const resources = await page.evaluate(() => {
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return entries
      .filter((e) => e.initiatorType === "script" && e.name.includes(".mandu"))
      .reduce((sum, e) => sum + (e.transferSize || 0), 0);
  });

  return resources / 1024; // KB
}

async function measureMemory(page: Page): Promise<number> {
  try {
    const metrics = await page.metrics();
    return (metrics.JSHeapUsedSize || 0) / (1024 * 1024); // MB
  } catch {
    return 0;
  }
}

async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult[]> {
  const session = await launchBenchmarkBrowser();
  const browser = session.browser;
  const results: BenchmarkResult[] = [];
  const waitUntil = config.waitUntil || "load";

  console.log(`\n🏃 Benchmark: ${config.url}`);
  console.log(`   Runs: ${config.runs} (+ ${config.warmupRuns} warmup)`);
  console.log(`   Network: ${config.throttle || "none"}\n`);
  console.log(`   WaitUntil: ${waitUntil}\n`);

  try {
    // Warmup runs
    for (let i = 0; i < config.warmupRuns; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();

      if (config.throttle && config.throttle !== "none") {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.emulateNetworkConditions", NETWORK_CONDITIONS[config.throttle]!);
      }

      await page.goto(config.url, { waitUntil });
      await context.close();
      console.log(`   Warmup ${i + 1}/${config.warmupRuns} ✓`);
    }

    // Actual runs
    for (let i = 0; i < config.runs; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();

      if (config.throttle && config.throttle !== "none") {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.emulateNetworkConditions", NETWORK_CONDITIONS[config.throttle]!);
      }

      await page.goto(config.url, { waitUntil });

      const [perfMetrics, hydrationMetrics, bundleSize, memoryUsage] = await Promise.all([
        measurePerformanceMetrics(page),
        measureHydration(page),
        measureBundleSize(page),
        measureMemory(page),
      ]);

      results.push({
        name: `Run ${i + 1}`,
        ttfb: perfMetrics.ttfb,
        fcp: perfMetrics.fcp,
        tti: perfMetrics.tti,
        hydrationTime: hydrationMetrics.hydrationTime,
        bundleSize,
        memoryUsage,
        islandCount: hydrationMetrics.islandCount,
      });

      await context.close();
      console.log(`   Run ${i + 1}/${config.runs}: TTI=${perfMetrics.tti.toFixed(0)}ms, Hydration=${hydrationMetrics.hydrationTime.toFixed(0)}ms`);
    }

    return results;
  } finally {
    await session.cleanup();
  }
}

function calculateStats(results: BenchmarkResult[]) {
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const min = (arr: number[]) => Math.min(...arr);
  const max = (arr: number[]) => Math.max(...arr);
  const p95 = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  };

  const ttfbValues = results.map((r) => r.ttfb);
  const fcpValues = results.map((r) => r.fcp);
  const ttiValues = results.map((r) => r.tti);
  const hydrationValues = results.map((r) => r.hydrationTime);
  const bundleValues = results.map((r) => r.bundleSize);
  const memoryValues = results.map((r) => r.memoryUsage);

  return {
    ttfb: { avg: avg(ttfbValues), min: min(ttfbValues), max: max(ttfbValues), p95: p95(ttfbValues) },
    fcp: { avg: avg(fcpValues), min: min(fcpValues), max: max(fcpValues), p95: p95(fcpValues) },
    tti: { avg: avg(ttiValues), min: min(ttiValues), max: max(ttiValues), p95: p95(ttiValues) },
    hydration: { avg: avg(hydrationValues), min: min(hydrationValues), max: max(hydrationValues), p95: p95(hydrationValues) },
    bundleSize: { avg: avg(bundleValues) },
    memory: { avg: avg(memoryValues), max: max(memoryValues) },
    islandCount: results[0]?.islandCount || 0,
  };
}

function printReport(stats: ReturnType<typeof calculateStats>, config: BenchmarkConfig) {
  console.log("\n" + "=".repeat(60));
  console.log("📊 MANDU HYDRATION BENCHMARK REPORT");
  console.log("=".repeat(60));
  console.log(`URL: ${config.url}`);
  console.log(`Network: ${config.throttle || "No throttling"}`);
  console.log(`Runs: ${config.runs}`);
  console.log("-".repeat(60));

  console.log("\n🎯 PERFORMANCE METRICS\n");

  console.log(`  Time to First Byte (TTFB):`);
  console.log(`    Average: ${stats.ttfb.avg.toFixed(1)}ms`);
  console.log(`    Min/Max: ${stats.ttfb.min.toFixed(1)}ms / ${stats.ttfb.max.toFixed(1)}ms`);
  console.log(`    P95:     ${stats.ttfb.p95.toFixed(1)}ms`);

  console.log(`  First Contentful Paint (FCP):`);
  console.log(`    Average: ${stats.fcp.avg.toFixed(1)}ms`);
  console.log(`    Min/Max: ${stats.fcp.min.toFixed(1)}ms / ${stats.fcp.max.toFixed(1)}ms`);
  console.log(`    P95:     ${stats.fcp.p95.toFixed(1)}ms`);

  console.log(`\n  Time to Interactive (TTI):`);
  console.log(`    Average: ${stats.tti.avg.toFixed(1)}ms`);
  console.log(`    Min/Max: ${stats.tti.min.toFixed(1)}ms / ${stats.tti.max.toFixed(1)}ms`);
  console.log(`    P95:     ${stats.tti.p95.toFixed(1)}ms`);

  console.log(`\n  🏝️ Island Hydration:`);
  console.log(`    Islands: ${stats.islandCount}`);
  console.log(`    Average: ${stats.hydration.avg.toFixed(1)}ms`);
  console.log(`    Min/Max: ${stats.hydration.min.toFixed(1)}ms / ${stats.hydration.max.toFixed(1)}ms`);
  console.log(`    P95:     ${stats.hydration.p95.toFixed(1)}ms`);

  console.log(`\n  📦 Bundle Size:`);
  console.log(`    Total:   ${stats.bundleSize.avg.toFixed(1)}KB`);

  console.log(`\n  💾 Memory Usage:`);
  console.log(`    Average: ${stats.memory.avg.toFixed(1)}MB`);
  console.log(`    Peak:    ${stats.memory.max.toFixed(1)}MB`);

  // 등급 판정
  console.log("\n" + "-".repeat(60));
  console.log("📈 PERFORMANCE GRADE\n");

  const grades = {
    fcp: stats.fcp.avg < 1000 ? "A" : stats.fcp.avg < 2000 ? "B" : stats.fcp.avg < 3000 ? "C" : "D",
    tti: stats.tti.avg < 2000 ? "A" : stats.tti.avg < 4000 ? "B" : stats.tti.avg < 6000 ? "C" : "D",
    hydration: stats.hydration.avg < 100 ? "A" : stats.hydration.avg < 300 ? "B" : stats.hydration.avg < 500 ? "C" : "D",
    bundle: stats.bundleSize.avg < 50 ? "A" : stats.bundleSize.avg < 100 ? "B" : stats.bundleSize.avg < 200 ? "C" : "D",
  };

  console.log(`  FCP:        ${grades.fcp} (< 1000ms = A, < 2000ms = B)`);
  console.log(`  TTI:        ${grades.tti} (< 2000ms = A, < 4000ms = B)`);
  console.log(`  Hydration:  ${grades.hydration} (< 100ms = A, < 300ms = B)`);
  console.log(`  Bundle:     ${grades.bundle} (< 50KB = A, < 100KB = B)`);

  console.log("\n" + "=".repeat(60));
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  let jsonOut: string | null = null;
  let warmupRuns = 2;
  let waitUntil: BenchmarkConfig["waitUntil"] = "load";
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json-out") {
      const outputPath = args[i + 1];
      if (!outputPath) {
        throw new Error("--json-out requires a file path");
      }
      jsonOut = outputPath;
      i += 1;
      continue;
    }
    if (arg === "--warmup") {
      const warmupValue = args[i + 1];
      if (!warmupValue) {
        throw new Error("--warmup requires a number");
      }
      warmupRuns = parseInt(warmupValue);
      i += 1;
      continue;
    }
    if (arg === "--wait-until") {
      const waitValue = args[i + 1] as BenchmarkConfig["waitUntil"] | undefined;
      if (!waitValue) {
        throw new Error("--wait-until requires a value");
      }
      if (!["load", "domcontentloaded", "networkidle", "commit"].includes(waitValue)) {
        throw new Error(`Invalid waitUntil value: ${waitValue}`);
      }
      waitUntil = waitValue;
      i += 1;
      continue;
    }

    positional.push(arg);
  }

  const url = positional[0] || "http://localhost:3333/";
  const runs = parseInt(positional[1] || "5");
  const throttle = (positional[2] as "3G" | "4G" | "none") || "none";

  const config: BenchmarkConfig = {
    url,
    runs,
    warmupRuns,
    throttle,
    waitUntil,
  };

  try {
    const results = await runBenchmark(config);
    const stats = calculateStats(results);
    printReport(stats, config);

    // JSON 출력 (CI용)
    const jsonOutput = {
      timestamp: new Date().toISOString(),
      config,
      stats,
      raw: results,
    };

    console.log("\n📄 JSON Output:");
    console.log(JSON.stringify(jsonOutput, null, 2));

    if (jsonOut) {
      const resolvedPath = path.resolve(jsonOut);
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, JSON.stringify(jsonOutput, null, 2), "utf8");
      console.log(`\n💾 Saved JSON output to ${resolvedPath}`);
    }
  } catch (error) {
    console.error("Benchmark failed:", error);
    process.exit(1);
  }
}

main();
