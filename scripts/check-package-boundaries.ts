#!/usr/bin/env bun

import { Glob } from "bun";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { scanImportReferences, type ImportReference } from "./check-target-boundaries";

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface ProductPackagePolicy {
  name: string;
  packageDir: string;
  entrypoints: string[];
  allowedWorkspacePackages: string[];
}

export interface PackageBoundaryIssue {
  policy: string;
  file: string;
  specifier: string;
  kind: ImportReference["kind"] | "manifest";
  reason: string;
}

export type CoreOwner = "runtime" | "safety" | "actions";

export interface CoreOwnerPolicy {
  owner: CoreOwner;
  roots: string[];
  allowedOwners: CoreOwner[];
}

export const PRODUCT_PACKAGE_POLICIES: readonly ProductPackagePolicy[] = [
  {
    name: "core is the product kernel",
    packageDir: "packages/core",
    entrypoints: ["src/index.ts"],
    allowedWorkspacePackages: [],
  },
  {
    name: "cli depends only on core",
    packageDir: "packages/cli",
    entrypoints: ["src/main.ts"],
    allowedWorkspacePackages: ["@mandujs/core"],
  },
  {
    name: "mcp depends only on core",
    packageDir: "packages/mcp",
    entrypoints: ["src/index.ts"],
    allowedWorkspacePackages: ["@mandujs/core"],
  },
] as const;

/**
 * Logical Core ownership used during the refoundation. Compatibility modules
 * keep their existing paths, while these rules make the intended dependency
 * direction executable: runtime and safety never depend on orchestration.
 */
export const CORE_OWNER_POLICIES: readonly CoreOwnerPolicy[] = [
  {
    owner: "runtime",
    roots: ["src/runtime", "src/router", "src/routes", "src/bundler", "src/client", "src/island"],
    allowedOwners: ["runtime", "safety"],
  },
  {
    owner: "safety",
    roots: ["src/guard", "src/contract", "src/change", "src/lockfile"],
    allowedOwners: ["runtime", "safety"],
  },
  {
    owner: "actions",
    roots: ["src/agent"],
    allowedOwners: ["runtime", "safety", "actions"],
  },
] as const;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;

function workspacePackageName(specifier: string): string | null {
  if (!specifier.startsWith("@mandujs/")) return null;
  const [scope, name] = specifier.split("/");
  return scope && name ? `${scope}/${name}` : null;
}

function resolveSourceImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(importer), specifier);
  const sourceBase = /\.(?:mjs|cjs|js|jsx)$/.test(base)
    ? base.replace(/\.(?:mjs|cjs|js|jsx)$/, "")
    : base;
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${sourceBase}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => resolve(sourceBase, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function packageDependencyNames(pkg: PackageJson): string[] {
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ];
}

async function collectReachableImports(entrypoints: string[]): Promise<ImportReference[]> {
  const refs: ImportReference[] = [];
  const pending = [...entrypoints];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const source = await Bun.file(file).text();
    const fileRefs = scanImportReferences(source, file);
    refs.push(...fileRefs);

    for (const ref of fileRefs) {
      const resolved = resolveSourceImport(file, ref.specifier);
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    }
  }

  return refs;
}

function ownerForFile(coreRoot: string, file: string, policies: readonly CoreOwnerPolicy[]): CoreOwner | null {
  const rel = relative(coreRoot, file).replace(/\\/g, "/");
  for (const policy of policies) {
    if (policy.roots.some((root) => rel === root || rel.startsWith(`${root}/`))) return policy.owner;
  }
  return null;
}

function ownerForCoreSpecifier(specifier: string): CoreOwner | null {
  const subpath = specifier.replace(/^@mandujs\/core\/?/, "src/");
  if (subpath.startsWith("src/agent") || subpath.startsWith("src/actions")) return "actions";
  if (/^src\/(?:guard|contract|change|lockfile)(?:\/|$)/.test(subpath)) return "safety";
  if (/^src\/(?:runtime|router|routes|bundler|client|island)(?:\/|$)/.test(subpath)) return "runtime";
  return null;
}

