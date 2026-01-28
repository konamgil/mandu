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

    // 파라미터 플레이스홀더를 임시 토큰으로 대체
    const PARAM_PLACEHOLDER = "\x00PARAM\x00";
    const paramMatches: string[] = [];

    const withPlaceholders = pattern.replace(
      /:([a-zA-Z_][a-zA-Z0-9_]*)/g,
      (_, paramName) => {
        paramMatches.push(paramName);
        return PARAM_PLACEHOLDER;
      }
    );

    // regex 특수문자 이스케이프 (/ 포함)
    const escaped = withPlaceholders.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

    // 플레이스홀더를 캡처 그룹으로 복원하고 paramNames 채우기
    let paramIndex = 0;
    const regexStr = escaped.replace(
      new RegExp(PARAM_PLACEHOLDER.replace(/\x00/g, "\\x00"), "g"),
      () => {
        paramNames.push(paramMatches[paramIndex++]);
        return "([^/]+)";
      }
    );

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
