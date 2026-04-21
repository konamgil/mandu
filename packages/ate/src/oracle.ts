import type { InteractionNode, OracleLevel } from "./types";
import { detectDomain, type AppDomain } from "./domain-detector";
import {
  findContractForRoute,
  type ContractField,
  type ParsedContract,
} from "./contract-parser";
import {
  scanRouteSideEffects,
  type SideEffect,
} from "./side-effect-scanner";

export interface OracleResult {
  level: OracleLevel;
  l0: { ok: boolean; errors: string[] };
  l1: { ok: boolean; signals: string[] };
  l2: { ok: boolean; signals: string[] };
  l3: { ok: boolean; notes: string[] };
  /** Count of behavioral (state-change) assertions emitted by deep L3. */
  behavioralAssertions?: number;
}

export function createDefaultOracle(level: OracleLevel): OracleResult {
  return {
    level,
    l0: { ok: true, errors: [] },
    l1: { ok: level !== "L0", signals: [] },
    l2: { ok: true, signals: [] },
    l3: { ok: true, notes: [] },
  };
}

/**
 * Generate L1 assertions based on detected domain
 */
export function generateL1Assertions(domain: AppDomain, routePath: string): string[] {
  const assertions: string[] = [];

  // Common structural assertions for all domains
  assertions.push(`// L1: Domain-aware structure signals (${domain})`);
  assertions.push(`await expect(page.locator("main, [role='main']")).toBeVisible();`);

  switch (domain) {
    case "ecommerce":
      if (routePath.includes("/cart")) {
        assertions.push(`await expect(page.locator("[data-testid='cart-items'], .cart-item, [class*='cart']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("button:has-text('Checkout'), button:has-text('Proceed')")).toBeVisible();`);
      } else if (routePath.includes("/product")) {
        assertions.push(`await expect(page.locator("h1, [data-testid='product-title']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("button:has-text('Add to Cart'), button[class*='add']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("[data-testid='price'], .price, [class*='price']")).toBeVisible();`);
      } else if (routePath.includes("/checkout")) {
        assertions.push(`await expect(page.locator("form, [data-testid='checkout-form']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("input[type='email'], input[name*='email']")).toBeVisible();`);
      } else if (routePath.includes("/shop")) {
        assertions.push(`expect(await page.locator("[data-testid='product-card'], .product, [class*='product']").count()).toBeGreaterThanOrEqual(1);`);
        assertions.push(`expect(await page.locator("a[href*='/product'], [data-testid='product-link']").count()).toBeGreaterThanOrEqual(1);`);
      } else {
        // Generic ecommerce page fallback
        assertions.push(`await expect(page.locator("nav, [role='navigation']")).toBeVisible();`);
        assertions.push(`expect(await page.locator("a, button").count()).toBeGreaterThanOrEqual(1);`);
      }
      break;

    case "blog":
      if (routePath.includes("/post") || routePath.includes("/article")) {
        assertions.push(`await expect(page.locator("article, [role='article']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("h1, [data-testid='post-title']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("[data-testid='post-content'], .content, [class*='content']")).toBeVisible();`);
      } else if (routePath.includes("/author")) {
        assertions.push(`await expect(page.locator("[data-testid='author-name'], .author")).toBeVisible();`);
        assertions.push(`await expect(page.locator("[data-testid='author-posts'], .posts")).toBeVisible();`);
      } else {
        // Blog index/listing fallback
        assertions.push(`await expect(page.locator("h1, h2")).toBeVisible();`);
        assertions.push(`expect(await page.locator("a").count()).toBeGreaterThanOrEqual(1);`);
      }
      break;

    case "dashboard":
      assertions.push(`await expect(page.locator("nav, [role='navigation'], aside, [data-testid='sidebar']")).toBeVisible();`);
      if (routePath.includes("/analytics") || routePath.includes("/dashboard")) {
        assertions.push(`expect(await page.locator("canvas, svg, [data-testid='chart']").count()).toBeGreaterThanOrEqual(1);`);
        assertions.push(`expect(await page.locator("[data-testid='metric'], .metric, [class*='stat']").count()).toBeGreaterThanOrEqual(1);`);
      } else if (routePath.includes("/settings")) {
        assertions.push(`await expect(page.locator("form, [data-testid='settings-form']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("button:has-text('Save'), button[type='submit']")).toBeVisible();`);
      } else {
        // Generic dashboard page fallback
        assertions.push(`await expect(page.locator("h1, h2")).toBeVisible();`);
        assertions.push(`expect(await page.locator("a, button").count()).toBeGreaterThanOrEqual(1);`);
      }
      break;

    case "auth":
      assertions.push(`await expect(page.locator("form, [data-testid='auth-form']")).toBeVisible();`);
      if (routePath.includes("/login")) {
        assertions.push(`await expect(page.locator("input[type='email'], input[name*='email']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("input[type='password']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("button:has-text('Login'), button:has-text('Sign in')")).toBeVisible();`);
      } else if (routePath.includes("/signup") || routePath.includes("/register")) {
        assertions.push(`await expect(page.locator("input[type='email'], input[name*='email']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("input[type='password']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("button:has-text('Sign up'), button:has-text('Register')")).toBeVisible();`);
      } else if (routePath.includes("/forgot-password")) {
        assertions.push(`await expect(page.locator("input[type='email'], input[name*='email']")).toBeVisible();`);
        assertions.push(`await expect(page.locator("button:has-text('Reset'), button:has-text('Send')")).toBeVisible();`);
      } else {
        // Generic auth page fallback
        assertions.push(`expect(await page.locator("input").count()).toBeGreaterThanOrEqual(1);`);
        assertions.push(`expect(await page.locator("button[type='submit'], button").count()).toBeGreaterThanOrEqual(1);`);
      }
      break;

    case "generic":
    default:
      // Generic fallback assertions
      assertions.push(`await expect(page.locator("h1")).toBeVisible();`);
      assertions.push(`expect(await page.locator("a, button").count()).toBeGreaterThanOrEqual(1);`);
      assertions.push(`await expect(page).toHaveTitle(/.+/);`);
      break;
  }

  return assertions;
}

