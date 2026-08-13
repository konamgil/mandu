/**
 * mandu info — Environment + config + health summary dump.
 *
 * Single-command snapshot designed for two audiences:
 *
 *   1. Human operators triaging "why does my build look weird?" — pretty
 *      console table grouped by section.
 *   2. Agents / LLMs / issue reports that need one blob they can paste
 *      back. `--json` emits a stable, machine-readable payload.
 *
 * Sections:
 *   - mandu       : installed @mandujs/* package versions
 *   - runtime     : Bun / Node / OS / CPU / memory / NODE_ENV
 *   - project     : package.json name + version + packageManager field
 *   - config      : mandu.config.* distilled summary (server / guard /
 *                    build / i18n / transitions / prefetch / spa)
 *   - routes      : total + per-kind counts from `scanRoutes()`
 *   - middleware  : length + named entries
 *   - plugins     : length + named entries with declared hooks
 *   - diagnose    : health report from `runExtendedDiagnose()` (Issue #215)
 *
 * Flags:
 *   --json                 Emit the payload as JSON to stdout (no table).
 *   --include <sections>   Comma-separated filter. Example:
 *                          `--include mandu,runtime,diagnose` shows only
 *                          those three and omits the rest.
 *
 * Missing `mandu.config.ts` is NOT an error — the command reports
 * `config: null` (JSON) / `(no config)` (human) and keeps going. This is
 * important because agents often run `mandu info` in a partially-scaffolded
 * project where the config file is exactly the thing they're about to
 * generate.
 */

import os from "os";
import path from "path";
import { resolveFromCwd, pathExists } from "../util/fs";
import {
  CONFIG_FILES,
  loadManduConfig,
  scanRoutes,
  type ManduConfig,
} from "@mandujs/core";
import {
  runExtendedDiagnose,
  type DiagnoseCheckResult,
  type DiagnoseReport,
} from "@mandujs/core/compat/diagnose/index";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type InfoSection =
  | "mandu"
  | "runtime"
  | "project"
  | "config"
  | "routes"
  | "middleware"
  | "plugins"
  | "diagnose";

export const ALL_SECTIONS: readonly InfoSection[] = [
  "mandu",
  "runtime",
  "project",
  "config",
  "routes",
  "middleware",
  "plugins",
  "diagnose",
] as const;

export interface InfoOptions {
  /** Emit JSON instead of the human-readable table. */
  json?: boolean;
  /**
   * Comma-separated list of sections to include. Empty / omitted = all.
   * Unknown section names are silently ignored (forward-compat).
   */
  include?: string;
  /**
   * Explicit project root override. Defaults to `process.cwd()`. Used by
   * tests to point at an isolated fixture directory.
   */
  cwd?: string;
}

export interface ManduVersions {
  core: string | null;
  cli: string | null;
  mcp: string | null;
  ate: string | null;
  skills: string | null;
  edge: string | null;
}

export interface RuntimeInfo {
  bun: string | null;
  node: string;
  platform: string;
  arch: string;
  osRelease: string;
  cpuCount: number;
  cpuModel: string | null;
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  nodeEnv: string;
}

export interface ProjectInfo {
  name: string | null;
  version: string | null;
  root: string;
  packageManager: string | null;
  configFile: string | null;
}

export interface ConfigSummary {
  server: {
    port: number | null;
    hostname: string | null;
    streaming: boolean | null;
  };
  guard: {
    preset: string | null;
    customRules: number;
    ruleOverrides: number;
  };
  build: {
    prerender: boolean | null;
    budget: {
      maxRawBytes: number | null;
      maxGzBytes: number | null;
      mode: string | null;
    } | null;
  };
  i18n: {
    locales: number;
    defaultLocale: string | null;
    strategy: string | null;
  } | null;
  transitions: boolean;
  prefetch: boolean;
  spa: boolean;
}

export interface RoutesInfo {
  total: number;
  byKind: Record<string, number>;
  errors: number;
}

export interface MiddlewareEntry {
  index: number;
  name: string;
}

export interface PluginEntry {
  name: string;
  hooks: string[];
}

