/**
 * Issue #197 — Claude Code skills layout regression suite.
 *
 * Context: the @mandujs/skills package shipped 4.0.0 writing flat
 * `.claude/skills/<id>.md` files. Claude Code's skills spec requires
 * `.claude/skills/<id>/SKILL.md` (one subdirectory per skill) and
 * silently ignores manifest files at the flat path. This test pins the
 * spec-compliant layout across all three install surfaces:
 *
 *   1. `installSkills()` — the public CLI / programmatic API
 *   2. `setupClaudeSkills()` — the dev-mode integration used by
 *      `mandu init` when running from source
 *   3. Each installed `SKILL.md` is byte-identical to the source under
 *      `packages/skills/generated/skills/<id>/SKILL.md` (no placeholder substitution
 *      at install time — skills ship as-is).
 *
 * The CLI's binary-mode installer (`installEmbeddedClaudeSkills` in
 * `packages/cli/src/commands/init.ts`) is covered by its own regression
 * test under `packages/cli/src/util/__tests__/skills-manifest.test.ts`.
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  statSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  installSkills,
  SKILL_IDS,
  getSkillPath,
} from "../index.js";
import { setupClaudeSkills } from "../init-integration.js";

// The source-of-truth skills directory inside the package.
const PACKAGE_ROOT = path.resolve(import.meta.dir, "..", "..");
const SKILLS_SRC_DIR = path.join(PACKAGE_ROOT, "generated", "skills");

describe("installSkills — Claude Code spec layout (#197)", () => {
  let target: string;

  beforeAll(() => {
    target = mkdtempSync(path.join(tmpdir(), "skills-install-layout-"));
  });

  afterAll(() => {
    rmSync(target, { recursive: true, force: true });
  });

  it("writes each skill to `<name>/SKILL.md`, never flat `<name>.md`", async () => {
    const result = await installSkills({
      targetDir: target,
      skipMcp: true,
      skipSettings: true,
    });

    // No errors from the happy path — every skill should be written.
    expect(result.errors).toEqual([]);
    expect(result.installed.length).toBe(SKILL_IDS.length);

    const skillsDir = path.join(target, ".claude", "skills");

    for (const id of SKILL_IDS) {
      // 1. Per-skill subdirectory exists and is a directory.
      const subdir = path.join(skillsDir, id);
      expect(existsSync(subdir)).toBe(true);
      expect(statSync(subdir).isDirectory()).toBe(true);

      // 2. SKILL.md exists inside the subdirectory.
      const skillMd = path.join(subdir, "SKILL.md");
      expect(existsSync(skillMd)).toBe(true);
      expect(statSync(skillMd).isFile()).toBe(true);

      // 3. Legacy flat file was NOT written (this is the #197 regression).
      const flatPath = path.join(skillsDir, `${id}.md`);
      expect(existsSync(flatPath)).toBe(false);

      // 4. Subdirectory contains exactly one entry: SKILL.md.
      //    If someone adds auxiliary files per skill in the future (the
      //    Claude Code spec explicitly allows this), relax this assertion
      //    to `.includes("SKILL.md")`.
      const entries = readdirSync(subdir);
      expect(entries).toEqual(["SKILL.md"]);
    }
  });

  it("installed SKILL.md is byte-identical to the package source", async () => {
    await installSkills({
      targetDir: target,
      skipMcp: true,
      skipSettings: true,
      force: true,
    });

    for (const id of SKILL_IDS) {
      const installed = readFileSync(
        path.join(target, ".claude", "skills", id, "SKILL.md"),
        "utf-8",
      );
      const source = readFileSync(getSkillPath(id), "utf-8");
      expect(installed).toBe(source);
    }
  });

  it("installed labels use `skills/<id>/SKILL.md` form", async () => {
    const fresh = mkdtempSync(path.join(tmpdir(), "skills-labels-"));
    try {
      const result = await installSkills({
        targetDir: fresh,
        skipMcp: true,
        skipSettings: true,
      });
      for (const entry of result.installed) {
        // `skills/<id>/SKILL.md` is the advertised shape — catch accidental
        // drift back to `skills/<id>.md` on the reporting side as well.
        expect(entry).toMatch(/^skills\/[^/]+\/SKILL\.md$/);
      }
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it("re-install skips existing skills without force (per-directory)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "skills-noforce-"));
    try {
      // First pass — everything written.
      const first = await installSkills({
        targetDir: dir,
        skipMcp: true,
        skipSettings: true,
      });
      expect(first.installed.length).toBe(SKILL_IDS.length);
      expect(first.skipped.length).toBe(0);

      // Second pass — all skipped (destination exists).
      const second = await installSkills({
        targetDir: dir,
        skipMcp: true,
        skipSettings: true,
      });
      expect(second.installed.length).toBe(0);
      expect(second.skipped.length).toBe(SKILL_IDS.length);
      for (const entry of second.skipped) {
        expect(entry).toContain("/SKILL.md (exists)");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-run reports `<id>/SKILL.md` paths and writes nothing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "skills-dry-"));
    try {
      const result = await installSkills({
        targetDir: dir,
        dryRun: true,
        skipMcp: true,
        skipSettings: true,
      });
      for (const entry of result.installed) {
        expect(entry).toMatch(/^skills\/[^/]+\/SKILL\.md \(dry-run\)$/);
      }
      // Nothing written on disk.
      expect(existsSync(path.join(dir, ".claude", "skills"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("setupClaudeSkills — `mandu init` dev-mode layout (#197)", () => {
  let target: string;

  beforeAll(() => {
    target = mkdtempSync(path.join(tmpdir(), "skills-init-layout-"));
  });

  afterAll(() => {
    rmSync(target, { recursive: true, force: true });
  });

  it("installs each skill into `.claude/skills/<id>/SKILL.md`", async () => {
    const result = await setupClaudeSkills(target);
    expect(result.errors).toEqual([]);
    expect(result.skillsInstalled).toBe(SKILL_IDS.length);
    expect(result.settingsCreated).toBe(true);

    const skillsDir = path.join(target, ".claude", "skills");
    for (const id of SKILL_IDS) {
      const skillMd = path.join(skillsDir, id, "SKILL.md");
      expect(existsSync(skillMd)).toBe(true);
      expect(statSync(skillMd).isFile()).toBe(true);

      // No flat-layout leftovers.
      expect(existsSync(path.join(skillsDir, `${id}.md`))).toBe(false);
    }

    // settings.json sits at `.claude/settings.json`, unchanged.
    expect(existsSync(path.join(target, ".claude", "settings.json"))).toBe(true);
  });

  it("payload matches the package source (no silent truncation)", async () => {
    const fresh = mkdtempSync(path.join(tmpdir(), "skills-init-payload-"));
    try {
      await setupClaudeSkills(fresh);
      for (const id of SKILL_IDS) {
        const installed = readFileSync(
          path.join(fresh, ".claude", "skills", id, "SKILL.md"),
          "utf-8",
        );
        const source = readFileSync(
          path.join(SKILLS_SRC_DIR, id, "SKILL.md"),
          "utf-8",
        );
        expect(installed).toBe(source);
      }
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe("package layout — source truth (#197)", () => {
  // Guard the generated package layout.
  // because the install logic assumes this exact shape. If a contributor
  // renames or flattens the source directory, we need a loud test failure
  // rather than a silent copy regression.
  it("every SKILL_ID has a source `<id>/SKILL.md` on disk", () => {
    for (const id of SKILL_IDS) {
      const skillMd = path.join(SKILLS_SRC_DIR, id, "SKILL.md");
      expect(existsSync(skillMd)).toBe(true);
      expect(statSync(skillMd).isFile()).toBe(true);
      // Sanity check — SKILL.md must have frontmatter or a leading heading
      // (matches the Claude Code skills spec and the embedded-payload
      // bounds test on the CLI side).
      const contents = readFileSync(skillMd, "utf-8");
      expect(contents).toMatch(/^(---|#)/);
    }
  });
});