/**
 * Upgrade L0 test code to L1 with domain-aware assertions
 */
export function upgradeL0ToL1(testCode: string, routePath: string, sourceCode?: string): string {
  const detection = detectDomain(routePath, sourceCode);
  const l1Assertions = generateL1Assertions(detection.domain, routePath);

  // Find the L0 error check assertion
  const l0ErrorCheckRegex = /expect\(errors.*?\)\.toEqual\(\[\]\);/;
  const match = testCode.match(l0ErrorCheckRegex);

  if (!match) {
    // If no L0 error check found, append L1 assertions before the closing braces
    const closingBraceIndex = testCode.lastIndexOf("});");
    if (closingBraceIndex === -1) return testCode;

    const beforeClosing = testCode.slice(0, closingBraceIndex);
    const afterClosing = testCode.slice(closingBraceIndex);

    return `${beforeClosing}\n    ${l1Assertions.join("\n    ")}\n${afterClosing}`;
  }

  // Insert L1 assertions before the L0 error check
  const insertIndex = match.index!;
  const before = testCode.slice(0, insertIndex);
  const after = testCode.slice(insertIndex);

  return `${before}${l1Assertions.join("\n    ")}\n    ${after}`;
}

/**
 * Get assertion count for a domain and route
 */
export function getAssertionCount(domain: AppDomain, routePath: string): number {
  const assertions = generateL1Assertions(domain, routePath);
  return assertions.filter((a) => a.includes("expect(")).length;
}

/**
 * Build a synthetic valid request body from a contract POST/PUT shape.
 * Produces JSON-serializable data covering required (non-optional) fields.
 */