export async function checkCoreOwnerBoundaries(
  repoRoot = process.cwd(),
  policies: readonly CoreOwnerPolicy[] = CORE_OWNER_POLICIES,
): Promise<PackageBoundaryIssue[]> {
  const coreRoot = resolve(repoRoot, "packages/core");
  const issues: PackageBoundaryIssue[] = [];

  for (const policy of policies) {
    const allowed = new Set(policy.allowedOwners);
    for (const sourceRoot of policy.roots) {
      const absoluteRoot = resolve(coreRoot, sourceRoot);
      if (!existsSync(absoluteRoot)) continue;
      const glob = new Glob("**/*.{ts,tsx,js,jsx,mjs,cjs}");
      for await (const relFile of glob.scan({ cwd: absoluteRoot, onlyFiles: true })) {
        const file = resolve(absoluteRoot, relFile);
        const refs = scanImportReferences(await Bun.file(file).text(), file);
        for (const ref of refs) {
          const resolvedImport = resolveSourceImport(file, ref.specifier);
          const targetOwner = resolvedImport
            ? ownerForFile(coreRoot, resolvedImport, policies)
            : ref.specifier.startsWith("@mandujs/core")
              ? ownerForCoreSpecifier(ref.specifier)
              : null;
          if (!targetOwner || allowed.has(targetOwner)) continue;
          issues.push({
            policy: `core ${policy.owner} owner direction`,
            file: relative(repoRoot, file),
            specifier: ref.specifier,
            kind: ref.kind,
            reason: `${policy.owner} may depend on ${policy.allowedOwners.join(", ")}, not ${targetOwner}`,
          });
        }
      }
    }
  }

  return issues;
}

export async function checkPackageBoundaries(
  repoRoot = process.cwd(),
  policies: readonly ProductPackagePolicy[] = PRODUCT_PACKAGE_POLICIES,
): Promise<PackageBoundaryIssue[]> {
  const issues: PackageBoundaryIssue[] = [];

  for (const policy of policies) {
    const packageRoot = resolve(repoRoot, policy.packageDir);
    const packagePath = resolve(packageRoot, "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson;
    const allowed = new Set([pkg.name, ...policy.allowedWorkspacePackages]);

    for (const dependency of packageDependencyNames(pkg)) {
      const workspaceName = workspacePackageName(dependency);
      if (!workspaceName || allowed.has(workspaceName)) continue;
      issues.push({
        policy: policy.name,
        file: relative(repoRoot, packagePath),
        specifier: dependency,
        kind: "manifest",
        reason: `${pkg.name} may only depend on ${policy.allowedWorkspacePackages.join(", ") || "no other workspace package"}`,
      });
    }

    const entrypoints = policy.entrypoints.map((entrypoint) => resolve(packageRoot, entrypoint));
    const refs = await collectReachableImports(entrypoints);
    for (const ref of refs) {
      const workspaceName = workspacePackageName(ref.specifier);
      if (!workspaceName || allowed.has(workspaceName)) continue;
      issues.push({
        policy: policy.name,
        file: relative(repoRoot, ref.file),
        specifier: ref.specifier,
        kind: ref.kind,
        reason: `reachable product code may only import ${policy.allowedWorkspacePackages.join(", ") || "its own package internals"}`,
      });
    }
  }

  issues.push(...await checkCoreOwnerBoundaries(repoRoot));

  return issues.sort((left, right) =>
    `${left.policy}:${left.file}:${left.specifier}`.localeCompare(
      `${right.policy}:${right.file}:${right.specifier}`,
    ),
  );
}

if (import.meta.main) {
  const issues = await checkPackageBoundaries();
  if (issues.length > 0) {
    console.error("Package boundary check failed:");
    for (const issue of issues) {
      console.error(
        `  - ${issue.file}: ${issue.kind} dependency on ${issue.specifier} violates "${issue.policy}" (${issue.reason})`,
      );
    }
    process.exit(1);
  }

  console.log("Package boundary check passed: core(runtime/safety/actions) <- cli/mcp, Labs excluded from product entrypoints.");
}
