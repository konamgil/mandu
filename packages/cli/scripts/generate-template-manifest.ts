#!/usr/bin/env bun
/**
 * Phase 9b B — Template manifest generator.
 * Phase 9.R2 — Extended to also emit a synchronous CLI-UX markdown manifest.
 * Phase 11.A — Extended to embed `@mandujs/skills` SKILL.md payloads so the
 *             `mandu init` binary-mode path stops emitting 9 ENOENT warnings
 *             (Phase 9 audit I-03).
 *
 * Walks `packages/cli/templates/{default,realtime-chat,auth-starter}/`
 * and emits two files into `packages/cli/generated/`:
 *
 *   1. `templates-manifest.js` — plain JavaScript containing one static
 *      `import … with { type: "file" }` per scaffold file (so
 *      `bun build --compile` embeds the bytes into the binary) plus a
 *      `TEMPLATE_MANIFEST` Map for O(1) lookup.
 *   2. `templates-manifest.d.ts` — TypeScript type surface for the Map,
 *      consumed by `src/util/templates.ts`.
 *
 * R2 additionally emits:
 *
 *   3. `cli-ux-manifest.js` — synchronous markdown payloads for the CLI
 *      UX layer (init landing + error screens). These use
 *      `import … with { type: "text" }` so the **string content** itself
 *      is embedded at compile-time — unlike `type: "file"` which only
 *      embeds a `$bunfs` path and requires an async read. Synchronous
 *      access is mandatory here because `formatCLIError()` is called
 *      from the `CLIError` constructor (which cannot be async) and
 *      `renderInitLanding()` is a synchronous console.log pipeline.
 *   4. `cli-ux-manifest.d.ts` — type surface for (3).
 *
 * Phase 11.A additionally emits:
 *
 *   5. `skills-manifest.js` — 9 `SKILL.md` payloads from
 *      `../../skills/skills/<id>/SKILL.md` plus the shared Claude
 *      `settings.json`, all via `with { type: "text" }`. Inside a
 *      compiled binary (`mandu.exe init`), the skills-copy step in
 *      `init.ts` previously walked the real filesystem and hit 9
 *      ENOENT warnings because `@mandujs/skills` is not reachable from
 *      `$bunfs`. Embedding the payloads as strings here closes that
 *      hole while keeping the skills package self-contained for dev
 *      users who consume it directly.
 *   6. `skills-manifest.d.ts` — type surface for (5).
 *
 * Why `.js` rather than `.ts`? The CLI tsconfig has `allowJs` off by
 * default, so `tsc` ignores the real manifest file entirely and never
 * has to resolve its `.ts` / `.tsx` / `.md` / `.css` file imports. That
 * keeps all ~110 template source files out of the TypeScript compilation
 * graph. Both `bun run` and `bun build --compile` resolve `.js` normally
 * and process the `with { type: "file" }` attribute, so the runtime
 * behavior is unchanged.
 *
 * The generated files are committed (source, not build artifacts). Re-run
 * this script whenever `packages/cli/templates/` contents change.
 *
 * Why code-gen instead of a dynamic glob?
 *   - Bun's `with { type: "file" }` / `type: "text"` only embed statically
 *     resolvable imports. Dynamic `fs.readdirSync` does NOT survive
 *     `--compile`.
 *   - Hand-writing ~110 imports is not maintainable.
 *
 * See also:
 *   docs/bun/phase-9-diagnostics/compile-binary.md §3.1 (the blocker this
 *   generator resolves).
 */

import fs from "node:fs";
import path from "node:path";

