import { readFile } from "fs/promises";
import path from "path";
import type { RouteSpec } from "../spec/schema";

export interface ClientComponentImport {
  module: string;
  kind: "default" | "named" | "namespace" | "side-effect" | "mixed";
  names: string[];
}

export interface RouteLevelClientComponentImport {
  module: string;
  localName: string;
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
  const imports: ClientComponentImport[] = [];
  const importFromPattern = /import\s+([\s\S]*?)\s+from\s+["']([^"']*\.client(?:\.[tj]sx?)?)["']/g;
  const sideEffectPattern = /import\s+["']([^"']*\.client(?:\.[tj]sx?)?)["']/g;

  for (const match of source.matchAll(importFromPattern)) {
    const clause = (match[1] ?? "").trim();
    const module = match[2] ?? "";
    const names: string[] = [];
    let hasDefault = false;
    let hasNamed = false;
    let hasNamespace = false;

    const namedMatch = clause.match(/\{([^}]*)\}/);
    if (namedMatch) {
      hasNamed = true;
      for (const rawName of namedMatch[1].split(",")) {
        const name = rawName.trim();
        if (!name) continue;
        names.push(name.split(/\s+as\s+/i)[0].trim());
      }
    }

    if (/\*\s+as\s+/.test(clause)) {
      hasNamespace = true;
      const namespaceMatch = clause.match(/\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (namespaceMatch?.[1]) names.push(namespaceMatch[1]);
    }

    const beforeNamed = clause.split("{")[0]?.replace(/,\s*$/, "").trim() ?? "";
    if (beforeNamed && !beforeNamed.startsWith("*")) {
      hasDefault = true;
      names.push(beforeNamed.split(",")[0].trim());
    }

    const kind =
      (hasDefault && (hasNamed || hasNamespace))
        ? "mixed"
        : hasNamed
          ? "named"
          : hasNamespace
            ? "namespace"
            : "default";

    imports.push({ module, kind, names });
  }

  for (const match of source.matchAll(sideEffectPattern)) {
    const module = match[1] ?? "";
    if (imports.some((entry) => entry.module === module)) continue;
    imports.push({ module, kind: "side-effect", names: [] });
  }

  return imports;
}

export function findRouteLevelClientComponentImport(source: string): RouteLevelClientComponentImport | null {
  const defaultImports = findClientComponentImports(source).filter((entry) => {
    const localName = entry.names[0] ?? "";
    return entry.kind === "default" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(localName);
  });

  if (defaultImports.length !== 1) return null;

  const entry = defaultImports[0];
  const localName = entry.names[0];
  if (!entry.module || !localName) return null;
  if (!defaultExportReturnsOnlyClientComponent(source, localName)) return null;

  return { module: entry.module, localName };
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

export async function shouldPreserveExistingClientModule(
  route: RouteSpec,
  clientModule: string,
  rootDir: string,
): Promise<boolean> {
  const source = await readRouteModule(rootDir, clientModule);
  if (source === null) return false;
  if (hasUseServerDirective(source)) return false;
  if (clientModuleIsRouteComponent(route, clientModule)) {
    return hasUseClientDirective(source);
  }
  return true;
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
  ];
}

function defaultExportReturnsOnlyClientComponent(source: string, localName: string): boolean {
  const functionBody = extractDefaultExportFunctionBody(source);
  if (functionBody !== null) {
    const returned = extractOnlyReturnExpression(functionBody);
    return returned !== null && isSelfClosingJsxElement(returned, localName);
  }

  const arrowExpression = extractDefaultExportArrowExpression(source);
  return arrowExpression !== null && isSelfClosingJsxElement(arrowExpression, localName);
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

function extractOnlyReturnExpression(body: string): string | null {
  const match = /^\s*return\s+([\s\S]*?)\s*;?\s*$/.exec(body);
  return match?.[1]?.trim() ?? null;
}

function isSelfClosingJsxElement(expression: string, localName: string): boolean {
  const expr = stripWrappingParentheses(expression.trim());
  const escaped = escapeRegExp(localName);
  return new RegExp(`^<${escaped}\\s*/>$`).test(expr);
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
    return (
      `[${route.id}] Route component "${route.clientModule}" is configured as clientModule, ` +
      `but it is a server page (missing "use client"). Mandu will not bundle server pages into client islands. ` +
      `Remove the stale clientModule from .mandu/routes.manifest.json or use a *.partial.tsx / spec/slots/${route.id}.client.tsx client entry.`
    );
  }

  return null;
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
    `  The page imports client-looking modules, but inline .client.tsx imports are not route bundles:\n` +
    `${importList}\n` +
    `  Fix: use partial({ component }).Render for embedded client regions, or expose a route-level client module.`
  );
}
