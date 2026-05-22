import { readFile } from "fs/promises";
import path from "path";
import type { RouteSpec } from "../spec/schema";
import {
  formatClientBoundaryDiagnostics,
  validateClientBoundaryServerOnlyImports,
} from "../bundler/client-boundary-transform";

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
  return /^(?:\uFEFF)?\s*(?:(?:\/\/[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/\s*))*["']use client["']\s*;?/.test(source);
}

export function hasUseServerDirective(source: string): boolean {
  return /^(?:\uFEFF)?\s*(?:(?:\/\/[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/\s*))*["']use server["']\s*;?/.test(source);
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
  const imports: ComponentImportRecord[] = [];
  const importFromPattern = /import\s+(?!type\b)([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  const sideEffectPattern = /import\s+["']([^"']+)["']/g;

  for (const match of source.matchAll(importFromPattern)) {
    const clause = (match[1] ?? "").trim();
    const module = match[2] ?? "";
    const names: string[] = [];
    const specifiers: ComponentImportSpecifier[] = [];
    let hasDefault = false;
    let hasNamed = false;
    let hasNamespace = false;

    const namedMatch = clause.match(/\{([^}]*)\}/);
    if (namedMatch) {
      hasNamed = true;
      for (const rawName of namedMatch[1].split(",")) {
        const name = rawName.trim();
        if (!name) continue;
        const parts = name.split(/\s+as\s+/i).map((part) => part.trim()).filter(Boolean);
        const importedName = parts[0] ?? "";
        const localName = parts[1] ?? importedName;
        names.push(localName);
        specifiers.push({ importedName, localName });
      }
    }

    if (/\*\s+as\s+/.test(clause)) {
      hasNamespace = true;
      const namespaceMatch = clause.match(/\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (namespaceMatch?.[1]) {
        names.push(namespaceMatch[1]);
        specifiers.push({ importedName: "*", localName: namespaceMatch[1] });
      }
    }

    const beforeNamed = clause.split("{")[0]?.replace(/,\s*$/, "").trim() ?? "";
    if (beforeNamed && !beforeNamed.startsWith("*")) {
      hasDefault = true;
      const localName = beforeNamed.split(",")[0].trim();
      names.push(localName);
      specifiers.push({ importedName: DEFAULT_EXPORT_NAME, localName });
    }

    const kind =
      (hasDefault && (hasNamed || hasNamespace))
        ? "mixed"
        : hasNamed
          ? "named"
          : hasNamespace
            ? "namespace"
            : "default";

    imports.push({ module, kind, names, specifiers });
  }

  for (const match of source.matchAll(sideEffectPattern)) {
    const module = match[1] ?? "";
    if (imports.some((entry) => entry.module === module)) continue;
    imports.push({ module, kind: "side-effect", names: [], specifiers: [] });
  }

  return imports;
}

export function findRouteLevelClientComponentImport(source: string): RouteLevelClientComponentImport | null {
  return findRouteLevelClientComponentImports(source)[0] ?? null;
}

export function findRouteLevelClientComponentImports(source: string): RouteLevelClientComponentImport[] {
  const candidates = findComponentImportRecords(source).flatMap((entry) =>
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
  return defaultExportRendersClientComponents(source, candidates);
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
  source: string,
  candidates: RouteLevelClientComponentImport[],
): RouteLevelClientComponentImport[] {
  const functionBody = extractDefaultExportFunctionBody(source);
  if (functionBody !== null) {
    const returned = extractTopLevelReturnExpression(functionBody);
    return returned !== null ? jsxExpressionRendersClientComponents(returned, candidates) : [];
  }

  const arrowExpression = extractDefaultExportArrowExpression(source);
  if (arrowExpression !== null) {
    return jsxExpressionRendersClientComponents(arrowExpression, candidates);
  }

  const arrowBody = extractDefaultExportArrowFunctionBody(source);
  if (arrowBody !== null) {
    const returned = extractTopLevelReturnExpression(arrowBody);
    return returned !== null ? jsxExpressionRendersClientComponents(returned, candidates) : [];
  }

  return [];
}

function extractDefaultExportFunctionBody(source: string): string | null {
  const match = /export\s+default\s+(?:async\s+)?function(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{/m.exec(source);
  if (!match) return null;

  const openBrace = match.index + match[0].lastIndexOf("{");
  const closeBrace = findMatchingBrace(source, openBrace);
  if (closeBrace === -1) return null;
  return source.slice(openBrace + 1, closeBrace);
}

function extractDefaultExportArrowExpression(source: string): string | null {
  const match = /export\s+default\s+(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>\s*/m.exec(source);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = source.slice(start).trim();
  if (rest.startsWith("{")) return null;

  const semicolon = rest.indexOf(";");
  return semicolon === -1 ? rest : rest.slice(0, semicolon);
}

function extractDefaultExportArrowFunctionBody(source: string): string | null {
  const match = /export\s+default\s+(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>\s*\{/m.exec(source);
  if (!match) return null;

  const openBrace = match.index + match[0].lastIndexOf("{");
  const closeBrace = findMatchingBrace(source, openBrace);
  if (closeBrace === -1) return null;
  return source.slice(openBrace + 1, closeBrace);
}

function extractTopLevelReturnExpression(body: string): string | null {
  let quote: '"' | "'" | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    const next = body[i + 1];
    const prev = body[i - 1];

    if (lineComment) {
      if (char === "\n" || char === "\r") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (char === quote && prev !== "\\") quote = null;
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (braceDepth === 0 && parenDepth === 0 && bracketDepth === 0 && body.startsWith("return", i)) {
      const before = body[i - 1] ?? "";
      const after = body[i + "return".length] ?? "";
      if (!isIdentifierChar(before) && !isIdentifierChar(after)) {
        const expr = body.slice(i + "return".length).trim();
        return trimTrailingSemicolon(expr);
      }
    }

    if (char === "{") braceDepth++;
    if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (char === "(") parenDepth++;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (char === "[") bracketDepth++;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
  }

  return null;
}

function trimTrailingSemicolon(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith(";") ? trimmed.slice(0, -1).trim() : trimmed;
}

function jsxExpressionRendersClientComponents(
  expression: string,
  candidates: RouteLevelClientComponentImport[],
): RouteLevelClientComponentImport[] {
  const expr = stripWrappingParentheses(expression.trim());
  const seen = new Set<string>();
  const rendered: RouteLevelClientComponentImport[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.module}\0${candidate.localName}`;
    if (seen.has(key)) continue;
    if (!jsxExpressionContainsClientElement(expr, candidate.localName)) continue;
    seen.add(key);
    rendered.push(candidate);
  }

  return rendered;
}

function jsxExpressionContainsClientElement(expression: string, localName: string): boolean {
  const escaped = escapeRegExp(localName);
  return new RegExp(`<${escaped}(?:\\s|/|>)`).test(expression);
}

function stripWrappingParentheses(value: string): string {
  let current = value.trim();
  while (current.startsWith("(") && current.endsWith(")")) {
    const close = findMatchingParen(current, 0);
    if (close !== current.length - 1) break;
    current = current.slice(1, -1).trim();
  }
  return current;
}

function findMatchingBrace(source: string, openIndex: number): number {
  return findMatchingDelimiter(source, openIndex, "{", "}");
}

function findMatchingParen(source: string, openIndex: number): number {
  return findMatchingDelimiter(source, openIndex, "(", ")");
}

function findMatchingDelimiter(source: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    const prev = source[i - 1];

    if (lineComment) {
      if (char === "\n" || char === "\r") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (char === quote && prev !== "\\") quote = null;
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === open) depth++;
    if (char === close) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isIdentifierChar(value: string): boolean {
  return /[A-Za-z0-9_$]/.test(value);
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