function synthValidBody(fields: ContractField[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.optional) continue;
    switch (f.kind) {
      case "string":
        data[f.name] = f.minLength && f.minLength > 0 ? "x".repeat(Math.max(f.minLength, 1)) : "ate-sample";
        break;
      case "number":
        data[f.name] = 1;
        break;
      case "boolean":
        data[f.name] = true;
        break;
      case "array":
        data[f.name] = [];
        break;
      case "object":
        data[f.name] = {};
        break;
      default:
        data[f.name] = "ate-sample";
    }
  }
  return data;
}

/** Map a ContractField.kind to a `typeof` check string for Playwright assertions. */
function kindToTypeofCheck(kind: ContractField["kind"]): string | null {
  switch (kind) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return null;
  }
}

/**
 * Deep L2 assertion generator using a parsed contract. Emits:
 *   - method-aware requests (POST uses synthesized valid body)
 *   - status code assertion (prefers 2xx from contract)
 *   - toHaveProperty + typeof checks for response top-level fields
 *   - edge-case: empty body → expect 4xx (when request schema has required fields)
 *   - edge-case: empty string for `min(N)` string fields → expect 4xx
 */
export function generateL2AssertionsFromContract(
  node: InteractionNode,
  contract: ParsedContract,
): string[] {
  if (node.kind !== "route") return [];
  const assertions: string[] = [];
  assertions.push(`// L2 (deep): contract-driven schema validation`);

  const method = (node.methods && node.methods[0]) || "GET";
  const methodLower = method.toLowerCase();
  const reqShape = contract.requests.find((r) => r.method === method);
  const hasBody = method !== "GET" && method !== "DELETE";

  // Pick a happy-path response: prefer 200/201
  const happyResp =
    contract.responses.find((r) => r.status === 200) ||
    contract.responses.find((r) => r.status === 201) ||
    contract.responses.find((r) => r.status >= 200 && r.status < 300);

  if (hasBody && reqShape) {
    const validBody = synthValidBody(reqShape.bodyFields);
    assertions.push(
      `const validRes = await request.${methodLower}("${node.path}", { data: ${JSON.stringify(validBody)} });`,
    );
  } else {
    assertions.push(`const validRes = await request.${methodLower}("${node.path}");`);
  }

  if (happyResp) {
    assertions.push(`expect(validRes.status()).toBe(${happyResp.status});`);
  } else {
    assertions.push(`expect(validRes.status()).toBeLessThan(400);`);
  }
  assertions.push(`expect(validRes.headers()["content-type"] ?? "").toContain("application/json");`);
  assertions.push(`const validBody = await validRes.json();`);
  assertions.push(`expect(validBody).toBeDefined();`);

  if (happyResp) {
    for (const field of happyResp.topLevelKeys) {
      assertions.push(`expect(validBody).toHaveProperty("${field.name}");`);
      const t = kindToTypeofCheck(field.kind);
      if (t) {
        assertions.push(`expect(typeof validBody.${field.name}).toBe("${t}");`);
      } else if (field.kind === "array") {
        assertions.push(`expect(Array.isArray(validBody.${field.name})).toBe(true);`);
      } else if (field.kind === "object") {
        assertions.push(`expect(typeof validBody.${field.name}).toBe("object");`);
      }
    }
  }

  // Edge case 1: empty body on mutation with required fields
  if (hasBody && reqShape && reqShape.bodyFields.some((f) => !f.optional)) {
    assertions.push(`// Edge case: empty body rejected (contract has required fields)`);
    assertions.push(
      `const emptyRes = await request.${methodLower}("${node.path}", { data: {} });`,
    );
    assertions.push(`expect(emptyRes.status()).toBeGreaterThanOrEqual(400);`);
    assertions.push(`expect(emptyRes.status()).toBeLessThan(500);`);
  }

  // Edge case 2: for each required string field with min(N), send empty string
  if (hasBody && reqShape) {
    for (const f of reqShape.bodyFields) {
      if (f.optional) continue;
      if (f.kind === "string" && (f.minLength ?? 0) > 0) {
        const baseline = synthValidBody(reqShape.bodyFields);
        const invalid = { ...baseline, [f.name]: "" };
        assertions.push(`// Edge case: empty string for required min(${f.minLength}) field "${f.name}"`);
        assertions.push(
          `const invalid_${f.name}_Res = await request.${methodLower}("${node.path}", { data: ${JSON.stringify(invalid)} });`,
        );
        assertions.push(`expect(invalid_${f.name}_Res.status()).toBeGreaterThanOrEqual(400);`);
        assertions.push(`expect(invalid_${f.name}_Res.status()).toBeLessThan(500);`);
      }
    }
  }

  return assertions;
}

