/**
 * Mandu Hydration Benchmark
 * Playwright 기반 하이드레이션 성능 측정
 */

import { chromium, type Browser, type Page } from "playwright";

interface BenchmarkResult {
  name: string;
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
  fcp: number;
  tti: number;
}> {
  const metrics = await page.evaluate(() => {
    return new Promise<{ fcp: number; tti: number }>((resolve) => {
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
        resolve({ fcp, tti });
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
  const browser = await chromium.launch({ headless: true });
  const results: BenchmarkResult[] = [];

  console.log(`\n🏃 Benchmark: ${config.url}`);
  console.log(`   Runs: ${config.runs} (+ ${config.warmupRuns} warmup)`);
  console.log(`   Network: ${config.throttle || "none"}\n`);

  // Warmup runs
  for (let i = 0; i < config.warmupRuns; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();

    if (config.throttle && config.throttle !== "none") {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.emulateNetworkConditions", NETWORK_CONDITIONS[config.throttle]!);
    }

    await page.goto(config.url, { waitUntil: "networkidle" });
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

    const startTime = Date.now();
    await page.goto(config.url, { waitUntil: "networkidle" });

    const [perfMetrics, hydrationMetrics, bundleSize, memoryUsage] = await Promise.all([
      measurePerformanceMetrics(page),
      measureHydration(page),
      measureBundleSize(page),
      measureMemory(page),
    ]);

    results.push({
      name: `Run ${i + 1}`,
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

  await browser.close();
  return results;
}

function calculateStats(results: BenchmarkResult[]) {
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const min = (arr: number[]) => Math.min(...arr);
  const max = (arr: number[]) => Math.max(...arr);
  const p95 = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  };

  const fcpValues = results.map((r) => r.fcp);
  const ttiValues = results.map((r) => r.tti);
  const hydrationValues = results.map((r) => r.hydrationTime);
  const bundleValues = results.map((r) => r.bundleSize);
  const memoryValues = results.map((r) => r.memoryUsage);

  return {
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
  const url = args[0] || "http://localhost:3000/todos";
  const runs = parseInt(args[1] || "5");
  const throttle = (args[2] as "3G" | "4G" | "none") || "none";

  const config: BenchmarkConfig = {
    url,
    runs,
    warmupRuns: 2,
    throttle,
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
  } catch (error) {
    console.error("Benchmark failed:", error);
    process.exit(1);
  }
}

main();