const CLI_ROOT = path.resolve(import.meta.dir, "..");
const TEMPLATES_DIR = path.join(CLI_ROOT, "templates");
// `@mandujs/skills` source tree — `SKILL.md` and the shared Claude
// `settings.json` live here. Relative so the generator still runs when
// the repo is vendored into a different path.
const SKILLS_PACKAGE_ROOT = path.resolve(CLI_ROOT, "..", "skills");
const SKILLS_DIR = path.join(SKILLS_PACKAGE_ROOT, "skills");
const SKILLS_TEMPLATES_DIR = path.join(SKILLS_PACKAGE_ROOT, "templates");
// Generated files live OUTSIDE `src/` so the CLI tsconfig (`include:
// ["src/**/*"]`) does not pull their `with { type: "file" }` imports into
// the TypeScript compilation graph. We also emit the manifest as a
// **JavaScript** (`.js`) file — `tsc` does not typecheck `.js` sources
// by default (no `allowJs`), which is exactly what we want. A companion
// `.d.ts` gives `src/util/templates.ts` a typed surface without forcing
// `tsc` to resolve the file imports.
//
// Runtime (`bun run`) and `bun build --compile` both resolve the `.js`
// entry normally and process the `with { type: "file" }` imports; the
// templates are therefore embedded correctly in the compiled binary.
const OUTPUT_JS = path.join(CLI_ROOT, "generated", "templates-manifest.js");
const OUTPUT_DTS = path.join(CLI_ROOT, "generated", "templates-manifest.d.ts");
const OUTPUT_UX_JS = path.join(CLI_ROOT, "generated", "cli-ux-manifest.js");
const OUTPUT_UX_DTS = path.join(CLI_ROOT, "generated", "cli-ux-manifest.d.ts");
const OUTPUT_SKILLS_JS = path.join(CLI_ROOT, "generated", "skills-manifest.js");
const OUTPUT_SKILLS_DTS = path.join(CLI_ROOT, "generated", "skills-manifest.d.ts");

/**
 * Templates that ship with `mandu init`. Must match `ALLOWED_TEMPLATES` in
 * `src/commands/init.ts`. `errors/` is intentionally excluded — its files
 * are consumed by `src/errors/messages.ts` via a separate path and are
 * managed by Phase 9a (CLI UX).
 */
const TEMPLATE_NAMES = ["default", "realtime-chat", "auth-starter"] as const;

/**
 * CLI-UX markdown files that must be readable **synchronously** and
 * **pre-embedded as strings** inside compiled binaries. Relative to
 * `packages/cli/templates/`.
 *
 * `init-landing.md` is consumed by `renderInitLanding()` in
 * `src/commands/init.ts`. Error files are consumed by `formatCLIError()`
 * in `src/errors/messages.ts`. Both entry points are sync, so we use
 * `with { type: "text" }` to inline the string payload directly.
 */
const CLI_UX_INIT_LANDING_REL = "init-landing.md";
const CLI_UX_ERRORS_DIR_REL = "errors";

/**
 * Mandu Claude Code skills embedded into the CLI binary. Must stay in
 * sync with `packages/skills/src/index.ts::SKILL_IDS` and
 * `packages/skills/src/init-integration.ts::SKILL_DIRS`. An identity
 * test in `tests/util/__tests__/skills-manifest.test.ts` asserts this
 * array matches the runtime source of truth so a silent drift is caught
 * at CI time.
 */
const SKILL_IDS = [
  "mandu-create-feature",
  "mandu-create-api",
  "mandu-debug",
  "mandu-explain",
  "mandu-guard-guide",
  "mandu-deploy",
  "mandu-slot",
  "mandu-fs-routes",
  "mandu-hydration",
] as const;

/**
 * Auxiliary skills assets (shared Claude `settings.json`) — required by
 * `setupClaudeSkills` in `@mandujs/skills/init-integration`. Path is
 * relative to `packages/skills/` (so the generated import resolves via
 * `../../skills/templates/.claude/settings.json`).
 */
const SKILL_SETTINGS_REL = path.posix.join(".claude", "settings.json");

interface TemplateFile {
  /** Template name (e.g. "default"). */
  template: string;
  /** POSIX-normalized path relative to the template root. */
  relPath: string;
  /** Filesystem path relative to `src/util/` (used in the `import` stmt). */
  importSpecifier: string;
  /** Unique TypeScript identifier for the `import` binding. */
  identifier: string;
}