export interface L2Context {
  repoRoot?: string;
  /** Pre-parsed contract; if provided, skips filesystem lookup. */
  contract?: ParsedContract | null;
}

/**
 * Generate L2 assertions: contract schema validation and SSR data verification.
 *
 * If a contract is found (or provided via ctx), uses the deep contract-driven
 * generator. Otherwise falls back to the shallow structural generator for
 * backward compatibility.
 */
export function generateL2Assertions(node: InteractionNode, ctx?: L2Context): string[] {
  if (node.kind !== "route") return [];
  const isApi = node.path.startsWith("/api/") || (node.methods && node.methods.length > 0);

  // Try deep path first
  let contract: ParsedContract | null | undefined = ctx?.contract;
  if (contract === undefined && ctx?.repoRoot && isApi) {
    try {
      contract = findContractForRoute(ctx.repoRoot, node.path);
    } catch {
      contract = null;
    }
  }
  if (contract && isApi) {
    return generateL2AssertionsFromContract(node, contract);
  }

  // Fallback: shallow structural checks (backward compatible)
  const assertions: string[] = [];
  if (isApi) {
    assertions.push(`// L2: API contract validation (shallow — no contract file found)`);
    assertions.push(`const response = await request.get("${node.path}");`);
    assertions.push(`expect(response.status()).toBeLessThan(500);`);
    assertions.push(`const contentType = response.headers()["content-type"] ?? "";`);
    assertions.push(`expect(contentType).toContain("application/json");`);
    assertions.push(`const responseBody = await response.json();`);
    assertions.push(`expect(responseBody).toBeDefined();`);
    if (node.methods?.includes("POST") || node.methods?.includes("PUT")) {
      assertions.push(`// Edge case: reject empty body on mutation endpoint`);
      assertions.push(
        `const badResponse = await request.${node.methods.includes("POST") ? "post" : "put"}("${node.path}", { data: {} });`,
      );
      assertions.push(`expect(badResponse.status()).toBeGreaterThanOrEqual(400);`);
      assertions.push(`expect(badResponse.status()).toBeLessThan(500);`);
    }
  } else {
    assertions.push(`// L2: SSR data injection verification`);
    assertions.push(`const manduDataEl = page.locator("#__MANDU_DATA__");`);
    assertions.push(`const dataCount = await manduDataEl.count();`);
    assertions.push(`if (dataCount > 0) {`);
    assertions.push(`  const raw = await manduDataEl.textContent();`);
    assertions.push(`  expect(() => JSON.parse(raw!)).not.toThrow();`);
    assertions.push(`}`);
  }
  return assertions;
}

export interface L3Context {
  repoRoot?: string;
  /** Pre-detected side effects; if provided, skips filesystem scan. */
  sideEffects?: SideEffect[];
  /** Absolute path to the route file to scan (overrides node.file resolution). */
  routeFileAbs?: string;
}

/**
 * Deep L3 assertion generator from detected side effects. For each detected
 * mutation, emits a before/after state-change verification.
 */
