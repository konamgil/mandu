/**
 * Mandu CLI - Contract Commands
 * Contract 생성 및 검증 명령어
 */

import {
  runContractGuardCheck,
  generateContractTemplate,
  buildContractRegistry,
  writeContractRegistry,
  readContractRegistry,
  diffContractRegistry,
  validateAndReport,
} from "@mandujs/core";
import path from "path";
import fs from "fs/promises";
import { resolveManifest } from "../util/manifest";

interface ContractCreateOptions {
  routeId: string;
}

interface ContractValidateOptions {
  verbose?: boolean;
}

interface ContractBuildOptions {
  output?: string;
}

interface ContractDiffOptions {
  from?: string;
  to?: string;
  output?: string;
  json?: boolean;
}

async function loadRoutesManifest(rootDir: string) {
  const config = await validateAndReport(rootDir);
  if (!config) {
    throw new Error("Invalid mandu.config");
  }
  const resolved = await resolveManifest(rootDir, { fsRoutes: config.fsRoutes });
  return resolved.manifest;
}

/**
 * Create a new contract file for a route
 */
export async function contractCreate(options: ContractCreateOptions): Promise<boolean> {
  const rootDir = process.cwd();

  console.log(`\n📜 Creating contract for route: ${options.routeId}\n`);

  // Load manifest
  let manifest;
  try {
    manifest = await loadRoutesManifest(rootDir);
  } catch (error) {
    console.error("❌ Failed to load manifest:", error instanceof Error ? error.message : error);
    return false;
  }

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

  console.log(`\n🔍 Validating contracts...\n`);

  // Load manifest
  let manifest;
  try {
    manifest = await loadRoutesManifest(rootDir);
  } catch (error) {
    console.error("❌ Failed to load manifest:", error instanceof Error ? error.message : error);
    return false;
  }

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

/**
 * Build contract registry (.mandu/contracts.json)
 */
export async function contractBuild(options: ContractBuildOptions = {}): Promise<boolean> {
  const rootDir = process.cwd();
  const outputPath = options.output || path.join(rootDir, ".mandu", "contracts.json");

  console.log(`\n📦 Building contract registry...\n`);

  let manifest;
  try {
    manifest = await loadRoutesManifest(rootDir);
  } catch (error) {
    console.error("❌ Failed to load manifest:", error instanceof Error ? error.message : error);
    return false;
  }
  const { registry, warnings } = await buildContractRegistry(manifest, rootDir);

  if (warnings.length > 0) {
    console.log(`⚠️  ${warnings.length} warning(s):`);
    for (const warning of warnings) {
      console.log(`   - ${warning}`);
    }
    console.log();
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await writeContractRegistry(outputPath, registry);

  console.log(`✅ Registry generated: ${path.relative(rootDir, outputPath)}`);
  console.log(`📊 Contracts: ${registry.contracts.length}`);

  return true;
}

/**
 * Diff current contracts against a registry
 */
export async function contractDiff(options: ContractDiffOptions = {}): Promise<boolean> {
  const rootDir = process.cwd();
  const fromPath = options.from || path.join(rootDir, ".mandu", "contracts.json");

  console.log(`\n🔍 Diffing contracts...\n`);

  const fromRegistry = await readContractRegistry(fromPath);
  if (!fromRegistry) {
    console.error(`❌ Registry not found: ${path.relative(rootDir, fromPath)}`);
    console.log(`💡 Run \`mandu contract build\` first.`);
    return false;
  }

  let toRegistry = options.to ? await readContractRegistry(options.to) : null;

  if (!toRegistry) {
    let manifest;
    try {
      manifest = await loadRoutesManifest(rootDir);
    } catch (error) {
      console.error("❌ Failed to load manifest:", error instanceof Error ? error.message : error);
      return false;
    }
    const { registry } = await buildContractRegistry(manifest, rootDir);
    toRegistry = registry;
  }

  const diff = diffContractRegistry(fromRegistry, toRegistry);

  if (options.output) {
    await fs.mkdir(path.dirname(options.output), { recursive: true });
    await Bun.write(options.output, JSON.stringify(diff, null, 2));
    console.log(`✅ Diff saved: ${path.relative(rootDir, options.output)}`);
  }

  if (options.json) {
    console.log(JSON.stringify(diff, null, 2));
    return diff.summary.major === 0;
  }

  console.log(`📊 Summary: major ${diff.summary.major}, minor ${diff.summary.minor}, patch ${diff.summary.patch}`);

  if (diff.added.length > 0) {
    console.log(`\n🟢 Added (${diff.added.length})`);
    for (const entry of diff.added) {
      console.log(`  - ${entry.id} (${entry.routeId})`);
    }
  }

  if (diff.removed.length > 0) {
    console.log(`\n🔴 Removed (${diff.removed.length})`);
    for (const entry of diff.removed) {
      console.log(`  - ${entry.id} (${entry.routeId})`);
    }
  }

  if (diff.changed.length > 0) {
    console.log(`\n🟡 Changed (${diff.changed.length})`);
    for (const change of diff.changed) {
      console.log(`  - ${change.id} (${change.routeId}) [${change.severity}]`);
      for (const detail of change.changes) {
        console.log(`     • ${detail}`);
      }
    }
  }

  return diff.summary.major === 0;
}
