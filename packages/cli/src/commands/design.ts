/**
 * `mandu design <subcommand>` — DESIGN.md operations.
 *
 * Issue #245 M1 (minimal slice — parser + scaffold + import + validate).
 * Subsequent slices add `pick` (interactive catalog), `diff` (upstream
 * comparison), and `extract` (token proposal from source) — see
 * `docs/issues/2026-04-issue-245-design-system-mechanism.md`.
 *
 * Subcommands:
 *   - `init [--from <slug|url>]` — write a fresh DESIGN.md (empty
 *     skeleton or imported brand spec). Refuses to overwrite an
 *     existing file unless `--force` is passed.
 *   - `import <slug|url>`        — overwrite the existing DESIGN.md
 *     with an imported brand spec (init-on-existing-project case).
 *   - `validate`                 — parse the DESIGN.md and report
 *     missing / empty / malformed sections. Non-zero exit when the
 *     file is missing entirely.
 *
 * @module cli/commands/design
 */

import path from "node:path";
import fs from "node:fs/promises";
import {
  EMPTY_DESIGN_MD,
  compileTailwindTheme,
  fetchUpstreamDesignMd,
  linkAgentsToDesignMd,
  lintDesignSpec,
  mergeThemeIntoCss,
  parseDesignMd,
  validateDesignSpec,
  humanizeSectionId,
} from "@mandujs/core/compat/design/index";
import type { ValidationIssue, LintIssue } from "@mandujs/core/compat/design/index";

const DEFAULT_FILENAME = "DESIGN.md";

export interface DesignCommandOptions {
  /** Subcommand. */
  action: "init" | "import" | "validate" | "sync" | "lint" | "link";
  /** Project root (for tests). Defaults to `process.cwd()`. */
  rootDir?: string;
  /** `--from <slug|url>` value (init only) or positional arg (import). */
  from?: string;
  /** `--force` — overwrite existing DESIGN.md. */
  force?: boolean;
  /** Override target filename. Defaults to `DESIGN.md`. */
  filename?: string;
  /** sync: target globals.css path (default: `app/globals.css` or `src/globals.css`). */
  cssPath?: string;
  /** sync: print compiled theme without writing the file. */
  dryRun?: boolean;
  /** link: also create AGENTS.md when neither AGENTS.md nor CLAUDE.md exists. */
  createIfMissing?: boolean;
}

export async function design(options: DesignCommandOptions): Promise<boolean> {
  const rootDir = options.rootDir ?? process.cwd();
  const filename = options.filename ?? DEFAULT_FILENAME;
  const target = path.join(rootDir, filename);
  switch (options.action) {
    case "init":
      return runInit(target, options);
    case "import":
      return runImport(target, options);
    case "validate":
      return runValidate(target);
    case "sync":
      return runSync(target, options, rootDir);
    case "lint":
      return runLint(target);
    case "link":
      return runLink(rootDir, options);
  }
}

/* -------------------------------------------------------------------- */
/* mandu design lint — DESIGN.md self-consistency (#245 M5)             */
/* -------------------------------------------------------------------- */

async function runLint(designMdPath: string): Promise<boolean> {
  if (!(await fileExists(designMdPath))) {
    console.error(
      `❌ ${path.basename(designMdPath)} not found. Run \`mandu design init\` to create one.`,
    );
    return false;
  }
  const source = await Bun.file(designMdPath).text();
  const spec = parseDesignMd(source);
  const result = lintDesignSpec(spec);
  console.log(`🎨 mandu design lint — ${path.relative(process.cwd(), designMdPath) || designMdPath}`);
  console.log("");
  if (result.issues.length === 0) {
    console.log("✅ No content issues found.");
    return true;
  }
  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warning");
  const infos = result.issues.filter((i) => i.severity === "info");
  console.log(
    `Issues: ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info(s)`,
  );
  console.log("");
  for (const issue of result.issues) {
    printLintIssue(issue);
  }
  if (!result.ok) {
    console.log("");
    console.log(
      "❌ Errors above must be fixed before `mandu design sync` will produce a valid Tailwind theme.",
    );
  }
  return result.ok;
}

