import type * as __ManduNodeFsTypes0 from "node:fs";
/**
 * MCP design discovery tools — Issue #245 M4 (Team C).
 *
 * Read-mostly tools agents call before / during UI work so they don't
 * have to grep the project, mis-name a component, or invent a token
 * that already exists. The tools share Mandu's `@mandujs/core/design`
 * parser + `@mandujs/core/design/tailwind-theme` compiler so agents
 * and humans see identical output.
 *
 * Tools shipped here:
 *
 *   - `mandu.design.get`        — DESIGN.md by section (or full spec)
 *   - `mandu.design.prompt`     — §9 Agent Prompts (pre-warm payload)
 *   - `mandu.design.check`      — Guard rule preview on a single file
 *   - `mandu.component.list`    — project component inventory
 *
 * Future write-tools (extract / patch / propose / diff_upstream) per
 * the v2 plan §4.3 are deferred to a follow-up — they need careful UX
 * around user-approval gating that's outside this initial slice.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  diffDesignSpecs,
  extractDesignTokens,
  fetchUpstreamDesignMd,
  parseDesignMd,
  patchDesignMdBatch,
  type DesignSpec,
  type DesignSectionId,
  type ExtractKind,
  type PatchOperation,
  type PatchableSection,
  DESIGN_SECTION_IDS,
} from "@mandujs/core/compat/design/index";
import { checkFileForDesignInlineClasses } from "@mandujs/core/compat/guard/design-inline-class";

// ─── Internal helpers ─────────────────────────────────────────────────

/**
 * Best-effort DESIGN.md location resolver. Walks the conventional
 * project root names; returns null when nothing is found so callers
 * can produce a friendly error rather than throw.
 */
async function readDesignMd(rootDir: string): Promise<{ source: string; path: string } | null> {
  const candidates = ["DESIGN.md", "design.md", "docs/DESIGN.md"];
  for (const rel of candidates) {
    const full = path.join(rootDir, rel);
    try {
      const source = await fs.readFile(full, "utf8");
      return { source, path: full };
    } catch {
      // try next
    }
  }
  return null;
}

interface GuardConfigForDesign {
  forbidInlineClasses?: string[];
  requireComponent?: Record<string, string>;
  exclude?: string[];
  designMd?: string;
  autoFromDesignMd?: boolean;
  severity?: "warning" | "error";
}

/**
 * Pull `guard.design` out of `mandu.config.ts` (or `.js`). Best-effort
 * — when no config is present we still scan with the bare `auto`
 * setting, so agents working on a fresh project still get useful
 * feedback once DESIGN.md has §7 entries.
 */
async function loadDesignGuardConfig(
  rootDir: string,
): Promise<GuardConfigForDesign | undefined> {
  for (const rel of ["mandu.config.ts", "mandu.config.js", "mandu.config.mjs"]) {
    const full = path.join(rootDir, rel);
    try {
      await fs.access(full);
    } catch {
      continue;
    }
    try {
      // Dynamic import — tolerate config files that don't load cleanly
      // in MCP context (rare).
      const mod = (await import(full)) as { default?: { guard?: { design?: GuardConfigForDesign } } };
      return mod.default?.guard?.design;
    } catch {
      return undefined;
    }
  }
  // No config file — return a permissive default so DESIGN.md §7
  // tokens still flow through.
  return { autoFromDesignMd: true };
}

// ─── mandu.design.get ─────────────────────────────────────────────────

interface DesignGetInput {
  /** Section to return. Use `"all"` to dump the full structured spec. */
  section?: DesignSectionId | "all";
  /** When true, include `rawBody` markdown alongside structured tokens. */
  include_raw?: boolean;
}

