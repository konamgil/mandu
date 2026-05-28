#!/usr/bin/env bun
/**
 * Check for drift between local publishable package metadata and npm.
 *
 * Version drift catches publish conflicts. Metadata drift catches the more
 * subtle case where the same version is already on npm but the local
 * package.json changed, so publish would skip and leave npm stale.
 */

import { $ } from "bun";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { PUBLISHABLE_PACKAGE_DIRS } from "./publish-order";

export const METADATA_FIELDS = [
  "name",
  "version",
  "description",
  "license",
  "type",
  "main",
  "module",
  "types",
  "bin",
  "exports",
  "files",
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "engines",
  "keywords",
] as const;

export const VOLATILE_NPM_METADATA_FIELDS = [
  "_id",
  "_nodeVersion",
  "_npmVersion",
  "dist",
  "maintainers",
  "time",
  "readme",
  "gitHead",
  "_integrity",
  "_resolved",
] as const;

const ROOT = join(import.meta.dir, "..");
const NPM_REGISTRY = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org/";

export type NpmDriftStatus =
  | "clean"
  | "ahead"
  | "reserved"
  | "behind"
  | "missing"
  | "metadata-drift";

export type PublishAction = "publish" | "skip" | "blocked";

export interface PackageJson {
  name: string;
  version: string;
  description?: string;
  license?: string;
  type?: string;
  main?: string;
  module?: string;
  types?: string;
  bin?: Record<string, string> | string;
  exports?: unknown;
  files?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  keywords?: string[];
}

export interface NpmRegistryInfo {
  latest: string | null;
  versions: string[];
  manifestForLocalVersion?: Record<string, unknown> | null;
}

export interface MetadataDiff {
  field: (typeof METADATA_FIELDS)[number];
  local: unknown;
  published: unknown;
}

export interface DriftReport {
  packageDir: string;
  name: string;
  local: string;
  npmLatest: string | null;
  status: NpmDriftStatus;
  publishAction: PublishAction;
  detail: string;
  metadataDiffs: MetadataDiff[];
}

export interface PublishPlanEntry {
  packageDir: string;
  name: string;
  version: string;
  npmLatest: string | null;
  action: PublishAction;
  reason: string;
}

export interface NpmDriftResult {
  reports: DriftReport[];
  blocking: number;
  publishPlan: PublishPlanEntry[];
}

function dependencyBlocks(pkg: PackageJson): Array<[keyof PackageJson, Record<string, string> | undefined]> {
  return [
    ["dependencies", pkg.dependencies],
    ["devDependencies", pkg.devDependencies],
    ["peerDependencies", pkg.peerDependencies],
    ["optionalDependencies", pkg.optionalDependencies],
  ];
}

function resolveDependencySpec(
  depName: string,
  spec: string,
  versionMap: Map<string, string>,
  catalog: Record<string, string>,
): string {
  if (spec.startsWith("workspace:")) {
    const version = versionMap.get(depName);
    return version ? `^${version}` : spec;
  }
  if (spec === "catalog:" || spec.startsWith("catalog:")) {
    const tag = spec === "catalog:" ? "" : spec.slice("catalog:".length);
    const lookup = tag ? `${depName}@${tag}` : depName;
    return catalog[lookup] ?? catalog[depName] ?? spec;
  }
  return spec;
}