function printLintIssue(issue: LintIssue): void {
  const icon = issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️ " : "ℹ️ ";
  const header = `${icon} ${issue.severity.toUpperCase()} [${issue.section}] ${issue.rule}`;
  console.log(header);
  console.log(`     ${issue.message}`);
  if (issue.name) console.log(`     name: ${issue.name}`);
  console.log("");
}

/* -------------------------------------------------------------------- */
/* mandu design link — wire AGENTS.md / CLAUDE.md to DESIGN.md (#245 M5)*/
/* -------------------------------------------------------------------- */

async function runLink(
  rootDir: string,
  options: DesignCommandOptions,
): Promise<boolean> {
  const result = await linkAgentsToDesignMd({
    rootDir,
    designFilename: options.filename ?? DEFAULT_FILENAME,
    createIfMissing: options.createIfMissing === true,
  });
  console.log("🎨 mandu design link — wiring AGENTS.md / CLAUDE.md to DESIGN.md");
  for (const entry of result.files) {
    const rel = path.relative(rootDir, entry.path) || path.basename(entry.path);
    if (entry.action === "unchanged") {
      console.log(`   • ${rel}: not present (skipped)`);
    } else if (entry.action === "created") {
      console.log(`   📝 ${rel}: created with design link block`);
    } else if (entry.action === "inserted") {
      console.log(`   📝 ${rel}: inserted design link block`);
    } else {
      console.log(`   📝 ${rel}: refreshed design link block`);
    }
  }
  if (!result.changed) {
    console.log("");
    console.log(
      "Nothing to do. Pass --create to seed AGENTS.md when neither AGENTS.md nor CLAUDE.md exists.",
    );
  }
  return true;
}

/* -------------------------------------------------------------------- */
/* mandu design sync — DESIGN.md → Tailwind v4 @theme (#245 M3)         */
/* -------------------------------------------------------------------- */

async function runSync(
  designMdPath: string,
  options: DesignCommandOptions,
  rootDir: string,
): Promise<boolean> {
  if (!(await fileExists(designMdPath))) {
    console.error(
      `❌ ${path.basename(designMdPath)} not found. Run \`mandu design init\` to create one.`,
    );
    return false;
  }

  const source = await Bun.file(designMdPath).text();
  const spec = parseDesignMd(source);
  const compiled = compileTailwindTheme(spec);

  console.log(`🎨 mandu design sync — compiling ${path.relative(rootDir, designMdPath) || "DESIGN.md"}`);
  console.log(
    `   Tokens: ${compiled.entries.length} variable(s) across ${
      new Set(compiled.entries.map((e) => e.section)).size
    } section(s)`,
  );

  if (compiled.entries.length === 0) {
    console.log("");
    console.log(
      "⚠ No structured tokens found. DESIGN.md sections (Color Palette, Typography, Layout, Depth & Elevation) need bullet/list entries with parseable values.",
    );
    return true;
  }

  for (const warning of compiled.warnings) {
    console.log(`   ⚠ ${warning.section}: ${warning.message}`);
  }

  if (options.dryRun) {
    console.log("");
    console.log("--- compiled @theme block (dry-run) ---");
    console.log(compiled.cssBody);
    console.log("--- end ---");
    return true;
  }

  const cssPath = await resolveCssPath(rootDir, options.cssPath);
  const existingCss = (await fileExists(cssPath)) ? await Bun.file(cssPath).text() : "";
  const merged = mergeThemeIntoCss(existingCss, compiled);

  if (merged.conflicts.length > 0) {
    console.log("");
    console.log(`⚠ ${merged.conflicts.length} conflict(s) — DESIGN.md token vs hand-written @theme:`);
    for (const c of merged.conflicts) {
      console.log(`   ${c.variable}: DESIGN.md=${c.fromDesign} ↔ globals.css=${c.fromCss}`);
    }
    console.log("   Generated region wins inside the @mandu-design-sync markers.");
    console.log("   Reconcile by editing DESIGN.md or removing the duplicate from globals.css.");
  }

  await Bun.write(cssPath, merged.css);
  const verb = merged.inserted ? "inserted into" : "updated in";
  console.log("");
  console.log(`📝 ${verb} ${path.relative(rootDir, cssPath) || cssPath}`);
  console.log("   Restart \`mandu dev\` (or save the CSS file) to pick up the new tokens.");
  return true;
}

