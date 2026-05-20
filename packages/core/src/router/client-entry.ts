import { readFile } from "fs/promises";
import path from "path";
import type { RouteSpec } from "../spec/schema";

export interface ClientComponentImport {
  module: string;
  kind: "default" | "named" | "namespace" | "side-effect" | "mixed";
  names: string[];
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