async function designGet(
  rootDir: string,
  input: DesignGetInput,
): Promise<unknown> {
  const file = await readDesignMd(rootDir);
  if (!file) {
    return {
      error: "DESIGN.md not found",
      hint: "Run `mandu design init` (optionally with `--from <slug>`) to create one.",
    };
  }
  const spec = parseDesignMd(file.source);
  if (!input.section || input.section === "all") {
    return projectSpec(spec, input.include_raw === true, file.path);
  }
  if (!DESIGN_SECTION_IDS.includes(input.section as DesignSectionId)) {
    return {
      error: `Unknown section "${input.section}"`,
      hint: `Use one of: ${DESIGN_SECTION_IDS.join(", ")}, or "all".`,
    };
  }
  const sec = spec.sections[input.section as DesignSectionId];
  return {
    path: file.path,
    section: input.section,
    present: sec.present,
    headingText: sec.headingText,
    ...projectSection(sec, input.include_raw === true),
  };
}

function projectSpec(spec: DesignSpec, includeRaw: boolean, srcPath: string): unknown {
  return {
    path: srcPath,
    title: spec.title,
    sections: Object.fromEntries(
      DESIGN_SECTION_IDS.map((id) => {
        const sec = spec.sections[id];
        return [
          id,
          {
            present: sec.present,
            headingText: sec.headingText,
            ...projectSection(sec, includeRaw),
          },
        ];
      }),
    ),
    extraSections: spec.extraSections.map((s) => ({ heading: s.heading })),
  };
}

function projectSection(sec: DesignSpec["sections"][DesignSectionId], includeRaw: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("tokens" in sec) out.tokens = sec.tokens;
  if ("rules" in sec) out.rules = sec.rules;
  if ("breakpoints" in sec) out.breakpoints = sec.breakpoints;
  if ("prompts" in sec) out.prompts = sec.prompts;
  if ("summary" in sec && (sec as { summary?: string }).summary) {
    out.summary = (sec as { summary?: string }).summary;
  }
  if (includeRaw) out.rawBody = sec.rawBody;
  return out;
}

// ─── mandu.design.prompt ─────────────────────────────────────────────

async function designPrompt(rootDir: string): Promise<unknown> {
  const file = await readDesignMd(rootDir);
  if (!file) {
    return {
      error: "DESIGN.md not found",
      hint: "Run `mandu design init` first; §9 Agent Prompts unlocks once DESIGN.md exists.",
    };
  }
  const spec = parseDesignMd(file.source);
  const section = spec.sections["agent-prompts"];
  if (!section.present || section.prompts.length === 0) {
    return {
      path: file.path,
      prompts: [],
      hint: "DESIGN.md has no §9 Agent Prompts. Add them so agents pre-warm with the same context every session.",
    };
  }
  return {
    path: file.path,
    prompts: section.prompts,
  };
}

// ─── mandu.design.check ──────────────────────────────────────────────

interface DesignCheckInput {
  /** File path (relative to project root, or absolute). */
  file?: string;
}

async function designCheck(
  rootDir: string,
  input: DesignCheckInput,
): Promise<unknown> {
  if (!input.file || typeof input.file !== "string") {
    return {
      error: "`file` is required",
      hint: 'Pass a relative or absolute path, e.g. "src/client/widgets/header.tsx".',
    };
  }
  const config = await loadDesignGuardConfig(rootDir);
  if (!config) {
    return {
      file: input.file,
      violations: [],
      note: "No `guard.design` config and no DESIGN.md §7 tokens — nothing to check.",
    };
  }
  const violations = await checkFileForDesignInlineClasses(rootDir, input.file, config);
  return {
    file: input.file,
    violations: violations.map((v) => ({
      line: v.line,
      severity: v.severity,
      rule: v.ruleId,
      message: v.message,
      suggestion: v.suggestion,
    })),
  };
}

// ─── mandu.component.list ────────────────────────────────────────────

const COMPONENT_DIRS = [
  { dir: "src/client/shared/ui", category: "ui-primitive" as const },
  { dir: "src/client/widgets", category: "widget" as const },
];

