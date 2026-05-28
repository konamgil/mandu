import { readFile } from "fs/promises";
import path from "path";
import type { RouteSpec } from "../spec/schema";
import {
  formatClientBoundaryDiagnostics,
  validateClientBoundaryServerOnlyImports,
} from "../bundler/client-boundary-transform";
import { analyzeRouteSource, type RouteSourceImportRecord } from "./route-source-analyzer";

export interface ClientComponentImport {
  module: string;
  kind: "default" | "named" | "namespace" | "side-effect" | "mixed";
  names: string[];
}

export interface RouteLevelClientComponentImport {
  module: string;
  localName: string;
  exportName: string;
}

const CLIENT_ENTRY_SPECIFIER_PATTERN = /\.(?:client|island)(?:\.[tj]sx?)?$/;
const DEFAULT_EXPORT_NAME = "default";

interface ComponentImportSpecifier {
  importedName: string;
  localName: string;
}

interface ComponentImportRecord extends ClientComponentImport {
  specifiers: ComponentImportSpecifier[];
}

export function normalizeRouteModulePath(value: string | undefined): string {
  return (value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

export function hasUseClientDirective(source: string): boolean {
  return analyzeRouteSource(source).directives.useClient;
}

export function hasUseServerDirective(source: string): boolean {
  return analyzeRouteSource(source).directives.useServer;
}

export function clientModuleIsRouteComponent(route: RouteSpec, clientModule = route.clientModule): boolean {
  if (route.kind !== "page" || !clientModule) return false;

  const client = normalizeRouteModulePath(clientModule);
  return (
    client === normalizeRouteModulePath(route.componentModule) ||
    client === normalizeRouteModulePath(route.module)
  );
}

async function readRouteModule(rootDir: string, modulePath: string): Promise<string | null> {
  try {
    return await readFile(path.resolve(rootDir, modulePath), "utf-8");
  } catch {
    return null;
  }
}

export function findClientComponentImports(source: string): ClientComponentImport[] {
  return findComponentImportRecords(source)
    .filter((entry) => clientSpecifierLooksBrowserOnly(entry.module))
    .map(toPublicClientComponentImport);
}

function toPublicClientComponentImport(entry: ComponentImportRecord): ClientComponentImport {
  return {
    module: entry.module,
    kind: entry.kind,
    names: entry.names,
  };
}

function findComponentImportRecords(source: string): ComponentImportRecord[] {
  return findComponentImportRecordsFromAnalysis(analyzeRouteSource(source).imports);
}

function findComponentImportRecordsFromAnalysis(imports: RouteSourceImportRecord[]): ComponentImportRecord[] {
  return imports.flatMap(toComponentImportRecord);
}

function toComponentImportRecord(entry: RouteSourceImportRecord): ComponentImportRecord[] {
  if (entry.isSideEffectOnly) {
    return [{ module: entry.source, kind: "side-effect", names: [], specifiers: [] }];
  }
  if (entry.isTypeOnly) return [];

  const names: string[] = [];
  const specifiers: ComponentImportSpecifier[] = [];
  let hasDefault = false;
  let hasNamed = false;
  let hasNamespace = false;

  if (entry.defaultName) {
    hasDefault = true;
    names.push(entry.defaultName);
    specifiers.push({ importedName: DEFAULT_EXPORT_NAME, localName: entry.defaultName });
  }

  if (entry.namespaceName) {
    hasNamespace = true;
    names.push(entry.namespaceName);
    specifiers.push({ importedName: "*", localName: entry.namespaceName });
  }

  for (const named of entry.named) {
    if (named.isTypeOnly) continue;
    hasNamed = true;
    names.push(named.local);
    specifiers.push({ importedName: named.imported, localName: named.local });
  }

  if (names.length === 0) return [];

  const kind =
    (hasDefault && (hasNamed || hasNamespace))
      ? "mixed"
      : hasNamed
        ? "named"
        : hasNamespace
          ? "namespace"
          : "default";

  return [{ module: entry.source, kind, names, specifiers }];
}

export function findRouteLevelClientComponentImport(source: string): RouteLevelClientComponentImport | null {
  return findRouteLevelClientComponentImports(source)[0] ?? null;
}

export function findRouteLevelClientComponentImports(source: string): RouteLevelClientComponentImport[] {
  const analysis = analyzeRouteSource(source);
  const candidates = findComponentImportRecordsFromAnalysis(analysis.imports).flatMap((entry) =>
    isRouteLevelClientEntrySpecifier(entry.module)
      ? entry.specifiers
          .filter((specifier) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(specifier.localName))
          .map((specifier) => ({
            module: entry.module,
            localName: specifier.localName,
            exportName: specifier.importedName,
          }))
      : []
  );

  if (candidates.length === 0) return [];
  return defaultExportRendersClientComponents(analysis.defaultExport.renderedJsxNames, candidates);
}

function isRouteLevelClientEntrySpecifier(specifier: string): boolean {
  const normalized = specifier.replace(/\\/g, "/");
  if (
    normalized.includes("/client/shared/") ||
    normalized.startsWith("@/client/shared/") ||
    normalized.startsWith("src/client/shared/")
  ) {
    return false;
  }
  return true;
}

export async function resolveClientImportModulePath(
  rootDir: string,
  importerModule: string,
  specifier: string,
): Promise<string | null> {
  const base = resolveImportBasePath(rootDir, importerModule, specifier);
  if (!base) return null;

  for (const candidate of expandClientModuleCandidates(base)) {
    if (await Bun.file(candidate).exists()) {
      return path.relative(rootDir, candidate).replace(/\\/g, "/");
    }
  }

  return null;
}

export async function resolveRouteLevelClientEntryPath(
  rootDir: string,
  routeModule: string,
  source: string,
): Promise<string | null> {
  return (await resolveRouteLevelClientEntry(rootDir, routeModule, source))?.modulePath ?? null;
}

export async function resolveRouteLevelClientEntry(
  rootDir: string,
  routeModule: string,
  source: string,
): Promise<{ modulePath: string; exportName: string } | null> {
  const routeLevelClientImports = findRouteLevelClientComponentImports(source);
  for (const routeLevelClientImport of routeLevelClientImports) {
    const resolved = await resolveClientImportModulePath(rootDir, routeModule, routeLevelClientImport.module);
    if (!resolved) continue;
    if (clientSpecifierLooksBrowserOnly(routeLevelClientImport.module)) {
      return { modulePath: resolved, exportName: routeLevelClientImport.exportName };
    }

    const importedSource = await readRouteModule(rootDir, resolved);
    if (importedSource !== null && hasUseClientDirective(importedSource)) {
      return { modulePath: resolved, exportName: routeLevelClientImport.exportName };
    }
  }

  return null;
}

export async function shouldPreserveExistingClientModule(
  route: RouteSpec,
  clientModule: string,
  rootDir: string,
): Promise<boolean> {
  if (!isRouteLevelClientEntrySpecifier(clientModule)) return false;
  const source = await readRouteModule(rootDir, clientModule);
  if (source === null) return false;
  if (hasUseServerDirective(source)) return false;
  if (clientModuleIsRouteComponent(route, clientModule)) {
    if (hasUseClientDirective(source)) return true;
    return await routeComponentHasResolvableClientEntry(rootDir, clientModule, source);
  }

  if (route.kind !== "page" || !route.componentModule) return false;

  const routeSource = await readRouteModule(rootDir, route.componentModule);
  if (routeSource === null) return false;

  const currentEntry = await resolveRouteLevelClientEntry(rootDir, route.componentModule, routeSource);
  return normalizeRouteModulePath(currentEntry?.modulePath) === normalizeRouteModulePath(clientModule);
}

function resolveImportBasePath(rootDir: string, importerModule: string, specifier: string): string | null {
  const normalized = specifier.replace(/\\/g, "/");
  if (normalized.startsWith("@/") || normalized.startsWith("~/")) {
    return path.resolve(rootDir, "src", normalized.slice(2));
  }
  if (normalized.startsWith("./") || normalized.startsWith("../")) {
    return path.resolve(rootDir, path.dirname(importerModule), normalized);
  }
  return null;
}

function expandClientModuleCandidates(basePath: string): string[] {
  if (/\.[cm]?[jt]sx?$/.test(basePath)) return [basePath];
  return [
    `${basePath}.tsx`,
    `${basePath}.ts`,
    `${basePath}.jsx`,
    `${basePath}.js`,
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.jsx"),
    path.join(basePath, "index.js"),
  ];
}

function clientSpecifierLooksBrowserOnly(specifier: string): boolean {
  return CLIENT_ENTRY_SPECIFIER_PATTERN.test(specifier.replace(/\\/g, "/"));
}

function defaultExportRendersClientComponents(
  renderedJsxNames: string[],
  candidates: RouteLevelClientComponentImport[],
): RouteLevelClientComponentImport[] {
  const renderedNames = new Set(renderedJsxNames);
  const seen = new Set<string>();
  const rendered: RouteLevelClientComponentImport[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.module}\0${candidate.localName}`;
    if (seen.has(key)) continue;
    if (!renderedNames.has(candidate.localName)) continue;
    seen.add(key);
    rendered.push(candidate);
  }

  return rendered;
}

export async function validateClientModuleForBrowserBundle(
  route: RouteSpec,
  rootDir: string,
): Promise<string | null> {
  if (!route.clientModule) return null;

  const source = await readRouteModule(rootDir, route.clientModule);
  if (source === null) return null;

  if (hasUseServerDirective(source)) {
    return `[${route.id}] Client module "${route.clientModule}" has a "use server" directive and cannot be bundled for the browser.`;
  }

  if (clientModuleIsRouteComponent(route) && !hasUseClientDirective(source)) {
    const realClientEntry = await resolveRouteLevelClientEntry(rootDir, route.clientModule, source);
    if (realClientEntry) {
      route.clientModule = realClientEntry.modulePath;
      route.clientExportName = realClientEntry.exportName;
      const realSource = await readRouteModule(rootDir, route.clientModule);
      return realSource === null ? null : formatClientModuleBrowserDiagnostics(route, realSource);
    }
    return (
      `[${route.id}] Route component "${route.clientModule}" is configured as clientModule, ` +
      `but it is a server page (missing "use client"). Mandu will not bundle server pages into client islands. ` +
      `Remove the stale clientModule from .mandu/routes.manifest.json or use a *.partial.tsx / spec/slots/${route.id}.client.tsx client entry.`
    );
  }

  return formatClientModuleBrowserDiagnostics(route, source);
}

function formatClientModuleBrowserDiagnostics(route: RouteSpec, source: string): string | null {
  if (!route.clientModule) return null;
  const diagnostics = validateClientBoundaryServerOnlyImports(
    source,
    {
      id: `${route.id}--client-module`,
      routeId: route.id,
      module: route.clientModule,
      exportName: route.clientExportName ?? "default",
    },
    route.clientModule,
  );
  if (diagnostics.length === 0) return null;
  return formatClientBoundaryDiagnostics(diagnostics);
}

async function routeComponentHasResolvableClientEntry(
  rootDir: string,
  routeModule: string,
  source: string,
): Promise<boolean> {
  return (await resolveRouteLevelClientEntryPath(rootDir, routeModule, source)) !== null;
}

export async function describeMissingHydrationClientModule(
  route: RouteSpec,
  rootDir: string,
  options: { allowPartialOnly?: boolean } = {},
): Promise<string | null> {
  const hydration = route.hydration?.strategy ?? "island";
  const base =
    `[${route.id}] Route has hydration strategy "${hydration}" but no clientModule could be resolved. ` +
    `Mandu cannot emit a working data-mandu-src for this route.`;

  const componentModule = route.kind === "page" ? route.componentModule : undefined;
  if (!componentModule) {
    return options.allowPartialOnly && hydration === "island" ? null : base;
  }

  const source = await readRouteModule(rootDir, componentModule);
  if (source === null) {
    return options.allowPartialOnly && hydration === "island" ? null : base;
  }

  const clientImports = findClientComponentImports(source);
  if (clientImports.length === 0) {
    if (options.allowPartialOnly && hydration === "island") return null;
    return (
      `${base}\n` +
      `  Fix: add a route-level client module (for example app/*.island.tsx or spec/slots/${route.id}.client.tsx) ` +
      `or set hydration.strategy to "none".`
    );
  }

  const importList = clientImports
    .map((entry) => {
      const suffix = entry.names.length > 0 ? ` (${entry.kind}: ${entry.names.join(", ")})` : ` (${entry.kind})`;
      return `    - ${entry.module}${suffix}`;
    })
    .join("\n");

  return (
    `${base}\n` +
    `  The page imports client-looking modules, but none was linked into the route manifest:\n` +
    `${importList}\n` +
    `  Fix: run mandu generate with the current source, or set an explicit route-level clientModule.`
  );
}
