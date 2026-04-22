/**
 * Issue #234 — Workflow-oriented MCP skill frontmatter & content sanity.
 *
 * Validates the `packages/skills/skills/<id>/SKILL.md` corpus — applies to
 * both the existing task-shaped skills (`mandu-create-feature`, etc.) and
 * the newer `mandu-mcp-*` workflow skills.
 *
 * Invariants:
 *   1. Every skill has YAML frontmatter with `name` + `description`.
 *      (The Claude Code skills spec treats both as required.)
 *   2. The frontmatter `name` matches the subdirectory name — otherwise the
 *      plugin loader mis-routes skill activations.
 *   3. No two skills share a `name`.
 *   4. Workflow skills (`mandu-mcp-*`) reference only **real** MCP tool
 *      names. The canonical / alias list is generated from
 *      `packages/mcp/src/tools/**` at review time and captured here;
 *      if a skill references a tool that is not in this set, the test
 *      fails loud (catches hallucinated tool names).
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { SKILL_IDS } from "../index.js";

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..", "..");
const SKILLS_DIR = path.join(PACKAGE_ROOT, "skills");

/**
 * Canonical MCP tool names exposed by `@mandujs/mcp` (both dotted canonical
 * and underscore aliases). Mirrored from:
 *   packages/mcp/src/tools/<category>.ts
 *   packages/mcp/src/tools/composite.ts
 *   packages/mcp/src/tools/ai-brief.ts
 *   packages/mcp/src/tools/deploy-preview.ts
 *   packages/mcp/src/tools/resource.ts
 *   packages/mcp/src/tools/ate.ts
 *
 * Keep this in sync when new tools land. The workflow skills are allowed to
 * reference any tool in this set; anything outside is treated as a
 * hallucinated name and the test fails.
 *
 * This is intentionally a snapshot, not a live introspection of the MCP
 * server, because (a) @mandujs/mcp must not become a test-time dep of
 * @mandujs/skills, and (b) a stale list is safer than a silent regression.
 */
const KNOWN_MCP_TOOLS = new Set<string>([
  // Aggregate orchestrators (Tier-0)
  "mandu.ai.brief",
  "mandu.ate.auto_pipeline",
  "mandu.deploy.check",
  "mandu.deploy.preview",
  "mandu.feature.create",
  "mandu.resource.create",
  "mandu.negotiate.scaffold",
  "mandu_generate_scaffold",

  // Brain
  "mandu.brain.doctor",
  "mandu.brain.architecture",
  "mandu.brain.checkImport",
  "mandu.brain.checkLocation",
  "mandu_doctor",
  "mandu_get_architecture",
  "mandu_check_import",
  "mandu_check_location",
  "mandu_watch_start",
  "mandu_watch_stop",
  "mandu_watch_status",

  // Guard
  "mandu.guard.check",
  "mandu.guard.analyze",
  "mandu.guard.heal",
  "mandu.guard.explain",
  "mandu_guard_check",
  "mandu_analyze_error",
  "mandu_guard_heal",
  "mandu_guard_explain",

  // Contract
  "mandu.contract.list",
  "mandu.contract.get",
  "mandu.contract.create",
  "mandu.contract.link",
  "mandu.contract.validate",
  "mandu.contract.sync",
  "mandu.contract.openapi",
  "mandu_list_contracts",
  "mandu_get_contract",
  "mandu_create_contract",
  "mandu_update_route_contract",
  "mandu_validate_contracts",
  "mandu_sync_contract_slot",
  "mandu_generate_openapi",

  // Generate
  "mandu.generate",
  "mandu.generate.status",
  "mandu_generate",
  "mandu_generate_status",

  // Spec / routes / manifest
  "mandu.route.list",
  "mandu.route.get",
  "mandu.route.add",
  "mandu.route.delete",
  "mandu.manifest.validate",
  "mandu_list_routes",
  "mandu_get_route",
  "mandu_add_route",
  "mandu_delete_route",
  "mandu_validate_manifest",

  // Hydration / build / islands
  "mandu.build",
  "mandu.build.status",
  "mandu.island.list",
  "mandu.hydration.set",
  "mandu.hydration.addClientSlot",
  "mandu_build",
  "mandu_build_status",
  "mandu_list_islands",
  "mandu_set_hydration",
  "mandu_add_client_slot",

  // History
  "mandu.history.snapshot",
  "mandu.history.list",
  "mandu.history.prune",
  "mandu_get_snapshot",
  "mandu_list_history",
  "mandu_prune_history",

  // Transaction
  "mandu.tx.begin",
  "mandu.tx.commit",
  "mandu.tx.rollback",
  "mandu.tx.status",
  "mandu_begin",
  "mandu_commit",
  "mandu_rollback",
  "mandu_tx_status",

  // Negotiate
  "mandu.negotiate",
  "mandu.negotiate.analyze",
  "mandu_negotiate",
  "mandu_analyze_structure",

  // Decisions
  "mandu.decision.list",
  "mandu.decision.save",
  "mandu.decision.check",
  "mandu.decision.architecture",
  "mandu_get_decisions",
  "mandu_save_decision",
  "mandu_check_consistency",

  // SEO
  "mandu.seo.preview",
  "mandu.seo.analyze",
  "mandu.seo.sitemap",
  "mandu.seo.robots",
  "mandu.seo.jsonld",
  "mandu.seo.write",
  "mandu_preview_seo",
  "mandu_seo_analyze",
  "mandu_generate_sitemap_preview",
  "mandu_generate_robots_preview",
  "mandu_create_jsonld",
  "mandu_write_seo_file",

  // Slot
  "mandu.slot.read",
  "mandu.slot.validate",
  "mandu.slot.constraints",
  "mandu_read_slot",
  "mandu_validate_slot",
  "mandu_get_slot_constraints",

  // Kitchen
  "mandu.kitchen.errors",
  "mandu_kitchen_errors",

  // ATE (granular — only used in drill-down)
  "mandu.ate.extract",
  "mandu.ate.generate",
  "mandu.ate.run",
  "mandu.ate.report",
  "mandu.ate.heal",
  "mandu.ate.impact",
  "mandu.ate.feedback",
  "mandu.ate.apply_heal",

  // Resource
  "mandu.resource.list",
  "mandu.resource.get",
  "mandu.resource.addField",
  "mandu.resource.removeField",

  // Project / dev server
  "mandu.project.init",
  "mandu.dev.start",
  "mandu.dev.stop",
  "mandu_init",
  "mandu_dev_start",
  "mandu_dev_stop",

  // Runtime
  "mandu.runtime.config",
  "mandu.runtime.setNormalize",
  "mandu.runtime.contractOptions",
  "mandu_get_runtime_config",
  "mandu_set_contract_normalize",
  "mandu_get_contract_options",

  // Component
  "mandu.component.add",
  "mandu_add_component",

  // Refactor (destructive — safe-change required)
  "mandu.refactor.rewriteGeneratedBarrel",
  "mandu.refactor.migrateRouteConventions",
  "mandu.refactor.extractContract",
]);