export function generateL3AssertionsFromSideEffects(
  node: InteractionNode,
  effects: SideEffect[],
): string[] {
  if (node.kind !== "route") return [];
  const assertions: string[] = [];
  if (effects.length === 0) return assertions;

  const seen = new Set<string>();
  assertions.push(`// L3 (deep): behavioral side-effect verification`);
  for (const eff of effects) {
    const key = `${eff.kind}:${eff.resource ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (eff.kind === "db-create") {
      const label = eff.resource ?? "resource";
      assertions.push(`// Detected side-effect: ${eff.match}`);
      assertions.push(`const before_${label} = await request.get("${node.path}");`);
      assertions.push(`const beforeBody_${label} = before_${label}.status() < 400 ? await before_${label}.json() : null;`);
      assertions.push(`const beforeCount_${label} = Array.isArray(beforeBody_${label}) ? beforeBody_${label}.length : (beforeBody_${label}?.${label}?.length ?? 0);`);
      assertions.push(`await request.post("${node.path}", { data: { _ate: true } });`);
      assertions.push(`const after_${label} = await request.get("${node.path}");`);
      assertions.push(`const afterBody_${label} = after_${label}.status() < 400 ? await after_${label}.json() : null;`);
      assertions.push(`const afterCount_${label} = Array.isArray(afterBody_${label}) ? afterBody_${label}.length : (afterBody_${label}?.${label}?.length ?? 0);`);
      assertions.push(`expect(afterCount_${label}).toBeGreaterThanOrEqual(beforeCount_${label});`);
    } else if (eff.kind === "db-update") {
      assertions.push(`// Detected side-effect: ${eff.match} — verify update is idempotent/returns 2xx`);
      assertions.push(`const updRes = await request.get("${node.path}");`);
      assertions.push(`expect(updRes.status()).toBeLessThan(500);`);
    } else if (eff.kind === "db-delete") {
      assertions.push(`// Detected side-effect: ${eff.match} — skip destructive verification (safety)`);
      assertions.push(`// Deletion flows require fixture data; verified at manual L3 scenarios.`);
    } else if (eff.kind === "email") {
      assertions.push(`// Detected side-effect: email send (${eff.match})`);
      assertions.push(`// Email verification requires a mock transport — emit as a TODO marker.`);
      assertions.push(`expect(true).toBe(true); // TODO: wire email mock assertion`);
    } else if (eff.kind === "external-fetch") {
      assertions.push(`// Detected side-effect: external fetch to ${eff.match}`);
      assertions.push(`// External calls should be verified via request interception in a real scenario.`);
    }
  }
  return assertions;
}

/**
 * Generate L3 assertions: behavioral verification (state changes, island hydration, navigation)
 */