function sortRecord(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortRecord);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortRecord((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function normalizeBin(value: PackageJson["bin"]): PackageJson["bin"] {
  const normalizePath = (path: string) => path.replace(/^\.\//, "");
  if (typeof value === "string") {
    return normalizePath(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const normalized: Record<string, string> = {};
  for (const [name, path] of Object.entries(value)) {
    normalized[name] = normalizePath(path);
  }
  return normalized;
}

export function normalizePackageMetadata(
  pkg: PackageJson | Record<string, unknown>,
  versionMap = new Map<string, string>(),
  catalog: Record<string, string> = {},
): Record<string, unknown> {
  const source = structuredClone(pkg) as PackageJson;
  if (Object.hasOwn(source, "bin")) {
    source.bin = normalizeBin(source.bin);
  }

  for (const [blockName, deps] of dependencyBlocks(source)) {
    if (!deps) continue;
    const resolved: Record<string, string> = {};
    for (const [depName, spec] of Object.entries(deps)) {
      resolved[depName] = resolveDependencySpec(depName, spec, versionMap, catalog);
    }
    (source as Record<string, unknown>)[blockName] = resolved;
  }

  const normalized: Record<string, unknown> = {};
  for (const field of METADATA_FIELDS) {
    if (!Object.hasOwn(source, field)) continue;
    normalized[field] = sortRecord((source as Record<string, unknown>)[field]);
  }
  return sortRecord(normalized) as Record<string, unknown>;
}

function metadataDiffs(
  localPkg: PackageJson,
  publishedManifest: Record<string, unknown> | null | undefined,
  versionMap: Map<string, string>,
  catalog: Record<string, string>,
): MetadataDiff[] {
  if (!publishedManifest) {
    return [];
  }

  const local = normalizePackageMetadata(localPkg, versionMap, catalog);
  const published = normalizePackageMetadata(publishedManifest, versionMap, catalog);
  const diffs: MetadataDiff[] = [];

  for (const field of METADATA_FIELDS) {
    const localValue = local[field];
    const publishedValue = published[field];
    if (JSON.stringify(localValue) === JSON.stringify(publishedValue)) continue;
    diffs.push({
      field,
      local: localValue === undefined ? null : localValue,
      published: publishedValue === undefined ? null : publishedValue,
    });
  }

  return diffs;
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.split("-")[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const aa = parse(a);
  const bb = parse(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const da = aa[i] ?? 0;
    const db = bb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function classifyPackageDrift(
  packageDir: string,
  localPkg: PackageJson,
  npm: NpmRegistryInfo,
  versionMap = new Map<string, string>(),
  catalog: Record<string, string> = {},
): DriftReport {
  const local = localPkg.version;
  const name = localPkg.name;

  if (npm.latest === null) {
    return {
      packageDir,
      name,
      local,
      npmLatest: null,
      status: "missing",
      publishAction: "blocked",
      detail: `package not found on npm registry (${NPM_REGISTRY})`,
      metadataDiffs: [],
    };
  }

  if (local === npm.latest) {
    const diffs = metadataDiffs(localPkg, npm.manifestForLocalVersion, versionMap, catalog);
    if (diffs.length > 0) {
      const fields = diffs.map((diff) => diff.field).join(", ");
      return {
        packageDir,
        name,
        local,
        npmLatest: npm.latest,
        status: "metadata-drift",
        publishAction: "blocked",
        detail: `same version exists on npm but local metadata differs: ${fields}`,
        metadataDiffs: diffs,
      };
    }
    return {
      packageDir,
      name,
      local,
      npmLatest: npm.latest,
      status: "clean",
      publishAction: "skip",
      detail: "in sync with npm latest",
      metadataDiffs: [],
    };
  }

  if (npm.versions.includes(local)) {
    return {
      packageDir,
      name,
      local,
      npmLatest: npm.latest,
      status: "reserved",
      publishAction: "blocked",
      detail: `local version ${local} already exists on npm under a non-latest tag (or was unpublished; slot reserved)`,
      metadataDiffs: [],
    };
  }

  const cmp = compareSemver(local, npm.latest);
  if (cmp < 0) {
    return {
      packageDir,
      name,
      local,
      npmLatest: npm.latest,
      status: "behind",
      publishAction: "blocked",
      detail: `local ${local} < npm latest ${npm.latest}; investigate before publish`,
      metadataDiffs: [],
    };
  }

  return {
    packageDir,
    name,
    local,
    npmLatest: npm.latest,
    status: "ahead",
    publishAction: "publish",
    detail: `local ${local} > npm latest ${npm.latest}; ready to publish`,
    metadataDiffs: [],
  };
}

async function fetchNpm(name: string, localVersion: string): Promise<NpmRegistryInfo> {
  try {
    const text = await $`npm view ${name} --json --registry=${NPM_REGISTRY}`.text();
    const parsed = JSON.parse(text);
    const latest = typeof parsed.version === "string" ? parsed.version : null;
    const versions = Array.isArray(parsed.versions) ? parsed.versions : [];
    let manifestForLocalVersion: Record<string, unknown> | null = null;

    if (versions.includes(localVersion)) {
      manifestForLocalVersion = await fetchPublishedPackageJson(name, localVersion);
      if (!manifestForLocalVersion) {
        const manifestText = await $`npm view ${name}@${localVersion} --json --registry=${NPM_REGISTRY}`.text();
        manifestForLocalVersion = JSON.parse(manifestText);
      }
    }

    return { latest, versions, manifestForLocalVersion };
  } catch {
    return { latest: null, versions: [], manifestForLocalVersion: null };
  }
}

async function fetchPublishedPackageJson(name: string, version: string): Promise<Record<string, unknown> | null> {
  const tmp = await mkdtemp(join(tmpdir(), "mandu-npm-drift-"));
  try {
    await $`npm pack ${`${name}@${version}`} --pack-destination ${tmp} --json --registry=${NPM_REGISTRY}`.quiet();
    const entries = await readdir(tmp);
    const tarball = entries.find((entry) => entry.endsWith(".tgz"));
    if (!tarball) return null;

    const tarCommand = process.platform === "win32"
      ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
    await $`${tarCommand} -xzf ${join(tmp, tarball)} -C ${tmp}`.quiet();

    return JSON.parse(await readFile(join(tmp, "package", "package.json"), "utf-8"));
  } catch {
    return null;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function readPackageJson(pkgDir: string): Promise<PackageJson> {
  return JSON.parse(await readFile(join(ROOT, pkgDir, "package.json"), "utf-8"));
}

async function loadRootCatalog(): Promise<Record<string, string>> {
  const rootPkg: Record<string, unknown> = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8"));
  const workspaces = rootPkg.workspaces;
  if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces)) {
    const catalog = (workspaces as Record<string, unknown>).catalog;
    if (catalog && typeof catalog === "object" && !Array.isArray(catalog)) {
      return catalog as Record<string, string>;
    }
  }
  return {};
}

async function buildVersionMap(packageDirs: string[]): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  for (const pkgDir of packageDirs) {
    const pkg = await readPackageJson(pkgDir);
    versions.set(pkg.name, pkg.version);
  }
  return versions;
}

async function reportPackage(
  pkgDir: string,
  versionMap: Map<string, string>,
  catalog: Record<string, string>,
): Promise<DriftReport> {
  const pkg = await readPackageJson(pkgDir);
  const npm = await fetchNpm(pkg.name, pkg.version);
  return classifyPackageDrift(pkgDir, pkg, npm, versionMap, catalog);
}

export function createPublishPlan(reports: DriftReport[]): PublishPlanEntry[] {
  return reports.map((report) => ({
    packageDir: report.packageDir,
    name: report.name,
    version: report.local,
    npmLatest: report.npmLatest,
    action: report.publishAction,
    reason: report.detail,
  }));
}

export async function checkNpmDrift(packageDirs = PUBLISHABLE_PACKAGE_DIRS): Promise<NpmDriftResult> {
  const versionMap = await buildVersionMap(packageDirs);
  const catalog = await loadRootCatalog();
  const reports = await Promise.all(packageDirs.map((pkgDir) => reportPackage(pkgDir, versionMap, catalog)));
  const blockingReports = reports.filter((report) => report.publishAction === "blocked");
  return {
    reports,
    blocking: blockingReports.length,
    publishPlan: createPublishPlan(reports),
  };
}

function formatValue(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) return "<missing>";
  if (json.length <= 180) return json;
  return `${json.slice(0, 177)}...`;
}

function printHumanReport(result: NpmDriftResult): void {
  console.log("🔍 npm drift check\n");
  for (const report of result.reports) {
    const icon: Record<NpmDriftStatus, string> = {
      clean: "✅",
      ahead: "📈",
      reserved: "🚫",
      behind: "⬇️",
      missing: "❓",
      "metadata-drift": "🧨",
    };
    const npm = report.npmLatest ?? "<missing>";
    console.log(
      `  ${icon[report.status]} ${report.name.padEnd(20)} local=${report.local.padEnd(8)} npm=${npm.padEnd(8)} — ${report.detail}`,
    );
    for (const diff of report.metadataDiffs) {
      console.log(`     - ${diff.field}: local=${formatValue(diff.local)} npm=${formatValue(diff.published)}`);
    }
  }
  console.log();

  if (result.blocking > 0) {
    console.error(`❌ ${result.blocking} blocking issue(s) — fix before \`bun run release\`.`);
  } else {
    console.log("✨ No drift. Safe to publish.");
  }
}

async function main(): Promise<void> {
  const isJsonMode = process.argv.includes("--json");
  const result = await checkNpmDrift();

  if (isJsonMode) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printHumanReport(result);
  }

  process.exit(result.blocking > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
