/**
 * Phase 11.A — Skills manifest regression tests (Phase 9 audit I-03 follow-up).
 *
 * Background: `mandu.exe init` previously emitted 9 silent ENOENT warnings
 * because `@mandujs/skills/init-integration::setupClaudeSkills` walked the
 * host filesystem to copy `skills/<id>/SKILL.md`. Inside a compiled
 * binary the skills package is unreachable (it isn't embedded) and
 * `$bunfs` is read-only, so every `copyFile()` silently resolved to
 * error and the user saw 9 fuzzy yellow warnings during `init`.
 *
 * This test suite pins the embedding contract end-to-end:
 *
 *   1. Manifest ships the expected 9 SKILL.md payloads + 1 settings.json =
 *      **10 payloads total**. Drift is caught on the count alone.
 *   2. `EMBEDDED_SKILL_IDS` exported by `generated/skills-manifest.js`
 *      matches `@mandujs/skills`'s runtime `SKILL_IDS` exactly — order
 *      included. Catches the scenario where the skills package grows a
 *      new skill and the CLI generator isn't rerun.
 *   3. Every embedded SKILL.md payload is **byte-identical** to the
 *      on-disk source. Protects against a stale generator run leaving
 *      old content inside the binary. Mirrors the `binary-landing.test.ts`
 *      approach for CLI-UX markdown.
 *   4. `resolveSkillPayload()` returns non-null for every known key and
 *      null for unknown keys (fail-closed semantics).
 *   5. Regression guard on `init.ts` — the old on-disk call path
 *      (`setupClaudeSkills(targetDir)`) must no longer be invoked from
 *      the `runSteps` pipeline. The new path (`installEmbeddedClaudeSkills`)
 *      must be present.
 *   6. `generate-template-manifest.ts` also emits the skills manifest (the
 *     integration contract between I-03 and the template generator).
 *   7. Sanity bounds on payload sizes — a zero-byte SKILL.md would be
 *     present-but-empty which the simpler counts would miss.
 *
 * Regression guard #8 — `setupClaudeSkills` (the on-disk copyFile API)
 * is no longer called from the CLI's init pipeline.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const CLI_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const REPO_ROOT = path.resolve(CLI_ROOT, "..", "..");
const SKILLS_PKG_ROOT = path.join(REPO_ROOT, "packages", "skills");

const EXPECTED_SKILL_IDS = [
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

describe("Phase 11.A skills-manifest embedding (I-03 fix)", () => {
  it("embeds exactly 10 payloads (9 SKILL.md + 1 settings.json)", async () => {
    const mod = (await import(
      path.join(CLI_ROOT, "generated", "skills-manifest.js")
    )) as {
      SKILLS_MANIFEST: ReadonlyMap<string, string>;
      EMBEDDED_SKILL_IDS: readonly string[];
      SKILLS_PAYLOAD_COUNT: number;
    };
    expect(mod.SKILLS_PAYLOAD_COUNT).toBe(10);
    expect(mod.SKILLS_MANIFEST.size).toBe(10);
    // 9 skill IDs + 1 settings key.
    expect([...mod.SKILLS_MANIFEST.keys()].sort()).toEqual(
      [...EXPECTED_SKILL_IDS, "settings/.claude/settings.json"].sort()
    );
  });

  it("EMBEDDED_SKILL_IDS matches @mandujs/skills SKILL_IDS exactly", async () => {
    const { EMBEDDED_SKILL_IDS } = (await import(
      path.join(CLI_ROOT, "generated", "skills-manifest.js")
    )) as { EMBEDDED_SKILL_IDS: readonly string[] };

    // Runtime import of the skills package — this test fails fast if the
    // package adds/removes an ID without rerunning the generator.
    const skillsPkg = (await import("@mandujs/skills")) as {
      SKILL_IDS: readonly string[];
    };

    expect([...EMBEDDED_SKILL_IDS]).toEqual([...skillsPkg.SKILL_IDS]);
    expect([...EMBEDDED_SKILL_IDS]).toEqual([...EXPECTED_SKILL_IDS]);
  });

  it("each SKILL.md payload is byte-identical to the on-disk source", async () => {
    const { SKILLS_MANIFEST } = (await import(
      path.join(CLI_ROOT, "generated", "skills-manifest.js")
    )) as { SKILLS_MANIFEST: ReadonlyMap<string, string> };

    for (const skillId of EXPECTED_SKILL_IDS) {
      const embedded = SKILLS_MANIFEST.get(skillId);
      expect(embedded).toBeTruthy();
      const sourcePath = path.join(
        SKILLS_PKG_ROOT,
        "skills",
        skillId,
        "SKILL.md"
      );
      const onDisk = readFileSync(sourcePath, "utf-8");
      expect(embedded).toBe(onDisk);
    }

    // settings.json payload parity too.
    const settingsEmbedded = SKILLS_MANIFEST.get(
      "settings/.claude/settings.json"
    );
    expect(settingsEmbedded).toBeTruthy();
    const settingsOnDisk = readFileSync(
      path.join(SKILLS_PKG_ROOT, "templates", ".claude", "settings.json"),
      "utf-8"
    );
    expect(settingsEmbedded).toBe(settingsOnDisk);
  });

  it("resolveSkillPayload() fails closed on unknown keys and succeeds on known ones", async () => {
    const { resolveSkillPayload, getEmbeddedSkillIds } = await import(
      path.join(CLI_ROOT, "src", "util", "templates.ts")
    );

    // Every advertised ID resolves.
    for (const id of getEmbeddedSkillIds()) {
      const payload = resolveSkillPayload(id);
      expect(payload).not.toBeNull();
      expect(typeof payload).toBe("string");
      expect((payload as string).length).toBeGreaterThan(0);
    }
    // settings key resolves.
    expect(resolveSkillPayload("settings/.claude/settings.json")).toBeTruthy();
    // Unknown keys return null (not throw, not empty string).
    expect(resolveSkillPayload("mandu-nonexistent-skill")).toBeNull();
    expect(resolveSkillPayload("")).toBeNull();
    expect(resolveSkillPayload("../etc/passwd")).toBeNull();
  });

  it("init.ts calls installEmbeddedClaudeSkills instead of setupClaudeSkills", () => {
    // Normalize CRLF → LF before assertions so the test is platform-agnostic.
    const src = readFileSync(
      path.join(CLI_ROOT, "src", "commands", "init.ts"),
      "utf-8"
    ).replace(/\r\n/g, "\n");
    // New binary-safe path must exist.
    expect(src).toContain("installEmbeddedClaudeSkills");
    expect(src).toContain(
      'import {\n' +
      '  loadTemplate as loadEmbeddedTemplate,\n' +
      '  resolveEmbeddedPath,\n' +
      '  getEmbeddedSkillIds,\n' +
      '  resolveSkillPayload,\n' +
      '} from "../util/templates";'
    );
    // The `runSteps` pipeline must NOT reach for the legacy
    // `setupClaudeSkills(targetDir)` filesystem call path.
    // `setupClaudeSkills` can still be *imported* (as a renamed symbol
    // or for dev-mode fallback), but the live pipeline call has been
    // swapped to the manifest-based installer.
    expect(src).not.toMatch(/=\s*await\s+setupClaudeSkills\s*\(/);
  });

  it("generator emits skills-manifest.js with the expected 3-manifest set", () => {
    // This guards the integration contract between the CLI and the
    // existing template manifest pipeline. If someone deletes or renames
    // the generator's skills section, this assertion catches it before
    // anyone regenerates templates.
    const generatorSrc = readFileSync(
      path.join(CLI_ROOT, "scripts", "generate-template-manifest.ts"),
      "utf-8"
    );
    expect(generatorSrc).toContain("OUTPUT_SKILLS_JS");
    expect(generatorSrc).toContain("OUTPUT_SKILLS_DTS");
    expect(generatorSrc).toContain("collectSkillsFiles");
    expect(generatorSrc).toContain("generateSkillsSources");
    expect(generatorSrc).toContain("SKILLS_MANIFEST");
  });

  it("every embedded payload has plausible size bounds (not empty, not enormous)", async () => {
    const { SKILLS_MANIFEST } = (await import(
      path.join(CLI_ROOT, "generated", "skills-manifest.js")
    )) as { SKILLS_MANIFEST: ReadonlyMap<string, string> };

    for (const [key, payload] of SKILLS_MANIFEST) {
      // SKILL.md files realistically run 500 B - 20 KB each; settings.json
      // is ~1 KB. 100 bytes floor catches "was accidentally truncated to
      // whitespace", 200 KB ceiling catches "someone pasted in the world".
      expect(payload.length).toBeGreaterThan(100);
      expect(payload.length).toBeLessThan(200 * 1024);
      // Every payload must start with a non-null, printable character.
      expect(payload.charCodeAt(0)).toBeGreaterThan(0);
      // Markdown skill files must contain a front-matter block or heading.
      if (!key.startsWith("settings/")) {
        expect(payload).toMatch(/^(---|#)/);
      }
    }
  });

  it("regression: setupClaudeSkills (on-disk copyFile path) is not wired into runSteps", () => {
    // This is a stronger assertion than the pattern check above — it
    // ensures even accidental refactors can't silently reintroduce the
    // I-03 bug. The import itself is allowed (we alias it as
    // `_setupClaudeSkillsFsCopy` for library consumers), but calling it
    // from the init pipeline is not.
    const raw = readFileSync(
      path.join(CLI_ROOT, "src", "commands", "init.ts"),
      "utf-8"
    ).replace(/\r\n/g, "\n");
    // Allowed: import statement with alias — check before comment strip.
    expect(raw).toMatch(/setupClaudeSkills as _setupClaudeSkillsFsCopy/);

    // Strip // line comments + /* block comments */ before the call scan,
    // so documentary references (e.g. "was `setupClaudeSkills(targetDir)`")
    // don't count as live call sites.
    const codeOnly = raw
      // Remove /* … */ block comments (non-greedy, multi-line).
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // Remove // … line comments. This is naïve w.r.t. strings that
      // contain "//" but init.ts has none on live code lines, and a false
      // positive here would only make the regression more strict (good).
      .replace(/\/\/[^\n]*/g, "");
    // Disallowed: a bare `setupClaudeSkills(` call anywhere in live code.
    const unaliasedCallPattern = /[^_a-zA-Z]setupClaudeSkills\s*\(/g;
    const occurrences = codeOnly.match(unaliasedCallPattern) ?? [];
    expect(occurrences).toEqual([]);
  });
});