export interface InfoPayload {
  mandu?: ManduVersions;
  runtime?: RuntimeInfo;
  project?: ProjectInfo;
  config?: ConfigSummary | null;
  routes?: RoutesInfo | null;
  middleware?: MiddlewareEntry[];
  plugins?: PluginEntry[];
  diagnose?: {
    healthy: boolean;
    errorCount: number;
    warningCount: number;
    checks: Array<{
      ok: boolean;
      rule: string;
      severity?: string;
      message: string;
    }>;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════

function resolveSections(include: string | undefined): Set<InfoSection> {
  if (!include || include === "true" || !include.trim()) {
    return new Set(ALL_SECTIONS);
  }
  const requested = new Set<InfoSection>();
  for (const raw of include.split(",")) {
    const s = raw.trim() as InfoSection;
    if ((ALL_SECTIONS as readonly string[]).includes(s)) {
      requested.add(s);
    }
  }
  // Empty filter (all unknown) → fall back to everything. Avoids a silent
  // "no output" trap when the user typos a section name.
  if (requested.size === 0) return new Set(ALL_SECTIONS);
  return requested;
}

async function readJsonVersion(absPath: string): Promise<string | null> {
  try {
    const file = Bun.file(absPath);
    if (!(await file.exists())) return null;
    const data = (await file.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

async function readPackageField<T = unknown>(
  absPath: string,
  field: string,
): Promise<T | null> {
  try {
    const file = Bun.file(absPath);
    if (!(await file.exists())) return null;
    const data = (await file.json()) as Record<string, unknown>;
    const v = data[field];
    return (v ?? null) as T | null;
  } catch {
    return null;
  }
}

async function collectManduVersions(rootDir: string): Promise<ManduVersions> {
  const packages: Array<keyof ManduVersions> = [
    "core",
    "cli",
    "mcp",
    "ate",
    "skills",
    "edge",
  ];
  const out: ManduVersions = {
    core: null,
    cli: null,
    mcp: null,
    ate: null,
    skills: null,
    edge: null,
  };
  // Strategy: project node_modules first (reflects what the project is
  // actually linked against), then fall back to require.resolve (handy in
  // monorepo workspaces where packages live outside node_modules).
  await Promise.all(
    packages.map(async (pkg) => {
      const nm = path.join(rootDir, "node_modules", "@mandujs", pkg, "package.json");
      const viaNodeModules = await readJsonVersion(nm);
      if (viaNodeModules) {
        out[pkg] = viaNodeModules;
        return;
      }
      try {
        const resolved = require.resolve(`@mandujs/${pkg}/package.json`);
        out[pkg] = await readJsonVersion(resolved);
      } catch {
        out[pkg] = null;
      }
    }),
  );
  return out;
}

function collectRuntime(): RuntimeInfo {
  const cpus = os.cpus();
  const mem = process.memoryUsage();
  return {
    bun: process.versions.bun ?? null,
    node: process.version,
    platform: process.platform,
    arch: os.arch(),
    osRelease: os.release(),
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model?.trim() ?? null,
    memoryTotalBytes: os.totalmem(),
    memoryUsedBytes: mem.rss,
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
}

async function collectProject(rootDir: string): Promise<ProjectInfo> {
  const pkgPath = path.join(rootDir, "package.json");
  const name = await readPackageField<string>(pkgPath, "name");
  const version = await readPackageField<string>(pkgPath, "version");
  const packageManager = await readPackageField<string>(pkgPath, "packageManager");

  let configFile: string | null = null;
  for (const name of CONFIG_FILES) {
    const abs = path.join(rootDir, name);
    if (await pathExists(abs)) {
      configFile = name;
      break;
    }
  }

  return {
    name,
    version,
    root: rootDir,
    packageManager,
    configFile,
  };
}

function summarizeConfig(config: ManduConfig | null): ConfigSummary | null {
  if (!config) return null;

  const server = config.server ?? {};
  const guard = config.guard ?? {};
  const build = config.build ?? {};
  const i18n = config.i18n;

  // Guard rules can be Record<string, severity> (overrides) or GuardRule[]
  // (custom rules). Count each shape appropriately.
  let customRules = 0;
  let ruleOverrides = 0;
  if (Array.isArray(guard.rules)) {
    customRules = guard.rules.length;
  } else if (guard.rules && typeof guard.rules === "object") {
    ruleOverrides = Object.keys(guard.rules).length;
  }

  // build.prerender lives under build (untyped here) — user-exposed on the
  // public ManduConfig shape via a union we don't directly reach through.
  // Read defensively.
  const buildRaw = build as Record<string, unknown>;
  const prerender =
    typeof buildRaw.prerender === "boolean" ? (buildRaw.prerender as boolean) : null;

  const budgetRaw = build.budget;
  const budget = budgetRaw
    ? {
        maxRawBytes: typeof budgetRaw.maxRawBytes === "number" ? budgetRaw.maxRawBytes : null,
        maxGzBytes: typeof budgetRaw.maxGzBytes === "number" ? budgetRaw.maxGzBytes : null,
        mode: budgetRaw.mode ?? null,
      }
    : null;

  return {
    server: {
      port: typeof server.port === "number" ? server.port : null,
      hostname: typeof server.hostname === "string" ? server.hostname : null,
      streaming: typeof server.streaming === "boolean" ? server.streaming : null,
    },
    guard: {
      preset: typeof guard.preset === "string" ? guard.preset : null,
      customRules,
      ruleOverrides,
    },
    build: {
      prerender,
      budget,
    },
    i18n: i18n
      ? {
          locales: Array.isArray(i18n.locales) ? i18n.locales.length : 0,
          defaultLocale: i18n.defaultLocale ?? null,
          strategy: i18n.strategy ?? null,
        }
      : null,
    transitions: config.transitions !== false, // default true
    prefetch: config.prefetch !== false, // default true
    spa: config.spa !== false, // default true
  };
}

async function collectRoutes(
  rootDir: string,
  config: ManduConfig | null,
): Promise<RoutesInfo | null> {
  // Only attempt a scan when the project actually has an `app/` tree; the
  // alternative is a confusing "0 routes" line for every fresh checkout.
  const appDir = path.join(rootDir, config?.fsRoutes?.routesDir ?? "app");
  if (!(await pathExists(appDir))) return null;

  try {
    const scan = await scanRoutes(rootDir, config?.fsRoutes);
    const byKind: Record<string, number> = {};
    for (const route of scan.routes) {
      const kind = String(route.kind ?? "unknown");
      byKind[kind] = (byKind[kind] ?? 0) + 1;
    }
    return {
      total: scan.routes.length,
      byKind,
      errors: scan.errors.length,
    };
  } catch {
    return null;
  }
}

function collectMiddleware(config: ManduConfig | null): MiddlewareEntry[] {
  if (!config?.middleware || !Array.isArray(config.middleware)) return [];
  return config.middleware.map((m, index) => {
    // Middleware may be a plain function (anonymous) or a `defineMiddleware`
    // result with a `.name` metadata field. Fall back to the function name.
    const nameField = (m as { name?: unknown }).name;
    const fnName = typeof m === "function" ? (m as { name?: string }).name : undefined;
    const name =
      typeof nameField === "string" && nameField.length > 0
        ? nameField
        : typeof fnName === "string" && fnName.length > 0
          ? fnName
          : "(anonymous)";
    return { index, name };
  });
}

function collectPlugins(config: ManduConfig | null): PluginEntry[] {
  if (!config?.plugins || !Array.isArray(config.plugins)) return [];
  return config.plugins.map((p) => {
    const name =
      typeof (p as { name?: unknown }).name === "string"
        ? ((p as { name: string }).name)
        : "(anonymous)";
    // Hooks can arrive as a `hooks` object (ManduPlugin contract) OR as
    // top-level lifecycle function keys on the plugin itself. Combine both.
    const rawHooks = (p as { hooks?: Record<string, unknown> }).hooks;
    const hookKeys: Set<string> = new Set();
    if (rawHooks && typeof rawHooks === "object") {
      for (const key of Object.keys(rawHooks)) {
        if (typeof (rawHooks as Record<string, unknown>)[key] === "function") {
          hookKeys.add(key);
        }
      }
    }
    const pRecord = p as unknown as Record<string, unknown>;
    for (const key of Object.keys(pRecord)) {
      if (key === "name" || key === "hooks") continue;
      if (typeof pRecord[key] === "function") {
        hookKeys.add(key);
      }
    }
    return { name, hooks: [...hookKeys].sort() };
  });
}

async function collectDiagnose(rootDir: string): Promise<InfoPayload["diagnose"]> {
  try {
    const report: DiagnoseReport = await runExtendedDiagnose(rootDir);
    return {
      healthy: report.healthy,
      errorCount: report.errorCount,
      warningCount: report.warningCount,
      checks: report.checks.map((c: DiagnoseCheckResult) => ({
        ok: c.ok,
        rule: c.rule,
        severity: c.severity,
        message: c.message,
      })),
    };
  } catch (err) {
    return {
      healthy: false,
      errorCount: 1,
      warningCount: 0,
      checks: [
        {
          ok: false,
          rule: "diagnose_unavailable",
          severity: "error",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Human-readable renderer
// ═══════════════════════════════════════════════════════════════════════════

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function renderHuman(payload: InfoPayload, sections: Set<InfoSection>, lines: string[]): void {
  lines.push("Mandu Info");

  if (sections.has("mandu") && payload.mandu) {
    lines.push("");
    lines.push("mandu");
    const m = payload.mandu;
    const rows: Array<[string, string]> = [
      ["@mandujs/core", m.core ?? "(not installed)"],
      ["@mandujs/cli", m.cli ?? "(not installed)"],
      ["@mandujs/mcp", m.mcp ?? "(not installed)"],
      ["@mandujs/ate", m.ate ?? "(not installed)"],
      ["@mandujs/skills", m.skills ?? "(not installed)"],
      ["@mandujs/edge", m.edge ?? "(not installed)"],
    ];
    for (const [k, v] of rows) {
      lines.push(`  ${k.padEnd(18)} ${v}`);
    }
  }

  if (sections.has("runtime") && payload.runtime) {
    const r = payload.runtime;
    lines.push("");
    lines.push("runtime");
    lines.push(`  Bun              ${r.bun ?? "(not running under Bun)"}`);
    lines.push(`  Node             ${r.node}`);
    lines.push(`  OS               ${r.platform} ${r.arch} (${r.osRelease})`);
    lines.push(`  CPU              ${r.cpuCount} cores${r.cpuModel ? ` — ${r.cpuModel}` : ""}`);
    lines.push(
      `  Memory           ${formatBytes(r.memoryTotalBytes)} total / ${formatBytes(r.memoryUsedBytes)} used`,
    );
    lines.push(`  NODE_ENV         ${r.nodeEnv}`);
  }

  if (sections.has("project") && payload.project) {
    const p = payload.project;
    lines.push("");
    lines.push("project");
    lines.push(`  name             ${p.name ?? "(unknown)"}`);
    lines.push(`  version          ${p.version ?? "(unknown)"}`);
    lines.push(`  root             ${p.root}`);
    lines.push(`  packageManager   ${p.packageManager ?? "(unspecified)"}`);
    lines.push(`  config           ${p.configFile ?? "(no config)"}`);
  }

  if (sections.has("config")) {
    lines.push("");
    lines.push("mandu.config summary");
    if (!payload.config) {
      lines.push("  (no config)");
    } else {
      const c = payload.config;
      lines.push(
        `  server           { port: ${c.server.port ?? "default"}, hostname: ${JSON.stringify(c.server.hostname ?? "default")} }`,
      );
      lines.push(
        `  guard            { preset: ${JSON.stringify(c.guard.preset ?? "mandu")}, customRules: ${c.guard.customRules}, overrides: ${c.guard.ruleOverrides} }`,
      );
      const budget = c.build.budget;
      lines.push(
        `  build            { prerender: ${c.build.prerender ?? "default"}, budget: ${
          budget
            ? `maxGz=${budget.maxGzBytes ?? "-"} mode=${budget.mode ?? "-"}`
            : "off"
        } }`,
      );
      if (c.i18n) {
        lines.push(
          `  i18n             { locales: ${c.i18n.locales}, default: ${JSON.stringify(c.i18n.defaultLocale ?? "")}, strategy: ${JSON.stringify(c.i18n.strategy ?? "")} }`,
        );
      } else {
        lines.push("  i18n             off");
      }
      lines.push(`  transitions      ${c.transitions}`);
      lines.push(`  prefetch         ${c.prefetch}`);
      lines.push(`  spa              ${c.spa}`);
    }
  }

  if (sections.has("routes")) {
    lines.push("");
    lines.push("routes");
    if (!payload.routes) {
      lines.push("  (no app/ directory found)");
    } else {
      lines.push(`  total            ${payload.routes.total}`);
      for (const [kind, count] of Object.entries(payload.routes.byKind)) {
        lines.push(`    ${kind.padEnd(14)} ${count}`);
      }
      if (payload.routes.errors > 0) {
        lines.push(`  scan errors      ${payload.routes.errors}`);
      }
    }
  }

  if (sections.has("middleware")) {
    const list = payload.middleware ?? [];
    lines.push("");
    lines.push(`middleware chain (${list.length})`);
    if (list.length === 0) {
      lines.push("  (none)");
    } else {
      for (const m of list) {
        lines.push(`  ${m.index + 1}. ${m.name}`);
      }
    }
  }

  if (sections.has("plugins")) {
    const list = payload.plugins ?? [];
    lines.push("");
    lines.push(`plugins (${list.length})`);
    if (list.length === 0) {
      lines.push("  (none)");
    } else {
      for (const p of list) {
        const hooks = p.hooks.length > 0 ? ` (hooks: ${p.hooks.join(", ")})` : "";
        lines.push(`  - ${p.name}${hooks}`);
      }
    }
  }

  if (sections.has("diagnose") && payload.diagnose) {
    lines.push("");
    lines.push("diagnose");
    for (const check of payload.diagnose.checks) {
      const glyph = check.ok
        ? "[ok]"
        : check.severity === "warning"
          ? "[warn]"
          : "[err]";
      lines.push(`  ${glyph.padEnd(7)} ${check.rule}`);
    }
    const verdict = payload.diagnose.healthy ? "HEALTHY" : "UNHEALTHY";
    lines.push(
      `  → ${verdict} (${payload.diagnose.errorCount} error, ${payload.diagnose.warningCount} warning)`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the structured payload without emitting it. Exposed for tests and
 * for callers that want to embed `mandu info` output inside another report
 * (e.g., the diagnose panel in Kitchen).
 */
export async function collectInfo(options: InfoOptions = {}): Promise<InfoPayload> {
  const rootDir = options.cwd ?? resolveFromCwd(".");
  const sections = resolveSections(options.include);

  // Load config once and reuse. Failures are swallowed — the command must
  // succeed in a half-scaffolded project.
  let config: ManduConfig | null = null;
  let hasConfig = false;
  try {
    for (const name of CONFIG_FILES) {
      if (await pathExists(path.join(rootDir, name))) {
        hasConfig = true;
        break;
      }
    }
    if (hasConfig) {
      config = await loadManduConfig(rootDir);
    }
  } catch {
    config = null;
  }

  const payload: InfoPayload = {};

  // Parallelize every independent section. `collectMiddleware` / `collectPlugins`
  // are synchronous so they're cheap to interleave.
  const tasks: Array<Promise<void>> = [];

  if (sections.has("mandu")) {
    tasks.push(
      (async () => {
        payload.mandu = await collectManduVersions(rootDir);
      })(),
    );
  }
  if (sections.has("runtime")) {
    payload.runtime = collectRuntime();
  }
  if (sections.has("project")) {
    tasks.push(
      (async () => {
        payload.project = await collectProject(rootDir);
      })(),
    );
  }
  if (sections.has("config")) {
    payload.config = summarizeConfig(config);
  }
  if (sections.has("routes")) {
    tasks.push(
      (async () => {
        payload.routes = await collectRoutes(rootDir, config);
      })(),
    );
  }
  if (sections.has("middleware")) {
    payload.middleware = collectMiddleware(config);
  }
  if (sections.has("plugins")) {
    payload.plugins = collectPlugins(config);
  }
  if (sections.has("diagnose")) {
    tasks.push(
      (async () => {
        payload.diagnose = await collectDiagnose(rootDir);
      })(),
    );
  }

  await Promise.all(tasks);
  return payload;
}

/**
 * Render the payload to stdout. Returns true so `registerCommand` reports
 * exit 0. The command does NOT propagate diagnose failure to exit code —
 * that's `mandu diagnose`'s job. `mandu info` is an inspector, not a gate.
 */
export async function info(options: InfoOptions = {}): Promise<boolean> {
  const payload = await collectInfo(options);
  const sections = resolveSections(options.include);

  if (options.json) {
    // Attach `sections` so JSON consumers know which fields were requested
    // vs. intentionally omitted (distinguishes "empty" from "absent").
    const envelope = {
      generatedAt: new Date().toISOString(),
      sections: [...sections],
      ...payload,
    };
    console.log(JSON.stringify(envelope, null, 2));
    return true;
  }

  const lines: string[] = [];
  renderHuman(payload, sections, lines);
  console.log(lines.join("\n"));
  return true;
}