interface CliUxTextFile {
  /** Stable key used by callers (e.g. "init-landing" or "errors/CLI_E001"). */
  key: string;
  /** POSIX path relative to templates/ (used for the `import` specifier). */
  relPath: string;
  /** `../templates/<rel>` — the import specifier. */
  importSpecifier: string;
  /** Unique TypeScript identifier for the `import` binding. */
  identifier: string;
}

interface SkillsTextFile {
  /**
   * Stable key used by consumers. For SKILL.md payloads this is the
   * skill id (`"mandu-create-feature"` etc.). For auxiliary assets, a
   * prefixed key (`"settings/.claude/settings.json"`) keeps lookups
   * unambiguous even if a future skill id would collide.
   */
  key: string;
  /** `../../skills/<...>` — the import specifier. */
  importSpecifier: string;
  /** Unique TypeScript identifier for the `import` binding. */
  identifier: string;
}

function walk(dir: string, base: string, out: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.posix.join(base, entry.name.replace(/\\/g, "/"));
    if (entry.isDirectory()) {
      walk(abs, rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function makeIdentifier(template: string, relPath: string, counter: Map<string, number>): string {
  // Convert "default/app/page.tsx" -> "tpl_default_app_page_tsx"
  // Collisions (unlikely but possible after sanitization) get a numeric suffix.
  const raw = `tpl_${template}_${relPath}`;
  const sanitized = raw.replace(/[^a-zA-Z0-9_]/g, "_").replace(/__+/g, "_");
  const count = (counter.get(sanitized) ?? 0) + 1;
  counter.set(sanitized, count);
  return count === 1 ? sanitized : `${sanitized}_${count}`;
}

function makeUxIdentifier(relPath: string, counter: Map<string, number>): string {
  const raw = `uxtpl_${relPath}`;
  const sanitized = raw.replace(/[^a-zA-Z0-9_]/g, "_").replace(/__+/g, "_");
  const count = (counter.get(sanitized) ?? 0) + 1;
  counter.set(sanitized, count);
  return count === 1 ? sanitized : `${sanitized}_${count}`;
}

function makeSkillIdentifier(key: string, counter: Map<string, number>): string {
  const raw = `skill_${key}`;
  const sanitized = raw.replace(/[^a-zA-Z0-9_]/g, "_").replace(/__+/g, "_");
  const count = (counter.get(sanitized) ?? 0) + 1;
  counter.set(sanitized, count);
  return count === 1 ? sanitized : `${sanitized}_${count}`;
}

function collectTemplateFiles(): TemplateFile[] {
  const files: TemplateFile[] = [];
  const idCounter = new Map<string, number>();

  for (const name of TEMPLATE_NAMES) {
    const absTemplateDir = path.join(TEMPLATES_DIR, name);
    if (!fs.existsSync(absTemplateDir)) {
      throw new Error(
        `Template directory missing: ${absTemplateDir}. ` +
          `Expected one of: ${TEMPLATE_NAMES.join(", ")}.`
      );
    }
    const relFiles = walk(absTemplateDir, "").sort();
    for (const rel of relFiles) {
      // relPath normalizes to POSIX form; importSpecifier is relative to
      // `packages/cli/generated/` (the directory of templates-manifest.ts).
      const normalizedRel = rel.replace(/^\//, "");
      const importSpecifier = `../templates/${name}/${normalizedRel}`;
      const identifier = makeIdentifier(name, normalizedRel, idCounter);
      files.push({
        template: name,
        relPath: normalizedRel,
        importSpecifier,
        identifier,
      });
    }
  }

  return files;
}

/**
 * Enumerate CLI UX markdown payloads. Order is deterministic: landing
 * first, then `errors/*.md` in sorted order.
 */
function collectCliUxFiles(): CliUxTextFile[] {
  const out: CliUxTextFile[] = [];
  const idCounter = new Map<string, number>();

  // 1. Init landing.
  const landingAbs = path.join(TEMPLATES_DIR, CLI_UX_INIT_LANDING_REL);
  if (!fs.existsSync(landingAbs)) {
    throw new Error(
      `CLI-UX template missing: ${landingAbs}. Phase 9a requires this file.`
    );
  }
  out.push({
    key: "init-landing",
    relPath: CLI_UX_INIT_LANDING_REL,
    importSpecifier: `../templates/${CLI_UX_INIT_LANDING_REL}`,
    identifier: makeUxIdentifier(CLI_UX_INIT_LANDING_REL, idCounter),
  });

  // 2. Error templates.
  const errorsDir = path.join(TEMPLATES_DIR, CLI_UX_ERRORS_DIR_REL);
  if (fs.existsSync(errorsDir)) {
    const entries = fs.readdirSync(errorsDir).filter((n) => n.endsWith(".md")).sort();
    for (const entry of entries) {
      const rel = path.posix.join(CLI_UX_ERRORS_DIR_REL, entry);
      const key = `errors/${entry.replace(/\.md$/, "")}`;
      out.push({
        key,
        relPath: rel,
        importSpecifier: `../templates/${rel}`,
        identifier: makeUxIdentifier(rel, idCounter),
      });
    }
  }

  return out;
}

/**
 * Enumerate skill payloads. Deterministic order:
 *   1. SKILL.md files — one per entry in `SKILL_IDS`, in declaration order.
 *   2. Auxiliary assets (currently just the shared `.claude/settings.json`).
 *
 * Throws if any expected SKILL.md is missing — a missing skill at
 * generator time is a repo integrity bug, not a runtime degradation.
 */
function collectSkillsFiles(): SkillsTextFile[] {
  const out: SkillsTextFile[] = [];
  const idCounter = new Map<string, number>();

  for (const skillId of SKILL_IDS) {
    const abs = path.join(SKILLS_DIR, skillId, "SKILL.md");
    if (!fs.existsSync(abs)) {
      throw new Error(
        `Skill file missing: ${abs}. ` +
          `Expected one SKILL.md per id in SKILL_IDS (${SKILL_IDS.length} total).`
      );
    }
    const importSpecifier = `../../skills/skills/${skillId}/SKILL.md`;
    out.push({
      key: skillId,
      importSpecifier,
      identifier: makeSkillIdentifier(skillId, idCounter),
    });
  }

  // Shared Claude settings — consumed by setupClaudeSkills() as the
  // source payload for `.claude/settings.json` in the scaffolded project.
  const settingsAbs = path.join(SKILLS_TEMPLATES_DIR, ".claude", "settings.json");
  if (!fs.existsSync(settingsAbs)) {
    throw new Error(
      `Skill settings template missing: ${settingsAbs}. ` +
        `setupClaudeSkills requires this file.`
    );
  }
  out.push({
    key: `settings/${SKILL_SETTINGS_REL}`,
    importSpecifier: `../../skills/templates/${SKILL_SETTINGS_REL}`,
    identifier: makeSkillIdentifier(`settings_${SKILL_SETTINGS_REL}`, idCounter),
  });

  return out;
}

interface GeneratedSources {
  js: string;
  dts: string;
}

function generateSources(files: TemplateFile[]): GeneratedSources {
  const byTemplate = new Map<string, TemplateFile[]>();
  for (const f of files) {
    const list = byTemplate.get(f.template) ?? [];
    list.push(f);
    byTemplate.set(f.template, list);
  }

  const jsHeader = `// AUTO-GENERATED by packages/cli/scripts/generate-template-manifest.ts.
// DO NOT EDIT MANUALLY. Re-run the script whenever packages/cli/templates/
// contents change: \`bun run packages/cli/scripts/generate-template-manifest.ts\`.
//
// This file is intentionally JavaScript (not TypeScript). The CLI tsconfig
// has no \`allowJs\`, so \`tsc\` skips it entirely — keeping the
// \`with { type: "file" }\` imports (and the ~110 template files they
// reference) out of the compilation graph. A companion \`.d.ts\` gives
// \`src/util/templates.ts\` the public surface it needs.
//
// Static \`with { type: "file" }\` imports are what cause \`bun build --compile\`
// to embed the template bytes into the resulting binary. At dev-time each
// import returns the on-disk absolute path; inside a compiled binary it
// returns a \`$bunfs/root/...\` virtual path. Both forms are consumable via
// \`Bun.file(path)\`.
//
// Consumers: src/util/templates.ts (loadTemplate, listTemplates, readTemplateFile).

`;

  const imports = files
    .map((f) => `import ${f.identifier} from "${f.importSpecifier}" with { type: "file" };`)
    .join("\n");

  const manifestEntries: string[] = [];
  for (const [template, list] of byTemplate) {
    const lines = list
      .map((f) => `    ["${f.relPath}", ${f.identifier}],`)
      .join("\n");
    manifestEntries.push(`  ["${template}", new Map([\n${lines}\n  ])],`);
  }

  const manifestBody = `
/**
 * Map from template name to a map of (relative POSIX path → embedded file path).
 * The inner value is the string returned by each \`import … with { type: "file" }\`
 * declaration, which is passed directly to \`Bun.file(path)\`.
 */
export const TEMPLATE_MANIFEST = new Map([
${manifestEntries.join("\n")}
]);

/** Total number of embedded template files (sanity check). */
export const EMBEDDED_FILE_COUNT = ${files.length};
`;

  const js = `${jsHeader}${imports}\n${manifestBody}`;

  const dts = `// AUTO-GENERATED by packages/cli/scripts/generate-template-manifest.ts.
// DO NOT EDIT MANUALLY. Provides the type surface for templates-manifest.js
// so \`src/util/templates.ts\` can import it without \`tsc\` ever processing
// the underlying \`with { type: "file" }\` declarations.

/**
 * Map from template name (e.g. \`"default"\`) to a map of
 * (POSIX relative path → embedded file path usable with \`Bun.file\`).
 */
export const TEMPLATE_MANIFEST: ReadonlyMap<string, ReadonlyMap<string, string>>;

/** Total number of embedded template files (sanity check). */
export const EMBEDDED_FILE_COUNT: number;
`;

  return { js, dts };
}

/**
 * Generate the CLI-UX manifest (init-landing + error markdown payloads).
 *
 * Key differences vs. `generateSources`:
 *   - Uses `with { type: "text" }` so the import binds to the **string
 *     content**, not an embedded path. This survives `--compile` as a
 *     plain inlined string and is therefore synchronously accessible.
 *   - Exports a `Map<string, string>` keyed by stable identifiers
 *     (`"init-landing"`, `"errors/CLI_E001"`, etc.) — the keys must
 *     match what `renderInitLanding` and `formatCLIError` look up.
 */
function generateUxSources(files: CliUxTextFile[]): GeneratedSources {
  const header = `// AUTO-GENERATED by packages/cli/scripts/generate-template-manifest.ts.
// DO NOT EDIT MANUALLY. Re-run the script whenever packages/cli/templates/
// \`init-landing.md\` or \`errors/*.md\` change:
//   bun run packages/cli/scripts/generate-template-manifest.ts
//
// Unlike templates-manifest.js (which embeds file bytes via
// \`with { type: "file" }\` for async \`Bun.file()\` reads), this manifest
// uses \`with { type: "text" }\` so the markdown **string payload** is
// inlined at compile-time. That gives \`formatCLIError()\` (called from
// the \`CLIError\` constructor — cannot be async) and
// \`renderInitLanding()\` (synchronous console output) a synchronous
// source of truth that works identically in dev (\`bun run\`) and compiled
// binaries (\`bun build --compile\`).
//
// Consumers: src/errors/messages.ts (loadErrorTemplate),
//            src/commands/init.ts (loadInitLandingTemplate).

`;

  const imports = files
    .map((f) => `import ${f.identifier} from "${f.importSpecifier}" with { type: "text" };`)
    .join("\n");

  const mapEntries = files
    .map((f) => `  ["${f.key}", ${f.identifier}],`)
    .join("\n");

  const body = `
/**
 * Map from stable CLI-UX key (e.g. \`"init-landing"\` or
 * \`"errors/CLI_E001"\`) to the **raw markdown text** embedded at build
 * time. Callers can consume values synchronously — no filesystem access
 * is required at runtime.
 */
export const CLI_UX_TEMPLATES = new Map([
${mapEntries}
]);

/** Total count (sanity check for tests and diagnostics). */
export const CLI_UX_TEMPLATE_COUNT = ${files.length};
`;

  const dts = `// AUTO-GENERATED by packages/cli/scripts/generate-template-manifest.ts.
// DO NOT EDIT MANUALLY. Provides the type surface for cli-ux-manifest.js.

/**
 * Map from stable key (e.g. \`"init-landing"\`, \`"errors/CLI_E001"\`) to
 * the embedded markdown string payload. Payloads are pre-embedded via
 * \`with { type: "text" }\` so access is synchronous in both dev and
 * compiled-binary modes.
 */
export const CLI_UX_TEMPLATES: ReadonlyMap<string, string>;

/** Total number of embedded CLI-UX markdown payloads. */
export const CLI_UX_TEMPLATE_COUNT: number;
`;

  const js = `${header}${imports}\n${body}`;
  return { js, dts };
}

/**
 * Generate the skills manifest (9 SKILL.md + shared .claude/settings.json).
 *
 * Identical mechanism to `generateUxSources`: `with { type: "text" }`
 * embeds the string payload, so lookups via `SKILLS_MANIFEST.get(key)`
 * are synchronous and filesystem-free. That closes the Phase 9 audit
 * I-03 gap where `@mandujs/skills/init-integration::setupClaudeSkills`
 * used `copyFile`/`readFile` against a `$bunfs` virtual path and silently
 * failed 9 times inside `mandu.exe init`.
 *
 * Consumers:
 *   - `src/util/templates.ts::loadSkillFiles` — public API the CLI
 *     wires into the `init` skills-copy step.
 *   - `@mandujs/skills/init-integration` — detects the manifest at
 *     runtime and prefers it over filesystem reads (so both binary and
 *     dev paths go through the same bytes).
 */
function generateSkillsSources(files: SkillsTextFile[]): GeneratedSources {
  const header = `// AUTO-GENERATED by packages/cli/scripts/generate-template-manifest.ts.
// DO NOT EDIT MANUALLY. Re-run the script whenever
// packages/skills/skills/<id>/SKILL.md or
// packages/skills/templates/.claude/settings.json change:
//   bun run packages/cli/scripts/generate-template-manifest.ts
//
// Phase 11.A — Fixes Phase 9 audit I-03: inside a compiled binary
// (\`mandu.exe init\`) the Claude-Code-skills step called
// \`setupClaudeSkills\` in \`@mandujs/skills/init-integration\`, which
// used \`copyFile\`/\`readFile\` against paths that resolved to
// \`$bunfs/...\`. That filesystem is read-only and \`@mandujs/skills\`
// lives on disk, not in the binary, so every skill copy silently errored
// out — users saw 9 warnings during init.
//
// This manifest embeds the 9 SKILL.md payloads + the shared Claude
// \`settings.json\` as **inline strings** via \`with { type: "text" }\`.
// Lookups are synchronous and identical in dev and compiled modes.
//
// Consumers:
//   src/util/templates.ts  (loadSkillFiles, resolveSkillPayload)
//   @mandujs/skills/init-integration (runtime manifest hand-off)

`;

  const imports = files
    .map((f) => `import ${f.identifier} from "${f.importSpecifier}" with { type: "text" };`)
    .join("\n");

  const mapEntries = files
    .map((f) => `  ["${f.key}", ${f.identifier}],`)
    .join("\n");

  const body = `
/**
 * Map from skill key to its raw UTF-8 text payload. Keys:
 *   - SKILL ids (e.g. "mandu-create-feature") → contents of
 *     \`packages/skills/skills/<id>/SKILL.md\`.
 *   - \`"settings/<rel>"\` → auxiliary Claude configuration files from
 *     \`packages/skills/templates/<rel>\` (currently only
 *     \`".claude/settings.json"\`).
 *
 * Consumers should treat the returned string as opaque bytes — do not
 * attempt to reconstruct file paths from the key shape.
 */
export const SKILLS_MANIFEST = new Map([
${mapEntries}
]);

/**
 * Ordered list of skill IDs embedded in the manifest. Mirrors the runtime
 * \`SKILL_IDS\` export in \`@mandujs/skills\` — if the two drift, the
 * unit test in \`tests/util/__tests__/skills-manifest.test.ts\` fails.
 */
export const EMBEDDED_SKILL_IDS = [
${SKILL_IDS.map((id) => `  "${id}",`).join("\n")}
];

/** Sanity check: expected total count (9 SKILL.md + 1 settings.json). */
export const SKILLS_PAYLOAD_COUNT = ${files.length};
`;

  const dts = `// AUTO-GENERATED by packages/cli/scripts/generate-template-manifest.ts.
// DO NOT EDIT MANUALLY. Provides the type surface for skills-manifest.js.

/**
 * Map from skill key to raw UTF-8 text payload. Synchronously accessible
 * in dev and compiled binaries because the imports use
 * \`with { type: "text" }\` (string inlining), not
 * \`with { type: "file" }\` (embedded path).
 */
export const SKILLS_MANIFEST: ReadonlyMap<string, string>;

/** Ordered skill IDs (must match \`@mandujs/skills\` SKILL_IDS). */
export const EMBEDDED_SKILL_IDS: readonly string[];

/** Expected total payload count (SKILL.md files + auxiliary settings). */
export const SKILLS_PAYLOAD_COUNT: number;
`;

  const js = `${header}${imports}\n${body}`;
  return { js, dts };
}

function main(): void {
  // 1. Scaffold templates (unchanged behavior).
  const files = collectTemplateFiles();
  const { js, dts } = generateSources(files);
  fs.mkdirSync(path.dirname(OUTPUT_JS), { recursive: true });
  fs.writeFileSync(OUTPUT_JS, js, "utf-8");
  fs.writeFileSync(OUTPUT_DTS, dts, "utf-8");
  const byTemplate = new Map<string, number>();
  for (const f of files) {
    byTemplate.set(f.template, (byTemplate.get(f.template) ?? 0) + 1);
  }
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${path.relative(CLI_ROOT, OUTPUT_JS)} + .d.ts ` +
      `(${files.length} files: ${[...byTemplate.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")})`
  );

  // 2. CLI-UX markdown manifest (new in R2).
  const uxFiles = collectCliUxFiles();
  const uxSources = generateUxSources(uxFiles);
  fs.writeFileSync(OUTPUT_UX_JS, uxSources.js, "utf-8");
  fs.writeFileSync(OUTPUT_UX_DTS, uxSources.dts, "utf-8");
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${path.relative(CLI_ROOT, OUTPUT_UX_JS)} + .d.ts ` +
      `(${uxFiles.length} payloads: ${uxFiles.map((f) => f.key).join(", ")})`
  );

  // 3. Skills manifest (Phase 11.A, fixes Phase 9 I-03).
  const skillFiles = collectSkillsFiles();
  const skillSources = generateSkillsSources(skillFiles);
  fs.writeFileSync(OUTPUT_SKILLS_JS, skillSources.js, "utf-8");
  fs.writeFileSync(OUTPUT_SKILLS_DTS, skillSources.dts, "utf-8");
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${path.relative(CLI_ROOT, OUTPUT_SKILLS_JS)} + .d.ts ` +
      `(${skillFiles.length} payloads: ${skillFiles.map((f) => f.key).join(", ")})`
  );
}

if (import.meta.main) {
  main();
}