interface ComponentListInput {
  /** Filter by category. */
  category?: "ui-primitive" | "widget" | "all";
  /**
   * When true, include a count of usages across `src/**` / `app/**`.
   * Default false — usage counting walks the source tree and is the
   * slowest part of the response.
   */
  count_usage?: boolean;
}

interface ComponentEntry {
  name: string;
  category: "ui-primitive" | "widget";
  path: string;
  description?: string;
  props?: string[];
  usage_count?: number;
}

async function componentList(
  rootDir: string,
  input: ComponentListInput,
): Promise<unknown> {
  const filter = input.category ?? "all";
  const wantUsage = input.count_usage === true;
  const entries: ComponentEntry[] = [];

  for (const { dir, category } of COMPONENT_DIRS) {
    if (filter !== "all" && filter !== category) continue;
    const root = path.join(rootDir, dir);
    let files: string[] = [];
    try {
      files = await collectFiles(root);
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = path.relative(rootDir, file).replace(/\\/g, "/");
      let source: string;
      try {
        source = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      const components = extractExportedComponents(source);
      for (const c of components) {
        const entry: ComponentEntry = {
          name: c.name,
          category,
          path: rel,
        };
        if (c.description) entry.description = c.description;
        if (c.props.length > 0) entry.props = c.props;
        entries.push(entry);
      }
    }
  }

  if (wantUsage) {
    await populateUsageCounts(rootDir, entries);
  }

  return {
    count: entries.length,
    components: entries,
  };
}

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let names: __ManduNodeFsTypes0.Dirent[];
    try {
      names = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) {
        await walk(full);
      } else if (
        name.isFile() &&
        /\.(tsx?|jsx?)$/.test(name.name) &&
        !name.name.endsWith(".test.ts") &&
        !name.name.endsWith(".test.tsx")
      ) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

interface ExtractedComponent {
  name: string;
  description?: string;
  props: string[];
}

const EXPORT_FN_RX = /export\s+function\s+([A-Z]\w*)\s*\(/g;
const EXPORT_CONST_RX = /export\s+const\s+([A-Z]\w*)\s*[:=]/g;

function extractExportedComponents(source: string): ExtractedComponent[] {
  const out: ExtractedComponent[] = [];
  const seen = new Set<string>();
  // First-pass JSDoc extraction is best-effort — captures the line
  // immediately above the export when wrapped in `/** ... */`.
  const jsdocAbove = (offset: number): string | undefined => {
    const before = source.slice(0, offset);
    const m = /\/\*\*([\s\S]*?)\*\/\s*$/m.exec(before);
    if (!m) return undefined;
    const body = m[1]!.split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter(Boolean);
    return body[0];
  };
  for (const re of [EXPORT_FN_RX, EXPORT_CONST_RX]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const name = m[1]!;
      if (seen.has(name)) continue;
      seen.add(name);
      const description = jsdocAbove(m.index);
      out.push({
        name,
        description,
        props: extractPropsForComponent(source, name),
      });
    }
  }
  return out;
}

function extractPropsForComponent(source: string, name: string): string[] {
  // Look for the first `interface <Name>Props { ... }` or `type
  // <Name>Props = { ... }` declaration in the same file. Captures the
  // top-level identifier-style keys; gives up cleanly when the type is
  // unusual.
  const interfaceRe = new RegExp(
    `(?:interface|type)\\s+${name}Props[^\\{]*\\{([\\s\\S]*?)\\}`,
    "m",
  );
  const m = interfaceRe.exec(source);
  if (!m) return [];
  const body = m[1]!;
  const propRe = /^\s*([A-Za-z_$][\w$]*)\??\s*:/gm;
  const props: string[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = propRe.exec(body)) !== null) {
    props.push(pm[1]!);
  }
  return props;
}

