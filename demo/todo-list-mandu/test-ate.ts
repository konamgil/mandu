#!/usr/bin/env bun

/**
 * ATE Test Runner for todo-list-mandu
 */

import { ateExtract, ateGenerate, ateRun, ateReport } from "@mandujs/ate";

async function runATE() {
  const repoRoot = process.cwd();

  console.log("🚀 ATE E2E Test Runner");
  console.log("=".repeat(50));

  // Step 1: Extract
  console.log("\n📊 Step 1: Extracting interaction graph...");
  try {
    const extractResult = await ateExtract({
      repoRoot,
      routeGlobs: ["app/**/page.tsx"],
      buildSalt: "dev",
    });

    console.log("✅ Extract complete!");
    console.log(`   Graph: ${extractResult.graphPath}`);
    console.log(`   Nodes: ${extractResult.summary.nodes}`);
    console.log(`   Edges: ${extractResult.summary.edges}`);

    if (extractResult.warnings.length > 0) {
      console.log("⚠️  Warnings:");
      extractResult.warnings.forEach(w => console.log(`   - ${w}`));
    }
  } catch (err: any) {
    console.error("❌ Extract failed:", err.message);
    process.exit(1);
  }

  // Step 2: Generate
  console.log("\n🎭 Step 2: Generating test scenarios...");
  try {
    const generateResult = await ateGenerate({
      repoRoot,
      oracleLevel: "L1", // Domain-aware assertions
    });

    console.log("✅ Generate complete!");
    console.log(`   Result:`, JSON.stringify(generateResult, null, 2));
  } catch (err: any) {
    console.error("❌ Generate failed:", err.message);
    process.exit(1);
  }

  // Step 3: Run (skip for now - requires dev server)
  console.log("\n⏭️  Step 3: Skipping test execution (dev server required)");
  console.log("   To run tests:");
  console.log("   1. Start dev server: bun run dev");
  console.log("   2. Run tests: bun test:e2e");

  console.log("\n" + "=".repeat(50));
  console.log("✅ ATE setup complete!");
  console.log("\n📁 Generated files:");
  console.log("   - .mandu/interaction-graph.json");
  console.log("   - .mandu/scenarios/generated.json");
  console.log("   - tests/e2e/auto/*.spec.ts");
  console.log("   - tests/e2e/playwright.config.ts");
}

runATE().catch(console.error);
