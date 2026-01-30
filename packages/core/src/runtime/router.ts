/**
 * Mandu Router v5 - Hybrid Trie Architecture
 *
 * @version 5.0.0
 * @see docs/architecture/06_mandu_router_v5_hybrid_trie.md
 *
 * Features:
 * - Static routes: Map O(1) lookup
 * - Dynamic routes: Trie O(k) lookup (k = segments)
 * - Security: %2F blocking, double-encoding protection
 * - Validation: Duplicate detection, param name conflicts
 */

import type { RouteSpec } from "../spec/schema";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Encoded slash pattern for security checks */
const ENCODED_SLASH_PATTERN = /%2f/i;

/** Fixed key for wildcard params */
const WILDCARD_PARAM_KEY = "$wildcard";

// ═══════════════════════════════════════════════════════════════════════════
// Types & Interfaces
// ═══════════════════════════════════════════════════════════════════════════

export interface MatchResult {
  route: RouteSpec;
  params: Record<string, string>;
}

export interface RouterOptions {
  /** Enable debug logging */
  debug?: boolean;
}

export interface RouterStats {
  staticCount: number;
  dynamicCount: number;
  totalRoutes: number;
}

export type RouterErrorCode =
  | "DUPLICATE_PATTERN"
  | "PARAM_NAME_CONFLICT"
  | "WILDCARD_NOT_LAST"
  | "ROUTE_CONFLICT";

// ═══════════════════════════════════════════════════════════════════════════
// RouterError Class
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Router-specific error with error code for programmatic handling
 */
export class RouterError extends Error {
  public readonly name = "RouterError";

  constructor(
    message: string,
    public readonly code: RouterErrorCode,
    public readonly routeId: string,
    public readonly conflictsWith?: string
  ) {
    super(message);

    // V8 stack trace capture
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RouterError);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TrieNode Class
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trie node for dynamic route matching
 *
 * Structure:
 * - children: Map for static segments
 * - paramChild: Single param child with name tracking (P0-4)
 * - wildcardRoute: Route for wildcard (*) matching
 * - route: Route that terminates at this node
 */
class TrieNode {
  /** Static segment children */
  children: Map<string, TrieNode> = new Map();

  /** Parameter child with name for conflict detection */
  paramChild: { name: string; node: TrieNode } | null = null;

  /** Wildcard route (only valid at leaf) */
  wildcardRoute: RouteSpec | null = null;

  /** Route terminating at this node */
  route: RouteSpec | null = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Security Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Safe URI component decoding with 4-layer security
 *
 * Security checks:
 * 1. Pre-decode %2F check (encoded slash)
 * 2. decodeURIComponent execution
 * 3. Post-decode slash check
 * 4. Double-encoding check (%252F -> %2F)
 *
 * @returns Decoded string or null if security violation
 */
function safeDecodeURIComponent(str: string): string | null {
  // 1. Pre-decode %2F check
  if (ENCODED_SLASH_PATTERN.test(str)) {
    return null;
  }

  // 2. Decode
  let decoded: string;
  try {
    decoded = decodeURIComponent(str);
  } catch {
    // Malformed UTF-8
    return null;
  }

  // 3. Post-decode slash check
  if (decoded.includes("/")) {
    return null;
  }

  // 4. Double-encoding check
  if (ENCODED_SLASH_PATTERN.test(decoded)) {
    return null;
  }

  return decoded;
}

// ═══════════════════════════════════════════════════════════════════════════
// Router Class
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hybrid Trie Router
 *
 * Matching order:
 * 1. Static routes (Map) - O(1)
 * 2. Dynamic routes (Trie) - O(k)
 *
 * Static routes always take precedence over dynamic routes.
 */
export class Router {
  /** Static routes for O(1) lookup */
  private statics: Map<string, RouteSpec> = new Map();

  /** Trie root for dynamic routes */
  private trie: TrieNode = new TrieNode();

  /** Registered patterns for duplicate detection (normalized -> routeId) */
  private registeredPatterns: Map<string, string> = new Map();

