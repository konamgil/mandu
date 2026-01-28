/**
 * Mandu CLI - Contract Commands
 * Contract 생성 및 검증 명령어
 */

import { loadManifest, runContractGuardCheck, generateContractTemplate } from "@mandujs/core";
import path from "path";
import fs from "fs/promises";

interface ContractCreateOptions {
  routeId: string;
}

interface ContractValidateOptions {
  verbose?: boolean;
}

/**
 * Create a new contract file for a route
 */
export async function contractCreate(options: ContractCreateOptions): Promise<boolean> {
  const rootDir = process.cwd();
  const manifestPath = path.join(rootDir, "spec/routes.manifest.json");

  console.log(`\n📜 Creating contract for route: ${options.routeId}\n`);

  // Load manifest
  const manifestResult = await loadManifest(manifestPath);
  if (!manifestResult.success) {
    console.error("❌ Failed to load manifest:", manifestResult.errors);
    return false;
  }

  const manifest = manifestResult.data!;

  // Find the route
  const route = manifest.routes.find((r) => r.id === options.routeId);
  if (!route) {
    console.error(`❌ Route not found: ${options.routeId}`);
    console.log(`\nAvailable routes:`);
    for (const r of manifest.routes) {
      console.log(`  - ${r.id} (${r.pattern})`);
    }
    return false;
  }

  // Check if contract already exists
  const contractPath = route.contractModule || `spec/contracts/${options.routeId}.contract.ts`;
  const fullContractPath = path.join(rootDir, contractPath);

  try {
    await fs.access(fullContractPath);
    console.error(`❌ Contract file already exists: ${contractPath}`);
    console.log(`\nTo regenerate, delete the file first.`);
    return false;
  } catch {
    // File doesn't exist, we can create it
  }

  // Create directory if needed
  const contractDir = path.dirname(fullContractPath);
  await fs.mkdir(contractDir, { recursive: true });

  // Generate contract content
  const contractContent = generateContractTemplate(route);

  // Write contract file
  await Bun.write(fullContractPath, contractContent);
  console.log(`✅ Created: ${contractPath}`);

  // Suggest updating manifest
  if (!route.contractModule) {
    console.log(`\n💡 Don't forget to add contractModule to your manifest:`);
    console.log(`   "contractModule": "${contractPath}"`);
  }

  console.log(`\n📝 Next steps:`);
  console.log(`   1. Edit ${contractPath} to define your API schema`);
  console.log(`   2. Run \`mandu generate\` to regenerate handlers`);
  console.log(`   3. Run \`mandu guard\` to validate contract-slot consistency`);

  return true;
}

/**
 * Validate all contracts against their slot implementations
 */
export async function contractValidate(options: ContractValidateOptions = {}): Promise<boolean> {
  const rootDir = process.cwd();
  const manifestPath = path.join(rootDir, "spec/routes.manifest.json");

  console.log(`\n🔍 Validating contracts...\n`);

  // Load manifest
  const manifestResult = await loadManifest(manifestPath);
  if (!manifestResult.success) {
    console.error("❌ Failed to load manifest:", manifestResult.errors);
    return false;
  }

  const manifest = manifestResult.data!;

  // Run contract guard check
  const violations = await runContractGuardCheck(manifest, rootDir);

  if (violations.length === 0) {
    console.log(`✅ All contracts are valid!\n`);

    // Show summary
    const contractCount = manifest.routes.filter((r) => r.contractModule).length;
    console.log(`📊 Summary:`);
    console.log(`   Routes with contracts: ${contractCount}/${manifest.routes.length}`);

    return true;
  }

  // Group violations by type
  const byType: Record<string, typeof violations> = {};
  for (const v of violations) {
    byType[v.ruleId] = byType[v.ruleId] || [];
    byType[v.ruleId].push(v);
  }

  // Display violations
  console.log(`❌ Found ${violations.length} contract issues:\n`);

  for (const [ruleId, ruleViolations] of Object.entries(byType)) {
    const icon =
      ruleId === "CONTRACT_METHOD_NOT_IMPLEMENTED"
        ? "🔴"
        : ruleId === "CONTRACT_METHOD_UNDOCUMENTED"
          ? "🟡"
          : "⚠️";

    console.log(`${icon} ${ruleId} (${ruleViolations.length} issues)`);

    for (const v of ruleViolations) {
      console.log(`   📄 ${v.file}`);
      console.log(`      ${v.message}`);
      if (options.verbose) {
        console.log(`      💡 ${v.suggestion}`);
      }
    }
    console.log();
  }

  if (!options.verbose) {
    console.log(`💡 Use --verbose for fix suggestions\n`);
  }

  return false;
}