async function resolveCssPath(rootDir: string, override?: string): Promise<string> {
  if (override) return path.resolve(rootDir, override);
  const candidates = [
    "app/globals.css",
    "src/globals.css",
    "src/app/globals.css",
    "src/styles/globals.css",
  ];
  for (const rel of candidates) {
    const full = path.join(rootDir, rel);
    if (await fileExists(full)) return full;
  }
  // Default: create app/globals.css if nothing exists yet.
  return path.join(rootDir, "app/globals.css");
}

async function runInit(
  target: string,
  options: DesignCommandOptions,
): Promise<boolean> {
  const exists = await fileExists(target);
  if (exists && !options.force) {
    console.error(
      `❌ ${path.basename(target)} already exists. Use \`mandu design import <slug>\` to overwrite, ` +
        `or pass --force to replace.`,
    );
    return false;
  }
  let body: string;
  if (options.from) {
    console.log(`🎨 mandu design init — fetching DESIGN.md from "${options.from}"`);
    try {
      body = await fetchUpstreamDesignMd(options.from);
    } catch (err) {
      console.error(
        `❌ Failed to fetch DESIGN.md: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  } else {
    body = EMPTY_DESIGN_MD;
  }
  await Bun.write(target, body);
  console.log(`📝 wrote ${path.relative(process.cwd(), target) || target} (${body.length} bytes)`);
  console.log("");
  console.log("Next steps:");
  console.log("  • Fill in any empty sections (or run `mandu design import <slug>` to swap)");
  console.log("  • Reference DESIGN.md from your AGENTS.md / CLAUDE.md so agents read it first");
  console.log("");
  return true;
}

async function runImport(
  target: string,
  options: DesignCommandOptions,
): Promise<boolean> {
  if (!options.from) {
    console.error(
      "❌ `mandu design import` requires a slug or URL. Example: `mandu design import stripe`",
    );
    return false;
  }
  console.log(`🎨 mandu design import — fetching from "${options.from}"`);
  let body: string;
  try {
    body = await fetchUpstreamDesignMd(options.from);
  } catch (err) {
    console.error(
      `❌ Failed to fetch DESIGN.md: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
  await Bun.write(target, body);
  console.log(`📝 wrote ${path.relative(process.cwd(), target) || target} (${body.length} bytes)`);
  return true;
}

async function runValidate(target: string): Promise<boolean> {
  if (!(await fileExists(target))) {
    console.error(
      `❌ ${path.basename(target)} not found at ${target}. Run \`mandu design init\` to create one.`,
    );
    return false;
  }
  const source = await Bun.file(target).text();
  const spec = parseDesignMd(source);
  const result = validateDesignSpec(spec);

  console.log(`🎨 mandu design validate — ${path.relative(process.cwd(), target) || target}`);
  if (spec.title) console.log(`   Title: ${spec.title}`);
  console.log("");

  const _ok = result.issues.filter((i) => i.kind !== "missing").length;
  const present = Object.values(spec.sections).filter((s) => s.present).length;
  console.log(`Sections: ${present}/9 present, ${result.issues.length} issue(s)`);
  console.log("");

  if (result.issues.length === 0) {
    console.log("✅ All 9 sections populated.");
    return true;
  }

  groupAndPrint(result.issues);
  console.log("");
  console.log(
    "Note: empty/missing sections are advisory — Mandu's Guard rule only acts on tokens that exist.",
  );
  return true;
}

function groupAndPrint(issues: readonly ValidationIssue[]): void {
  const byKind = new Map<ValidationIssue["kind"], ValidationIssue[]>();
  for (const issue of issues) {
    const list = byKind.get(issue.kind) ?? [];
    list.push(issue);
    byKind.set(issue.kind, list);
  }
  const order: ValidationIssue["kind"][] = ["missing", "empty", "malformed"];
  for (const kind of order) {
    const list = byKind.get(kind);
    if (!list || list.length === 0) continue;
    const label =
      kind === "missing" ? "📭 Missing" : kind === "empty" ? "🗒️  Empty" : "⚠️  Malformed";
    console.log(`${label}:`);
    for (const issue of list) {
      console.log(`  - ${humanizeSectionId(issue.section)} — ${issue.message}`);
    }
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