  /** Debug mode */
  private debug: boolean;

  constructor(routes: RouteSpec[] = [], options: RouterOptions = {}) {
    this.debug = options.debug ?? false;
    this.setRoutes(routes);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set routes (replaces existing routes)
   * @throws {RouterError} On validation failure
   */
  setRoutes(routes: RouteSpec[]): void {
    // Clear existing state
    this.statics.clear();
    this.trie = new TrieNode();
    this.registeredPatterns.clear();

    // Register each route with validation
    for (const route of routes) {
      this.validateAndRegister(route);
    }

    if (this.debug) {
      console.log(`[Router] Registered ${routes.length} routes`);
      console.log(`[Router] Static: ${this.statics.size}, Dynamic: ${this.registeredPatterns.size - this.statics.size}`);
    }
  }

  /**
   * Add a single route
   * @throws {RouterError} On validation failure
   */
  addRoute(route: RouteSpec): void {
    this.validateAndRegister(route);
  }

  /**
   * Match pathname to route
   *
   * @returns MatchResult or null (including security violations)
   */
  match(pathname: string): MatchResult | null {
    const normalized = this.normalize(pathname);

    // 1. Static lookup O(1)
    const staticRoute = this.statics.get(normalized);
    if (staticRoute) {
      if (this.debug) {
        console.log(`[Router] Static match: ${normalized} -> ${staticRoute.id}`);
      }
      return { route: staticRoute, params: {} };
    }

    // 2. Trie lookup O(k)
    return this.matchTrie(normalized);
  }

  /**
   * Get all registered routes
   */
  getRoutes(): RouteSpec[] {
    const routes: RouteSpec[] = [];

    // Collect from statics
    for (const route of this.statics.values()) {
      routes.push(route);
    }

    // Collect from trie (DFS)
    this.collectTrieRoutes(this.trie, routes);

    return routes;
  }

  /**
   * Get router statistics
   */
  getStats(): RouterStats {
    const staticCount = this.statics.size;
    const totalRoutes = this.registeredPatterns.size;
    return {
      staticCount,
      dynamicCount: totalRoutes - staticCount,
      totalRoutes,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Normalization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Normalize path (P0-1)
   * - "/" stays as is
   * - Remove trailing slash for others
   */
  private normalize(path: string): string {
    if (path === "/") return "/";
    return path.replace(/\/+$/, "");
  }

  /**
   * Check if pattern is static (no params or wildcards)
   */
  private isStatic(pattern: string): boolean {
    return !pattern.includes(":") && !pattern.includes("*");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Validation & Registration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Validate and register a route
   * @throws {RouterError} On validation failure
   */
  private validateAndRegister(route: RouteSpec): void {
    const { id, pattern } = route;
    const normalized = this.normalize(pattern);
    const segments = normalized.split("/").filter(Boolean);

    // P0-1: Duplicate check on normalized pattern
    const existing = this.registeredPatterns.get(normalized);
    if (existing) {
      throw new RouterError(
        `Pattern "${pattern}" duplicates existing pattern from route "${existing}"`,
        "DUPLICATE_PATTERN",
        id,
        existing
      );
    }

    // P0-2: Segment-based wildcard validation
    const wildcardIdx = segments.findIndex((s) => s === "*");
    if (wildcardIdx !== -1 && wildcardIdx !== segments.length - 1) {
      throw new RouterError(
        `Wildcard must be the last segment in pattern "${pattern}"`,
        "WILDCARD_NOT_LAST",
        id
      );
    }

    // Register based on type
    if (this.isStatic(normalized)) {
      this.statics.set(normalized, route);
    } else {
      this.insertTrie(normalized, segments, route);
    }

    this.registeredPatterns.set(normalized, id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Trie Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Insert route into trie
   * @throws {RouterError} On param name conflict
   */
  private insertTrie(pattern: string, segments: string[], route: RouteSpec): void {
    let node = this.trie;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      // Wildcard handling
      if (seg === "*") {
        node.wildcardRoute = route;
        return;
      }

      // Parameter handling
      if (seg.startsWith(":")) {
        const paramName = seg.slice(1);

        // P0-3: Param name conflict detection
        if (node.paramChild) {
          if (node.paramChild.name !== paramName) {
            throw new RouterError(
              `Parameter name conflict at depth ${i}: ":${paramName}" vs existing ":${node.paramChild.name}" in pattern "${pattern}"`,
              "PARAM_NAME_CONFLICT",
              route.id
            );
          }
          node = node.paramChild.node;
        } else {
          const newNode = new TrieNode();
          node.paramChild = { name: paramName, node: newNode };
          node = newNode;
        }
        continue;
      }

      // Static segment handling
      if (!node.children.has(seg)) {
        node.children.set(seg, new TrieNode());
      }
      node = node.children.get(seg)!;
    }

    node.route = route;
  }

  /**
   * Match pathname against trie
   */
  private matchTrie(pathname: string): MatchResult | null {
    const segments = pathname.split("/").filter(Boolean);
    const params: Record<string, string> = {};
    let node = this.trie;

    // Track wildcard candidate for backtracking
    let wildcardMatch: { route: RouteSpec; consumed: number } | null = null;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      // Save wildcard candidate before advancing
      if (node.wildcardRoute) {
        wildcardMatch = { route: node.wildcardRoute, consumed: i };
      }

      // 1. Try static child first (higher priority)
      const staticChild = node.children.get(seg);
      if (staticChild) {
        node = staticChild;
        continue;
      }

      // 2. Try param child
      if (node.paramChild) {
        const decoded = safeDecodeURIComponent(seg);
        if (decoded === null) {
          // Security violation
          if (this.debug) {
            console.log(`[Router] Security block: ${seg}`);
          }
          return null;
        }
        params[node.paramChild.name] = decoded;
        node = node.paramChild.node;
        continue;
      }

      // 3. No match - try wildcard fallback
      if (wildcardMatch) {
        const remaining = segments.slice(wildcardMatch.consumed).join("/");
        if (this.debug) {
          console.log(`[Router] Wildcard match: ${wildcardMatch.route.id} with ${remaining}`);
        }
        return {
          route: wildcardMatch.route,
          params: { [WILDCARD_PARAM_KEY]: remaining },
        };
      }

      // No match at all
      return null;
    }

    // End of path - check for route at current node
    if (node.route) {
      if (this.debug) {
        console.log(`[Router] Trie match: ${node.route.id}`);
      }
      return { route: node.route, params };
    }

    // Check for wildcard at current node (but with no remaining segments)
    // Policy A: /files/* does NOT match /files
    if (node.wildcardRoute) {
      // Don't match - wildcard requires at least one segment
      if (this.debug) {
        console.log(`[Router] Wildcard policy A: ${pathname} does not match wildcard`);
      }
    }

    // Try wildcard fallback from earlier in the path
    if (wildcardMatch) {
      const remaining = segments.slice(wildcardMatch.consumed).join("/");
      return {
        route: wildcardMatch.route,
        params: { [WILDCARD_PARAM_KEY]: remaining },
      };
    }

    return null;
  }

  /**
   * Collect routes from trie (for getRoutes)
   */
  private collectTrieRoutes(node: TrieNode, routes: RouteSpec[]): void {
    if (node.route && !this.statics.has(this.normalize(node.route.pattern))) {
      routes.push(node.route);
    }

    if (node.wildcardRoute) {
      routes.push(node.wildcardRoute);
    }

    for (const child of node.children.values()) {
      this.collectTrieRoutes(child, routes);
    }

    if (node.paramChild) {
      this.collectTrieRoutes(node.paramChild.node, routes);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory Function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new router instance
 */
export function createRouter(routes: RouteSpec[] = [], options: RouterOptions = {}): Router {
  return new Router(routes, options);
}

// ═══════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════

export { WILDCARD_PARAM_KEY };