async function populateUsageCounts(rootDir: string, entries: ComponentEntry[]): Promise<void> {
  const targets = ["src", "app"];
  const filesByDir: Map<string, string[]> = new Map();
  for (const t of targets) {
    try {
      filesByDir.set(t, await collectFiles(path.join(rootDir, t)));
    } catch {
      // skip
    }
  }
  for (const entry of entries) {
    let count = 0;
    const ident = new RegExp(`\\b${escapeRegex(entry.name)}\\b`);
    for (const files of filesByDir.values()) {
      for (const file of files) {
        try {
          const source = await fs.readFile(file, "utf8");
          if (ident.test(source)) count++;
        } catch {
          // skip
        }
      }
    }
    entry.usage_count = count;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── mandu.design.extract (write tool — read-only, returns proposals)

interface DesignExtractInput {
  scope?: string[];
  kinds?: ExtractKind[];
  min_occurrences?: number;
}

async function designExtract(rootDir: string, input: DesignExtractInput): Promise<unknown> {
  const file = await readDesignMd(rootDir);
  const existing = file ? parseDesignMd(file.source) : undefined;
  const result = await extractDesignTokens(rootDir, {
    scope: input.scope,
    kinds: input.kinds,
    minOccurrences: input.min_occurrences,
    existing,
  });
  return {
    scanned_files: result.scannedFiles,
    proposals: result.proposals.map((p) => ({
      kind: p.kind,
      section: p.section,
      key: p.key,
      value: p.value,
      occurrences: p.occurrences,
      files: p.files,
      confidence: p.confidence,
    })),
  };
}

// ─── mandu.design.patch ──────────────────────────────────────────────

interface DesignPatchInput {
  /** Single op shorthand. */
  section?: PatchableSection;
  operation?: PatchOperation["operation"];
  key?: string;
  value?: string;
  role?: string;
  /** Batch — overrides single-op fields when present. */
  ops?: PatchOperation[];
  /** Default true — return diff without writing. */
  dry_run?: boolean;
}

async function designPatch(rootDir: string, input: DesignPatchInput): Promise<unknown> {
  const file = await readDesignMd(rootDir);
  if (!file) {
    return {
      error: "DESIGN.md not found",
      hint: "Run `mandu design init` first.",
    };
  }
  const ops: PatchOperation[] = input.ops ?? (
    input.section && input.operation && input.key
      ? [{
          section: input.section,
          operation: input.operation,
          key: input.key,
          value: input.value,
          role: input.role,
        }]
      : []
  );
  if (ops.length === 0) {
    return {
      error: "No operations supplied",
      hint: "Pass either { section, operation, key, value? } or `ops: [...]`.",
    };
  }
  const batch = patchDesignMdBatch(file.source, ops);
  const dryRun = input.dry_run !== false;
  if (!dryRun && batch.appliedCount > 0) {
    await fs.writeFile(file.path, batch.next, "utf8");
  }
  return {
    path: file.path,
    dry_run: dryRun,
    applied_count: batch.appliedCount,
    written: !dryRun && batch.appliedCount > 0,
    results: batch.results.map((r, i) => ({
      op: ops[i],
      applied: r.applied,
      reason: r.reason,
      before: r.before,
      after: r.after,
    })),
    next_source: dryRun ? batch.next : undefined,
  };
}

// ─── mandu.design.propose (extract + dry-run patch in one call) ──────

interface DesignProposeInput {
  scope?: string[];
  kinds?: ExtractKind[];
  min_occurrences?: number;
  /** Default true — never writes; returns proposals + dry-run patches. */
  dry_run?: boolean;
}

async function designPropose(rootDir: string, input: DesignProposeInput): Promise<unknown> {
  const extractResult = await designExtract(rootDir, input) as {
    scanned_files: number;
    proposals: Array<{ section: PatchableSection; key: string; value: string; occurrences: number; confidence: number; files: string[]; kind: string }>;
  };
  if ("error" in extractResult) return extractResult;

  const file = await readDesignMd(rootDir);
  if (!file) {
    return {
      ...extractResult,
      error: "DESIGN.md not found — proposals cannot be patched in. Run `mandu design init` first.",
    };
  }

  // Convert top proposals (color/typography/layout/shadows only — not
  // components, which need richer human input) into add operations.
  const ops: PatchOperation[] = extractResult.proposals
    .filter((p) => p.section !== "components")
    .map((p) => ({
      section: p.section,
      operation: "add" as const,
      key: synthesiseKeyForProposal(p),
      value: p.value,
    }));
  const batch = patchDesignMdBatch(file.source, ops);
  const dryRun = input.dry_run !== false;
  if (!dryRun && batch.appliedCount > 0) {
    await fs.writeFile(file.path, batch.next, "utf8");
  }
  return {
    ...extractResult,
    path: file.path,
    dry_run: dryRun,
    applied_count: batch.appliedCount,
    written: !dryRun && batch.appliedCount > 0,
    patch_results: batch.results.map((r, i) => ({
      op: ops[i],
      applied: r.applied,
      reason: r.reason,
    })),
  };
}

function synthesiseKeyForProposal(p: { kind: string; key: string }): string {
  // Color literals like "#ff8c42" → "Orange-FF8C42" — give the user
  // something readable they can rename in the next patch round.
  if (p.kind === "color") {
    const stripped = p.key.replace(/^#/, "").toUpperCase();
    return `Color-${stripped}`;
  }
  if (p.kind === "typography") {
    const head = p.key.split(/[,\s]/)[0] ?? p.key;
    return head.replace(/[`'"]/g, "");
  }
  return p.key;
}

// ─── mandu.design.diff_upstream ──────────────────────────────────────

interface DesignDiffUpstreamInput {
  /** awesome-design-md slug or any raw URL. Required. */
  slug?: string;
}

async function designDiffUpstream(rootDir: string, input: DesignDiffUpstreamInput): Promise<unknown> {
  if (!input.slug) {
    return {
      error: "`slug` is required",
      hint: 'Pass an awesome-design-md slug (e.g. "stripe") or a raw URL.',
    };
  }
  const file = await readDesignMd(rootDir);
  if (!file) {
    return {
      error: "Local DESIGN.md not found",
      hint: "Run `mandu design init --from <slug>` first.",
    };
  }
  const local = parseDesignMd(file.source);
  let upstreamSource: string;
  try {
    upstreamSource = await fetchUpstreamDesignMd(input.slug);
  } catch (err) {
    return {
      error: `Failed to fetch upstream "${input.slug}": ${err instanceof Error ? err.message : String(err)}`,
      hint: "Check your network or the slug; see github.com/VoltAgent/awesome-design-md for valid slugs.",
    };
  }
  const upstream = parseDesignMd(upstreamSource);
  const diff = diffDesignSpecs(local, upstream);
  return {
    slug: input.slug,
    local_path: file.path,
    total_changes: diff.totalChanges,
    section_presence_changed: diff.sectionPresenceChanged,
    color_palette: diff.colorPalette,
    typography: diff.typography,
    layout: diff.layout,
    shadows: diff.shadows,
  };
}

// ─── MCP definitions + handlers ───────────────────────────────────────

export const designToolDefinitions: Tool[] = [
  {
    name: "mandu.design.get",
    description:
      "Read structured tokens from the project's DESIGN.md. Pass `section: 'color-palette'` (or `'typography'`/`'components'`/...) for one slice, or `'all'` (default) for the full parsed spec. `include_raw: true` returns the original markdown bodies alongside structured tokens.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: [...DESIGN_SECTION_IDS, "all"],
          description: "Section id to return; `all` dumps the full spec.",
        },
        include_raw: {
          type: "boolean",
          description:
            "Include raw markdown body alongside structured tokens. Default false.",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.design.prompt",
    description:
      "Return DESIGN.md §9 Agent Prompts — pre-warm payload an agent reads before starting UI work. Empty array + hint when the section is unpopulated.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu.design.check",
    description:
      "Run the DESIGN_INLINE_CLASS Guard rule on a single file before editing it. Returns a list of violations with line, message, and `requireComponent` suggestion. Reads `mandu.config.ts > guard.design` (or DESIGN.md §7 when `autoFromDesignMd: true`).",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "File to check. Relative paths resolve against the project root; absolute paths are accepted as-is.",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "mandu.component.list",
    description:
      "Inventory the project's components. Walks `src/client/shared/ui/` (ui-primitive) and `src/client/widgets/` (widget) for exported React components, with optional usage counts via `count_usage: true`.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["ui-primitive", "widget", "all"],
          description: "Filter by category. Defaults to `all`.",
        },
        count_usage: {
          type: "boolean",
          description:
            "When true, count usages across src/** and app/**. Slower; default false.",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.design.extract",
    description:
      "Scan src/** + app/** for token candidates (color literals, font-families, repeated className combos) and return proposals to patch into DESIGN.md. Read-only — does not modify any file. Filters out tokens already represented in DESIGN.md.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "array",
          items: { type: "string" },
          description: "Project-relative roots to scan. Default ['src', 'app'].",
        },
        kinds: {
          type: "array",
          items: { type: "string", enum: ["color", "typography", "spacing", "component"] },
          description: "Restrict the proposal kinds. Default: all four.",
        },
        min_occurrences: {
          type: "number",
          description: "Minimum occurrence threshold. Default 3.",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.design.patch",
    description:
      "Section-safe DESIGN.md patcher (add / update / remove a token). Defaults to dry-run — pass `dry_run: false` to actually rewrite the file. Pass either single-op fields (`section`, `operation`, `key`, `value?`, `role?`) or a batch via `ops: [...]`.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: ["color-palette", "typography", "layout", "shadows", "components"],
        },
        operation: { type: "string", enum: ["add", "update", "remove"] },
        key: { type: "string" },
        value: { type: "string" },
        role: { type: "string" },
        ops: {
          type: "array",
          description: "Batch — overrides single-op fields.",
        },
        dry_run: {
          type: "boolean",
          description: "When true (default), return the diff without writing.",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.design.propose",
    description:
      "Combined extract + dry-run patch. Runs `mandu.design.extract`, converts color / typography / layout / shadow proposals into add operations, and returns both the proposal list and the patch results. Always dry-run by default; pass `dry_run: false` to apply.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "array", items: { type: "string" } },
        kinds: {
          type: "array",
          items: { type: "string", enum: ["color", "typography", "spacing", "component"] },
        },
        min_occurrences: { type: "number" },
        dry_run: {
          type: "boolean",
          description: "Default true (preview only).",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.design.diff_upstream",
    description:
      "Compare the local DESIGN.md against an upstream brand spec from awesome-design-md. Returns per-section added / changed / removed entries plus a `total_changes` counter and `section_presence_changed` list. Read-only; produces a diff the caller can patch in selectively via `mandu.design.patch`.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "awesome-design-md slug (e.g. 'stripe') or a raw DESIGN.md URL.",
        },
      },
      required: ["slug"],
    },
  },
];

export function designTools(projectRoot: string) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.design.get": async (args) => designGet(projectRoot, args as DesignGetInput),
    "mandu.design.prompt": async () => designPrompt(projectRoot),
    "mandu.design.check": async (args) => designCheck(projectRoot, args as DesignCheckInput),
    "mandu.component.list": async (args) =>
      componentList(projectRoot, args as ComponentListInput),
    "mandu.design.extract": async (args) =>
      designExtract(projectRoot, args as DesignExtractInput),
    "mandu.design.patch": async (args) =>
      designPatch(projectRoot, args as DesignPatchInput),
    "mandu.design.propose": async (args) =>
      designPropose(projectRoot, args as DesignProposeInput),
    "mandu.design.diff_upstream": async (args) =>
      designDiffUpstream(projectRoot, args as DesignDiffUpstreamInput),
  };
  return handlers;
}