interface Frontmatter {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * Minimal YAML frontmatter parser — just enough for the two fields we
 * care about (`name`, `description`). The repo doesn't pull in js-yaml
 * as a test dep, and the SKILL.md frontmatter is hand-written in a
 * narrow subset.
 */
function parseFrontmatter(content: string): { fm: Frontmatter; raw: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { fm: {}, raw: "" };
  const raw = match[1];
  const fm: Frontmatter = {};
  // Walk line-by-line; support either inline scalar (`name: foo`) or
  // `description: |` block-literal form.
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) continue;
    const [, key, rest] = keyMatch;
    if (rest === "|" || rest === ">") {
      // Block scalar — collect indented subsequent lines.
      const buf: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        buf.push(lines[++i].replace(/^\s+/, ""));
      }
      fm[key] = buf.join("\n");
    } else {
      // Inline scalar — strip quotes if present.
      fm[key] = rest.replace(/^["']|["']$/g, "");
    }
  }
  return { fm, raw };
}

describe("SKILL.md corpus — frontmatter invariants (#234)", () => {
  const entries = readdirSync(SKILLS_DIR).filter((name) =>
    statSync(path.join(SKILLS_DIR, name)).isDirectory()
  );

  it("every subdirectory has a SKILL.md", () => {
    for (const id of entries) {
      const p = path.join(SKILLS_DIR, id, "SKILL.md");
      expect(statSync(p).isFile()).toBe(true);
    }
  });

  it("every skill has frontmatter with name + description", () => {
    for (const id of entries) {
      const content = readFileSync(
        path.join(SKILLS_DIR, id, "SKILL.md"),
        "utf-8"
      );
      const { fm } = parseFrontmatter(content);
      expect(fm.name, `${id} is missing frontmatter.name`).toBeDefined();
      expect(
        fm.description,
        `${id} is missing frontmatter.description`
      ).toBeDefined();
      expect(fm.description?.length ?? 0, `${id}.description is empty`).toBeGreaterThan(0);
    }
  });

  it("frontmatter name matches the subdirectory name", () => {
    for (const id of entries) {
      const content = readFileSync(
        path.join(SKILLS_DIR, id, "SKILL.md"),
        "utf-8"
      );
      const { fm } = parseFrontmatter(content);
      expect(fm.name).toBe(id);
    }
  });

  it("no duplicate skill names across the corpus", () => {
    const names = entries.map((id) => {
      const content = readFileSync(
        path.join(SKILLS_DIR, id, "SKILL.md"),
        "utf-8"
      );
      return parseFrontmatter(content).fm.name ?? id;
    });
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("SKILL_IDS lists every on-disk skill (both directions)", () => {
    const onDisk = new Set(entries);
    const registered = new Set<string>(SKILL_IDS);
    for (const id of registered) {
      expect(
        onDisk.has(id),
        `SKILL_IDS lists "${id}" but skills/${id}/SKILL.md does not exist`
      ).toBe(true);
    }
    for (const id of onDisk) {
      expect(
        registered.has(id),
        `skills/${id}/SKILL.md exists but is not in SKILL_IDS`
      ).toBe(true);
    }
  });
});

describe("SKILL.md corpus — workflow skills reference real MCP tools (#234)", () => {
  // Collect mandu_* and mandu.* identifiers from workflow-shaped skill
  // bodies. Task-shaped skills (`mandu-create-feature`, ...) can reference
  // tool names more loosely in prose; the strict check applies to the
  // orchestration skills which are the source of truth for tool names.
  const workflowSkills = readdirSync(SKILLS_DIR)
    .filter((name) =>
      statSync(path.join(SKILLS_DIR, name)).isDirectory()
    )
    .filter((name) => name.startsWith("mandu-mcp-"));

  it("each workflow skill mentions real MCP tools only", () => {
    // Matches `mandu.foo.bar` and `mandu_foo_bar` tokens; also picks up
    // family wildcards written as `mandu.refactor.*` / `mandu_deploy_*`
    // (the markdown prose form for "any tool in this prefix").
    // Allow `*` as a terminal char so family wildcards survive capture.
    const tokenRe = /(?<![a-zA-Z@])(mandu[._][a-zA-Z][a-zA-Z0-9._]*\*?)/g;

    // A token is a "family wildcard" if it ends in `.*` or `_*`. We accept
    // it when at least one known tool starts with the prefix — that's the
    // exact semantic the prose is conveying ("any of the mandu.refactor.*
    // tools require snapshot").
    const isKnownFamily = (tok: string): boolean => {
      if (!tok.endsWith("*")) return false;
      const prefix = tok.slice(0, -1); // "mandu.refactor." or "mandu_deploy_"
      for (const known of KNOWN_MCP_TOOLS) {
        if (known.startsWith(prefix)) return true;
      }
      return false;
    };

    for (const id of workflowSkills) {
      const content = readFileSync(
        path.join(SKILLS_DIR, id, "SKILL.md"),
        "utf-8"
      );

      const matches = new Set<string>();
      for (const m of content.matchAll(tokenRe)) {
        const tok = m[1];
        // Skip obvious non-tool tokens:
        //  - config paths like `mandu.config.ts`
        //  - `.mandu` dotfile paths
        if (tok.endsWith(".ts") || tok.endsWith(".tsx") || tok.endsWith(".js")) continue;
        if (tok === "mandu_config" || tok === "mandu.config") continue;
        // Trim trailing punctuation (e.g. captured `.` at end of sentence).
        const cleaned = tok.replace(/[.,;:)\]}]+$/g, "");
        if (cleaned.length === 0) continue;
        matches.add(cleaned);
      }

      const unknown = [...matches].filter(
        (tok) => !KNOWN_MCP_TOOLS.has(tok) && !isKnownFamily(tok)
      );
      expect(
        unknown,
        `${id} references tool(s) not in the known MCP tool set: ${unknown.join(", ")}`
      ).toEqual([]);
    }
  });

  it("every workflow skill points back to mandu-mcp-index", () => {
    // The index is the always-on router. If a workflow skill forgets to
    // link back, the tiered hierarchy breaks — agents land in a workflow
    // skill and can't find the anti-pattern catalog.
    for (const id of workflowSkills) {
      if (id === "mandu-mcp-index") continue;
      const content = readFileSync(
        path.join(SKILLS_DIR, id, "SKILL.md"),
        "utf-8"
      );
      expect(
        content.includes("mandu-mcp-index"),
        `${id} must reference mandu-mcp-index (see-also / router link)`
      ).toBe(true);
    }
  });

  it("the 6 workflow skills from #234 are present", () => {
    const required = [
      "mandu-mcp-index",
      "mandu-mcp-orient",
      "mandu-mcp-create-flow",
      "mandu-mcp-verify",
      "mandu-mcp-safe-change",
      "mandu-mcp-deploy",
    ];
    for (const id of required) {
      expect(workflowSkills).toContain(id);
    }
  });
});
