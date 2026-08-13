#!/usr/bin/env bun
/**
 * Pre-publish check: workspace 의존성이 올바르게 해결되었는지 확인
 */

import { execFileSync, execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import * as fs from "fs/promises";
import { Glob } from "bun";
import { tmpdir } from "os";
import { join, resolve } from "path";
import ts from "typescript";
import { checkPublicApiBoundary } from "./check-public-api-boundary";
import { checkPackageBoundaries } from "./check-package-boundaries";
import { checkTargetBoundaries } from "./check-target-boundaries";
import { checkDocsDrift } from "./check-docs-drift";
import { collectTempArtifactDirs } from "./pre-publish-temp-artifacts";
import {
  collectPublishOrderIssues,
  PRODUCT_PACKAGE_DIRS,
  PUBLISHABLE_PACKAGE_DIRS,
} from "./publish-order";
import {
  transformClientBoundaries,
  validateClientBoundaryServerOnlyImports,
} from "../packages/core/src/bundler/client-boundary-transform";

interface PackageJson {
  name: string;
  version: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function dependencyBlocks(pkg: PackageJson): Array<[string, Record<string, string> | undefined]> {
  return [
    ["dependencies", pkg.dependencies],
    ["devDependencies", pkg.devDependencies],
    ["peerDependencies", pkg.peerDependencies],
    ["optionalDependencies", pkg.optionalDependencies],
  ];
}

function loadVersionMap(packageDirs: string[]): Map<string, string> {
  const versions = new Map<string, string>();
  for (const pkgDir of packageDirs) {
    const pkg: PackageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), pkgDir, "package.json"), "utf-8")
    );
    versions.set(pkg.name, pkg.version);
  }
  return versions;
}

/**
 * Issue #262 — Open-ended peer ranges (`">=0.1.0"`, `"*"`, `">=0"`) on
 * internal packages effectively claim compatibility with every past and
 * future version, which silently lets package managers pick a stale
 * core into the resolver tree (see #261 for the downstream impact).
 *
 * Accept only specs that close the upper bound: `workspace:*`, caret,
 * tilde, exact pin, or any range containing `<`. `catalog:` is rejected
 * for peerDeps because catalog refs don't survive the published tarball.
 */
function isAcceptableInternalSourceSpec(blockName: string, spec: string, _version: string): boolean {
  if (blockName === "peerDependencies") {
    if (spec.startsWith("catalog:")) return false;
    if (spec.startsWith("workspace:")) return true;
    if (/^\^[0-9]/.test(spec)) return true;
    if (/^~[0-9]/.test(spec)) return true;
    if (/^[0-9]+\.[0-9]+\.[0-9]+(-[^ ]+)?$/.test(spec)) return true; // exact pin
    if (/<[0-9]/.test(spec)) return true; // explicit upper bound
    return false;
  }
  return spec.startsWith("workspace:") || spec === _version || spec === `^${_version}`;
}

function checkPackage(
  pkgPath: string,
  versionMap: Map<string, string>
): { name: string; issues: string[]; ok: string[] } {
  const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const issues: string[] = [];
  const ok: string[] = [];

  for (const [blockName, deps] of dependencyBlocks(pkg)) {
    if (!deps) continue;
    for (const [dep, spec] of Object.entries(deps)) {
      const workspaceVersion = versionMap.get(dep);
      if (!workspaceVersion) continue;

      if (isAcceptableInternalSourceSpec(blockName, spec, workspaceVersion)) {
        ok.push(`✅ ${blockName}.${dep}: ${spec}`);
      } else if (blockName === "peerDependencies") {
        issues.push(
          `❌ ${blockName}.${dep}: ${spec} (open-ended — use ^${workspaceVersion}, exact pin, or explicit upper bound; #262)`
        );
      } else {
        issues.push(
          `❌ ${blockName}.${dep}: ${spec} (expected workspace:* or ${workspaceVersion}/^${workspaceVersion})`
        );
      }
    }
  }

  return { name: pkg.name, issues, ok };
}

function collectExportTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectExportTargets);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectExportTargets);
  }
  return [];
}

function checkExportMap(pkgDir: string): { name: string; issues: string[]; ok: string[] } {
  const pkgPath = resolve(pkgDir, "package.json");
  const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const issues: string[] = [];
  const ok: string[] = [];

  if (!pkg.exports) {
    return { name: pkg.name, issues, ok };
  }

  if (pkg.name === "@mandujs/core" && Object.hasOwn(pkg.exports, "./*")) {
    issues.push("❌ exports./*: wildcard export makes every src file public");
  }

  for (const [subpath, target] of Object.entries(pkg.exports)) {
    for (const rawTarget of collectExportTargets(target)) {
      if (!rawTarget.startsWith(".") || rawTarget.includes("*")) continue;
      const targetPath = resolve(pkgDir, rawTarget);
      if (!existsSync(targetPath)) {
        issues.push(`❌ exports.${subpath}: target does not exist (${rawTarget})`);
      }
    }
  }

  if (issues.length === 0) {
    ok.push("✅ exports: explicit targets exist");
  }

  return { name: pkg.name, issues, ok };
}

async function resolveWorkspaceDepsForPack(
  pkgDir: string,
  versionMap: Map<string, string>
): Promise<string | null> {
  const filePath = join(pkgDir, "package.json");
  const original = await fs.readFile(filePath, "utf-8");
  const pkg: PackageJson = JSON.parse(original);
  let changed = false;

  for (const [, deps] of dependencyBlocks(pkg)) {
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (!spec.startsWith("workspace:")) continue;
      const version = versionMap.get(name);
      if (!version) continue;
      deps[name] = `^${version}`;
      changed = true;
    }
  }

  if (!changed) return null;

  await fs.writeFile(filePath, JSON.stringify(pkg, null, 2) + "\n");
  return original;
}

/**
 * Stage a tarball via `bun pm pack` and assert the extracted package.json
 * contains no unsubstituted `workspace:` / `catalog:` specifiers or stale
 * internal @mandujs versions.
 *
 * Runs serially per package. When a source package uses `workspace:*`, this
 * mirrors `scripts/publish.ts` by resolving it before packing and restoring
 * the original package.json in a finally block.
 */
