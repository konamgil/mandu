import type { RouteSpec } from "../spec/schema";

export interface MatchResult {
  route: RouteSpec;
  params: Record<string, string>;
}

export class Router {
  private routes: RouteSpec[] = [];
  private compiledPatterns: Map<string, { regex: RegExp; paramNames: string[] }> = new Map();

  constructor(routes: RouteSpec[] = []) {
    this.setRoutes(routes);
  }

  setRoutes(routes: RouteSpec[]): void {
    this.routes = routes;
    this.compiledPatterns.clear();

    for (const route of routes) {
      this.compiledPatterns.set(route.id, this.compilePattern(route.pattern));
    }
  }

  private compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];

    const regexStr = pattern
      .replace(/\//g, "\\/")
      .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, paramName) => {
        paramNames.push(paramName);
        return "([^/]+)";
      });

    const regex = new RegExp(`^${regexStr}$`);
    return { regex, paramNames };
  }

  match(pathname: string): MatchResult | null {
    for (const route of this.routes) {
      const compiled = this.compiledPatterns.get(route.id);
      if (!compiled) continue;

      const match = pathname.match(compiled.regex);
      if (match) {
        const params: Record<string, string> = {};
        compiled.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });

        return { route, params };
      }
    }

    return null;
  }

  getRoutes(): RouteSpec[] {
    return [...this.routes];
  }
}

export function createRouter(routes: RouteSpec[] = []): Router {
  return new Router(routes);
}
