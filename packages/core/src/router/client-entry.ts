import { readFile } from "fs/promises";
import path from "path";
import type { RouteSpec } from "../spec/schema";

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