async function assertPackedPackageJson(
  pkgDir: string,
  versionMap: Map<string, string>
): Promise<string[]> {
  const issues: string[] = [];
  const tmp = await fs.mkdtemp(join(tmpdir(), "mandu-publish-check-"));
  let originalPackageJson: string | null = null;

  try {
    originalPackageJson = await resolveWorkspaceDepsForPack(pkgDir, versionMap);

    execSync(`bun pm pack --destination "${tmp}"`, {
      cwd: pkgDir,
      stdio: "pipe",
    });

    const entries = await fs.readdir(tmp);
    const tarball = entries.find((entry) => entry.endsWith(".tgz"));
    if (!tarball) {
      issues.push(`❌ ${pkgDir}: bun pm pack produced no tarball`);
      return issues;
    }

    // Use bsdtar on Windows (System32\tar.exe) which handles drive letters;
    // msys tar (/usr/bin/tar) treats "C:" as a remote host spec and fails.
    const tarCmd = process.platform === "win32"
      ? `"${join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")}" -xzf "${join(tmp, tarball)}" -C "${tmp}"`
      : `tar -xzf "${join(tmp, tarball)}" -C "${tmp}"`;
    execSync(tarCmd, { stdio: "pipe" });

    const stagedRoot = join(tmp, "package");
    const stagedPkgPath = join(stagedRoot, "package.json");
    const staged = await fs.readFile(stagedPkgPath, "utf-8");
    const parsed: PackageJson = JSON.parse(staged);

    for (const [blockName, block] of dependencyBlocks(parsed)) {
      if (!block) continue;
      for (const [name, spec] of Object.entries(block)) {
        if (spec.startsWith("catalog:")) {
          issues.push(`❌ ${parsed.name}: ${blockName}.${name}@${spec} (catalog ref leaked into tarball!)`);
        }
        if (spec.startsWith("workspace:")) {
          issues.push(`❌ ${parsed.name}: ${blockName}.${name}@${spec} (workspace ref leaked into tarball!)`);
        }

        const expectedVersion = versionMap.get(name);
        if (
          expectedVersion &&
          blockName !== "peerDependencies" &&
          spec !== expectedVersion &&
          spec !== `^${expectedVersion}`
        ) {
          issues.push(
            `❌ ${parsed.name}: ${blockName}.${name}@${spec} (expected ${expectedVersion} or ^${expectedVersion})`
          );
        }
      }
    }

    if (parsed.name === "@mandujs/core") {
      const representativeSubpaths = [
        "@mandujs/core/runtime",
        "@mandujs/core/compat/paths",
        "@mandujs/core/compat/runtime/server",
        "@mandujs/core/compat/resource/index",
        "@mandujs/core/compat/components/Image-compat",
      ];

      for (const specifier of representativeSubpaths) {
        try {
          execFileSync(
            process.execPath,
            ["-e", `console.log(import.meta.resolve(${JSON.stringify(specifier)}))`],
            { cwd: stagedRoot, stdio: "pipe" }
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          issues.push(`❌ ${parsed.name}: tarball cannot resolve ${specifier} (${detail})`);
        }
      }
    }

    if (issues.length === 0) {
      console.log(`  ✅ ${parsed.name} tarball: dependencies and representative subpaths resolve`);
    }
  } finally {
    if (originalPackageJson !== null) {
      await fs.writeFile(join(pkgDir, "package.json"), originalPackageJson);
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }

  return issues;
}

/**
 * Issue #260 — Cross-package subpath audit.
 *
 * Background: `@mandujs/mcp@0.36.1` shipped against `@mandujs/core@^0.53.0`,
 * but core 0.53.0's `exports` map omitted `./guard/design-inline-class` even
 * though the file existed on disk and mcp imported it. Bootstrapping the MCP
 * server died with `Cannot find module @mandujs/core/guard/design-inline-class`,
 * making `bunx @mandujs/mcp` unusable for every end-user that hit that
 * version pair.
 *
 * This step parses each publishable package's `src/**` and collects static
 * imports/exports plus literal dynamic imports and `require` calls, then asserts every subpath is
 * declared in the target package's `exports` map. Catches the regression at
 * publish time instead of at user-install time.
 *
 * Scope: explicit subpath imports only. Root-level (`@mandujs/core`) and
 * dynamic imports are ignored — those don't trigger the subpath gate.
 * Markdown / docs files are ignored — those are illustrative snippets, not
 * runtime code paths.
 */
const INTERNAL_PACKAGE_NAMES = [
  "@mandujs/core",
  "@mandujs/ate",
  "@mandujs/skills",
  "@mandujs/mcp",
  "@mandujs/cli",
  "@mandujs/edge",
];

interface ImportSite {
  consumerPackage: string;
  file: string;
  pkg: string;
  subpath: string;
}

function parseInternalSpecifier(specifier: string): { pkg: string; subpath: string } | null {
  for (const pkg of INTERNAL_PACKAGE_NAMES) {
    const prefix = `${pkg}/`;
    if (specifier.startsWith(prefix)) {
      return { pkg, subpath: specifier.slice(prefix.length) };
    }
  }
  return null;
}

function collectModuleSpecifiers(file: string, sourceText: string): string[] {
  const kind = file.endsWith(".tsx") || file.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, kind);
  const specifiers: string[] = [];
  const addLiteral = (node: ts.Expression | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) addLiteral(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

async function scanInternalSubpathImports(pkgDir: string, pkgName: string): Promise<ImportSite[]> {
  const srcDir = resolve(pkgDir, "src");
  if (!existsSync(srcDir)) return [];

  const sites: ImportSite[] = [];
  const glob = new Glob("**/*.{ts,tsx,js,mjs,cjs}");

  for await (const rel of glob.scan({ cwd: srcDir })) {
    const file = resolve(srcDir, rel);
    const text = await fs.readFile(file, "utf-8");
    for (const specifier of collectModuleSpecifiers(file, text)) {
      const parsed = parseInternalSpecifier(specifier);
      if (!parsed) continue;
      const { pkg, subpath } = parsed;
      if (pkg === pkgName) continue; // intra-package, doesn't traverse exports
      sites.push({ consumerPackage: pkgName, file, pkg, subpath });
    }
  }

  return sites;
}

function exportsKeySet(pkg: PackageJson): Set<string> {
  if (!pkg.exports) return new Set();
  return new Set(Object.keys(pkg.exports));
}

function subpathToExportsKey(subpath: string): string {
  return `./${subpath}`;
}

/**
 * Walk the exports map keys for any pattern entry (`./foo/*`) that would
 * resolve the given subpath. Conservative — only handles trailing `*`,
 * which is the only pattern shape currently used by @mandujs/*.
 */
function exportsCovers(exportsKeys: Set<string>, subpathKey: string): boolean {
  if (exportsKeys.has(subpathKey)) return true;
  for (const key of exportsKeys) {
    if (!key.endsWith("/*")) continue;
    const prefix = key.slice(0, -1); // "./foo/"
    if (subpathKey.startsWith(prefix)) return true;
  }
  return false;
}

async function auditCrossPackageSubpaths(
  versionMap: Map<string, string>,
  packageDirs = PUBLISHABLE_PACKAGE_DIRS,
): Promise<string[]> {
  const issues: string[] = [];

  const pkgInfoByName = new Map<string, { dir: string; pkg: PackageJson; exportsKeys: Set<string> }>();
  for (const pkgDir of packageDirs) {
    const abs = resolve(process.cwd(), pkgDir);
    const pkg: PackageJson = JSON.parse(readFileSync(resolve(abs, "package.json"), "utf-8"));
    pkgInfoByName.set(pkg.name, { dir: abs, pkg, exportsKeys: exportsKeySet(pkg) });
  }

  for (const [consumerName, info] of pkgInfoByName) {
    const sites = await scanInternalSubpathImports(info.dir, consumerName);
    for (const site of sites) {
      const target = pkgInfoByName.get(site.pkg);
      if (!target) continue; // foreign internal name (shouldn't happen, but be defensive)

      const key = subpathToExportsKey(site.subpath);
      if (exportsCovers(target.exportsKeys, key)) continue;

      const relFile = site.file.replace(process.cwd() + "/", "").replace(process.cwd() + "\\", "");
      issues.push(
        `❌ ${consumerName} imports ${site.pkg}/${site.subpath} (${relFile}) — missing "${key}" in ${site.pkg}/package.json#exports`
      );
    }
  }

  return issues;
}

function checkClientBoundaryGuardrails(): string[] {
  const issues: string[] = [];
  const transformResult = transformClientBoundaries(
    `
import Widget from "./Widget.client";

export default function Page({ actionRef }) {
  return (
    <table>
      <tbody>
        <tr>
          <Widget ref={actionRef} onSave={() => actionRef.current?.()}><span>child</span></Widget>
        </tr>
      </tbody>
    </table>
  );
}
`,
    {
      routeId: "prepublish-boundary",
      fileName: "app/prepublish/page.tsx",
    },
  );
  const codes = new Set(transformResult.diagnostics.map((diagnostic) => diagnostic.code));
  const expectedCodes = [
    "MANDU_BOUNDARY_INVALID_HOST_CONTEXT",
    "MANDU_BOUNDARY_UNSUPPORTED_CHILDREN",
    "MANDU_BOUNDARY_UNSUPPORTED_REF",
    "MANDU_BOUNDARY_UNSUPPORTED_FUNCTION_PROP",
  ] as const;
  for (const expected of expectedCodes) {
    if (!codes.has(expected)) {
      issues.push(`❌ Missing client boundary guardrail diagnostic: ${expected}`);
    }
  }

  const serverOnlyDiagnostics = validateClientBoundaryServerOnlyImports(
    `
import { readFile } from "node:fs/promises";
import "server-only";
export default function Widget() { return String(readFile); }
`,
    {
      id: "prepublish-boundary--0",
      routeId: "prepublish-boundary",
      module: "src/client/Widget.client.tsx",
      exportName: "default",
    },
    "src/client/Widget.client.tsx",
  );
  if (!serverOnlyDiagnostics.some((diagnostic) => diagnostic.code === "MANDU_BOUNDARY_SERVER_ONLY_IMPORT")) {
    issues.push("❌ Missing client boundary guardrail diagnostic: MANDU_BOUNDARY_SERVER_ONLY_IMPORT");
  }

  return issues;
}

const productRelease = process.argv.includes("--product");
const releasePackageDirs = productRelease ? PRODUCT_PACKAGE_DIRS : PUBLISHABLE_PACKAGE_DIRS;

console.log(
  productRelease
    ? "🔍 Product release check: Core + MCP + CLI\n"
    : "🔍 Pre-publish check: all publishable packages\n",
);

const versions = loadVersionMap(releasePackageDirs);
let hasIssues = false;

// 1. lockfile consistency 확인
console.log("📦 Step 1: Frozen lockfile consistency 확인...");
try {
  const lockfiles = ["bun.lock", "bun.lockb"].filter((file) =>
    existsSync(resolve(process.cwd(), file))
  );
  if (lockfiles.length === 0) throw new Error("No Bun lockfile found");
  execSync("bun install --frozen-lockfile --lockfile-only --ignore-scripts", {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  console.log("✅ Frozen lockfile is internally consistent\n");
} catch {
  hasIssues = true;
  console.log("❌ Frozen lockfile validation failed\n");
}

// 1.1. npm registry metadata drift 차단
console.log("🧾 Step 1.1: npm version/metadata drift 확인...\n");

try {
  execSync(
    productRelease
      ? "bun run scripts/check-npm-drift.ts --product"
      : "bun run check:npm-drift",
    { stdio: "inherit", cwd: process.cwd() },
  );
} catch {
  hasIssues = true;
  console.log();
  console.log(
    "  💡 Bump the package version, revert the local metadata change, or publish the unpublished newer version."
  );
}

console.log();

// 1.2. hydration runtime/browser regression gate
console.log("🏝️ Step 1.2: Hydration runtime/browser gate...\n");

try {
  execSync("bun run check:hydration", { stdio: "inherit", cwd: process.cwd() });
} catch {
  hasIssues = true;
  console.log();
  console.log(
    "  💡 Fix the hydration boundary/runtime regression before publishing."
  );
}

console.log();

// 1.5. publishable package 안에 남은 임시 테스트 산출물 차단
console.log("🧹 Step 1.5: 임시 테스트 산출물 확인...\n");

let tempArtifactIssues = false;
for (const pkgDir of releasePackageDirs) {
  const abs = resolve(process.cwd(), pkgDir);
  const tempIssues = await collectTempArtifactDirs(abs);
  if (tempIssues.length > 0) {
    hasIssues = true;
    tempArtifactIssues = true;
    tempIssues.forEach((issue) => console.log(`  ${issue}`));
  }
}
if (!tempArtifactIssues) {
  console.log("  ✅ No .tmp-* directories inside publishable packages");
}
console.log();

// 1.6. publish 순서가 내부 의존성 위상을 따르는지 확인
console.log("📚 Step 1.6: Publish order dependency graph 확인...\n");

const publishOrderIssues = collectPublishOrderIssues(releasePackageDirs, process.cwd());
if (publishOrderIssues.length > 0) {
  hasIssues = true;
  publishOrderIssues.forEach((issue) => console.log(`  ${issue}`));
} else {
  console.log("  ✅ Publish order respects internal package dependencies");
}
console.log();

// 2. workspace 의존성 검증
console.log("🔗 Step 2: Workspace 의존성 검증...\n");

for (const pkgDir of releasePackageDirs) {
  const pkgPath = resolve(process.cwd(), pkgDir, "package.json");
  try {
    const { name, issues, ok } = checkPackage(pkgPath, versions);
    console.log(`📦 ${name}`);
    ok.forEach((line) => console.log(`  ${line}`));

    if (issues.length > 0) {
      hasIssues = true;
      issues.forEach((issue) => console.log(`  ${issue}`));
    }

    const exportCheck = checkExportMap(resolve(process.cwd(), pkgDir));
    exportCheck.ok.forEach((line) => console.log(`  ${line}`));
    if (exportCheck.issues.length > 0) {
      hasIssues = true;
      exportCheck.issues.forEach((issue) => console.log(`  ${issue}`));
    }
    console.log();
  } catch (err: unknown) {
    console.error(`❌ Error reading ${pkgPath}:`, err instanceof Error ? err.message : String(err));
    hasIssues = true;
  }
}

// 3. 스테이지된 tarball 검증 (catalog:/workspace: 누설 방지)
console.log("📦 Step 3: 스테이지된 tarball 검증...\n");

for (const pkgDir of releasePackageDirs) {
  const abs = resolve(process.cwd(), pkgDir);
  try {
    const leakIssues = await assertPackedPackageJson(abs, versions);
    if (leakIssues.length > 0) {
      hasIssues = true;
      leakIssues.forEach((issue) => console.log(`  ${issue}`));
    }
  } catch (err) {
    hasIssues = true;
    console.error(`❌ Tarball check failed for ${pkgDir}:`, err instanceof Error ? err.message : String(err));
  }
}
console.log();

// 4. 버전 일관성 검증
console.log("🔢 Step 4: 버전 일관성 검증...\n");

for (const pkgDir of releasePackageDirs) {
  const pkg: PackageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), pkgDir, "package.json"), "utf-8")
  );
  console.log(`  ${pkg.name}: ${pkg.version}`);
}

console.log();

// 5. Core public API boundary classification
console.log("🧭 Step 5: Core public API boundary classification...\n");

try {
  const boundary = checkPublicApiBoundary(process.cwd());
  if (boundary.issues.length > 0) {
    hasIssues = true;
    boundary.issues.forEach((issue) => console.log(`  ${issue}`));
    console.log();
    console.log("  💡 Classify the export in scripts/check-public-api-boundary.ts before release.");
  } else {
    console.log(
      `  ✅ classified exports: stable=${boundary.classified.stable.length}, experimental=${boundary.classified.experimental.length}, internal=${boundary.classified.internal.length}`
    );
  }
} catch (err) {
  hasIssues = true;
  console.error(
    "  ❌ public API boundary check failed:",
    err instanceof Error ? err.message : String(err)
  );
}

console.log();

// 5.5. Phase 3 generated-surface drift gates
console.log("🧩 Step 5.5: Core v1 imports and official skill generation...\n");

for (const command of ["bun run check:core-v1-imports", "bun run check:official-skills"]) {
  try {
    execSync(command, { stdio: "inherit", cwd: process.cwd() });
  } catch {
    hasIssues = true;
  }
}

console.log();

// 5.7. Typed apply safety and recovery benchmark
console.log("🧾 Step 5.7: Typed apply safety/recovery gate...\n");

try {
  execSync("bun run test:agent-apply-gate", { stdio: "inherit", cwd: process.cwd() });
} catch {
  hasIssues = true;
}

console.log();

// 5.8. Stable reference-app Golden Paths
console.log("🥟 Step 5.8: Reference app Golden Paths...\n");

try {
  execSync("bun run test:reference-apps", { stdio: "inherit", cwd: process.cwd() });
} catch {
  hasIssues = true;
}

console.log();

// 6. Target-safe import boundary check
console.log("🧱 Step 6: Target-safe import boundary check...\n");

try {
  const targetBoundaryIssues = await checkTargetBoundaries(process.cwd());
  if (targetBoundaryIssues.length > 0) {
    hasIssues = true;
    targetBoundaryIssues.forEach((issue) => {
      console.log(
        `  ❌ ${issue.file}: ${issue.kind} import of ${issue.specifier} violates "${issue.policy}" (${issue.reason})`
      );
    });
    console.log();
    console.log(
      "  💡 Keep optional peers lazy and keep edge/browser source free of static Node/Bun imports."
    );
  } else {
    console.log("  ✅ Optional peer and target import boundaries are clean");
  }
} catch (err) {
  hasIssues = true;
  console.error(
    "  ❌ target boundary check failed:",
    err instanceof Error ? err.message : String(err)
  );
}

console.log();

// 6.5. Stable product package and Core owner boundaries
console.log("🧭 Step 6.5: Product package/Core owner boundaries...\n");

try {
  const packageBoundaryIssues = await checkPackageBoundaries(process.cwd());
  if (packageBoundaryIssues.length > 0) {
    hasIssues = true;
    packageBoundaryIssues.forEach((issue) => {
      console.log(
        `  ❌ ${issue.file}: ${issue.kind} dependency on ${issue.specifier} violates \"${issue.policy}\" (${issue.reason})`,
      );
    });
  } else {
    console.log("  ✅ Core runtime/safety/actions and Core <- CLI/MCP boundaries are clean");
  }
} catch (err) {
  hasIssues = true;
  console.error(
    "  ❌ package boundary check failed:",
    err instanceof Error ? err.message : String(err),
  );
}

console.log();

// 7. Cross-package subpath audit (#260 회귀 방지)
console.log("🔗 Step 7: Cross-package subpath audit (#260)...\n");

try {
  const auditIssues = await auditCrossPackageSubpaths(versions, releasePackageDirs);
  if (auditIssues.length > 0) {
    hasIssues = true;
    auditIssues.forEach((issue) => console.log(`  ${issue}`));
    console.log();
    console.log(
      "  💡 Fix by adding the missing subpath to the target package's exports map,"
    );
    console.log("     or rewrite the consumer import to go through a public entry.");
  } else {
    console.log("  ✅ All internal subpath imports are reachable via exports map");
  }
} catch (err) {
  hasIssues = true;
  console.error(
    "  ❌ subpath audit failed:",
    err instanceof Error ? err.message : String(err)
  );
}

console.log();

// 8. Template tsconfig integrity (#267/#272 회귀 방지)
//
// Issue #267 introduced layer-specific paths to replace an invalid `*`
// pattern, but the new paths were non-relative and lacked `baseUrl`,
// triggering #272 with three new warnings on every mandu command. This
// step asserts every CLI template's tsconfig is internally consistent.
console.log("🧩 Step 8: Template tsconfig integrity (#267/#272)...\n");

const TEMPLATE_DIRS = [
  "packages/cli/templates/default",
  "packages/cli/templates/auth-starter",
  "packages/cli/templates/realtime-chat",
];

interface TsconfigShape {
  compilerOptions?: {
    paths?: Record<string, string[]>;
    baseUrl?: string;
  };
}

function flattenPathTargets(paths: Record<string, string[]> | undefined): string[] {
  if (!paths) return [];
  return Object.values(paths).flat();
}

function isRelative(target: string): boolean {
  return target.startsWith("./") || target.startsWith("../");
}

function validateTsconfigPaths(cfg: TsconfigShape, file: string): string[] {
  const issues: string[] = [];
  const opts = cfg.compilerOptions ?? {};
  const targets = flattenPathTargets(opts.paths);
  if (targets.length === 0) return issues;

  // Rule 1 — TS spec: `paths` targets must be relative OR baseUrl must be set.
  // (#272 root cause.)
  const hasNonRelative = targets.some((t) => !isRelative(t));
  if (hasNonRelative && opts.baseUrl === undefined) {
    issues.push(
      `❌ ${file}: paths contain non-relative targets but baseUrl is not set (#272)`
    );
  }

  // Rule 2 — TS spec: each `paths` pattern key may contain at most one `*`.
  // (#267 root cause.)
  for (const pattern of Object.keys(opts.paths ?? {})) {
    const stars = (pattern.match(/\*/g) ?? []).length;
    if (stars > 1) {
      issues.push(
        `❌ ${file}: paths pattern ${JSON.stringify(pattern)} has ${stars} \`*\` wildcards — TS allows at most one (#267)`
      );
    }
  }

  return issues;
}

for (const templateDir of TEMPLATE_DIRS) {
  const file = resolve(process.cwd(), templateDir, "tsconfig.json");
  if (!existsSync(file)) {
    console.log(`  ⏭️  ${templateDir}/tsconfig.json — not present, skipping`);
    continue;
  }
  let cfg: TsconfigShape;
  try {
    cfg = JSON.parse(readFileSync(file, "utf-8"));
  } catch (err) {
    hasIssues = true;
    console.log(
      `  ❌ ${templateDir}/tsconfig.json — JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    continue;
  }
  const issues = validateTsconfigPaths(cfg, `${templateDir}/tsconfig.json`);
  if (issues.length > 0) {
    hasIssues = true;
    issues.forEach((line) => console.log(`  ${line}`));
  } else {
    console.log(`  ✅ ${templateDir}/tsconfig.json: paths/baseUrl consistent`);
  }
}

console.log();

// 9. Official docs and CLI surface drift check
console.log("📚 Step 9: Docs/CLI drift check...\n");

try {
  const docsDriftIssues = checkDocsDrift(process.cwd());
  if (docsDriftIssues.length > 0) {
    hasIssues = true;
    docsDriftIssues.forEach((issue) => {
      console.log(`  ❌ ${issue.file}: ${issue.message}`);
    });
    console.log();
    console.log(
      "  💡 Keep README, docs README, CLI help, and smoke paths aligned with the canonical golden path."
    );
  } else {
    console.log("  ✅ Official docs, CLI generate help, and smoke path are aligned");
  }
} catch (err) {
  hasIssues = true;
  console.error(
    "  ❌ docs drift check failed:",
    err instanceof Error ? err.message : String(err)
  );
}

console.log();

// 10. F42 client boundary guardrail smoke
console.log("🧱 Step 10: Client boundary guardrails (F42)...\n");

try {
  const guardrailIssues = checkClientBoundaryGuardrails();
  if (guardrailIssues.length > 0) {
    hasIssues = true;
    guardrailIssues.forEach((issue) => console.log(`  ${issue}`));
    console.log();
    console.log(
      "  💡 Invalid compiler-owned client boundaries must fail before npm publish."
    );
  } else {
    console.log("  ✅ Invalid client boundaries fail with stable diagnostics");
  }
} catch (err) {
  hasIssues = true;
  console.error(
    "  ❌ client boundary guardrail check failed:",
    err instanceof Error ? err.message : String(err)
  );
}

console.log();

// 최종 결과
if (hasIssues) {
  console.error("❌ Pre-publish check FAILED!");
  console.error("\n💡 Fix:");
  console.error("   1. Run: bun install");
  console.error("   2. Commit updated bun.lock");
  console.error("   3. Re-run publish");
  process.exit(1);
} else {
  console.log("✅ Pre-publish check PASSED!");
  console.log("\n✨ Ready to publish!\n");
}