export function generateL3Assertions(
  node: InteractionNode,
  edges: { kind: string; to?: string }[],
  ctx?: L3Context,
): string[] {
  if (node.kind !== "route") return [];
  const assertions: string[] = [];
  const isApi = node.path.startsWith("/api/") || (node.methods && node.methods.length > 0);

  // Deep path: resolve side-effects from ctx or filesystem
  let sideEffects: SideEffect[] | undefined = ctx?.sideEffects;
  if (!sideEffects && ctx?.repoRoot) {
    const routeFileAbs =
      ctx.routeFileAbs ||
      (node.kind === "route" && node.file ? `${ctx.repoRoot}/${node.file}` : undefined);
    if (routeFileAbs) {
      try {
        sideEffects = scanRouteSideEffects(routeFileAbs);
      } catch {
        sideEffects = [];
      }
    }
  }
  if (sideEffects && sideEffects.length > 0) {
    assertions.push(...generateL3AssertionsFromSideEffects(node, sideEffects));
  } else if (isApi && node.methods?.includes("POST")) {
    assertions.push(`// L3: POST state change verification`);
    assertions.push(`const beforeRes = await request.get("${node.path}");`);
    assertions.push(`const beforeStatus = beforeRes.status();`);
    assertions.push(`if (beforeStatus < 400) {`);
    assertions.push(`  const beforeBody = await beforeRes.json();`);
    assertions.push(`  const beforeCount = Array.isArray(beforeBody) ? beforeBody.length : 0;`);
    assertions.push(`  await request.post("${node.path}", { data: { _ate: true } });`);
    assertions.push(`  const afterBody = await (await request.get("${node.path}")).json();`);
    assertions.push(`  const afterCount = Array.isArray(afterBody) ? afterBody.length : 0;`);
    assertions.push(`  expect(afterCount).toBeGreaterThanOrEqual(beforeCount);`);
    assertions.push(`}`);
  }

  if (!isApi && node.hasIsland) {
    assertions.push(`// L3: Island hydration verification`);
    assertions.push(`const islands = page.locator("[data-mandu-island]");`);
    assertions.push(`const islandCount = await islands.count();`);
    assertions.push(`if (islandCount > 0) {`);
    assertions.push(`  await expect(islands.first()).toBeVisible();`);
    assertions.push(`  // Verify island has been hydrated (script loaded)`);
    assertions.push(`  const hydrated = await page.evaluate(() => typeof window.__MANDU_ISLANDS__ === "object");`);
    assertions.push(`  expect(hydrated).toBe(true);`);
    assertions.push(`}`);
  }

  // Navigation flow: verify that outgoing links resolve to valid pages
  const navTargets = edges.filter(e => e.kind === "navigate" && e.to).slice(0, 3);
  if (!isApi && navTargets.length > 0) {
    assertions.push(`// L3: Navigation flow verification`);
    for (const nav of navTargets) {
      assertions.push(`const navRes_${nav.to!.replace(/[^a-zA-Z0-9]/g, "_")} = await request.get("${nav.to}");`);
      assertions.push(`expect(navRes_${nav.to!.replace(/[^a-zA-Z0-9]/g, "_")}.status()).toBeLessThan(500);`);
    }
  }

  return assertions;
}

/**
 * Generate accessibility (a11y) assertions for a page route using @axe-core/playwright.
 *
 * The generated code imports @axe-core/playwright dynamically so that projects
 * that haven't installed it yet won't break at compile time — instead the test
 * fails with a clear "Cannot find module" at runtime.
 *
 * Usage (in user project):
 *   bun add -d @axe-core/playwright
 *
 * The returned lines are ready to be embedded inside a Playwright test body.
 */
export interface A11yOptions {
  /** Rule tags to run (passes through to AxeBuilder.withTags). Default: wcag2a, wcag2aa */
  tags?: string[];
  /** Optional selector to scope analysis; default scans full page */
  include?: string;
}

export function generateA11yAssertions(routePath: string, opts?: A11yOptions): string[] {
  const tags = opts?.tags ?? ["wcag2a", "wcag2aa"];
  const lines: string[] = [];
  lines.push(`// a11y: axe-core violation check (requires @axe-core/playwright)`);
  lines.push(`await page.goto("${routePath}");`);
  lines.push(`const { default: AxeBuilder } = await import("@axe-core/playwright");`);
  lines.push(`let axe = new AxeBuilder({ page }).withTags(${JSON.stringify(tags)});`);
  if (opts?.include) {
    lines.push(`axe = axe.include(${JSON.stringify(opts.include)});`);
  }
  lines.push(`const a11yResults = await axe.analyze();`);
  lines.push(`expect(a11yResults.violations, "a11y violations").toEqual([]);`);
  return lines;
}

/**
 * Wrap a11y assertions in a complete Playwright `test(...)` block. Convenient
 * for callers that want a drop-in spec fragment.
 */
export function generateA11yTestBlock(routePath: string, opts?: A11yOptions): string {
  const body = generateA11yAssertions(routePath, opts)
    .map((l) => `  ${l}`)
    .join("\n");
  return [
    `test("${routePath} has no a11y violations", async ({ page }) => {`,
    body,
    `});`,
  ].join("\n");
}

/** Count behavioral (state-change) assertions in a generated L3 block. */
export function countBehavioralAssertions(assertions: string[]): number {
  return assertions.filter(
    (a) => a.includes("afterCount") && a.includes("toBeGreaterThanOrEqual"),
  ).length;
}
