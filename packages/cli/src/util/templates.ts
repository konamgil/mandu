/**
 * Phase 9b B — Embedded template access.
 *
 * Public API for reading `packages/cli/templates/*` scaffolds at runtime.
 * The underlying storage is `packages/cli/generated/templates-manifest.js`
 * (plus a companion `.d.ts`), emitted by `scripts/generate-template-manifest.ts`
 * from inline base64 string literals. This avoids runtime filesystem access
 * and behaves identically in dev, tests, and compiled binaries.
 *
 * Call sites: `src/commands/init.ts` (copyEmbeddedTemplate, setupCiWorkflows).
 *
 * See also:
 *   docs/bun/phase-9-diagnostics/compile-binary.md §3.1 (blocker)
 *   docs/bun/phase-9-team-plan.md §2 (file-ownership map)
 */

// Runtime import of the auto-generated manifest.
//
// The physical module lives at `packages/cli/generated/templates-manifest.js`
// (plain JavaScript — `tsc` ignores `.js` files when `allowJs` is off, which
// it is here) with a companion `.d.ts` that supplies the type surface. The
// `.js` file contains inline string payloads, so template `.ts` / `.tsx`
// files never enter Bun's runtime module graph or TypeScript's compilation
// graph.
//
// We use the `.js` specifier explicitly so `bun` prefers the real runtime
// module over the `.d.ts` (which has no side effects).
import {
  TEMPLATE_MANIFEST,
  EMBEDDED_FILE_COUNT,
} from "../../generated/templates-manifest.js";
import { Buffer } from "node:buffer";
// Phase 11.A — Skills manifest (I-03 fix). Unlike the template manifest
// above, this one uses `with { type: "text" }` so the payloads are
// **strings** inlined at compile time. That makes every lookup
// synchronous and filesystem-free — exactly what the binary needs.
import {
  SKILLS_MANIFEST,
  EMBEDDED_SKILL_IDS,
  SKILLS_PAYLOAD_COUNT,
} from "../../generated/skills-manifest.js";

export interface EmbeddedTemplateFile {
  /** POSIX-normalized path relative to the template root. */
  readonly relPath: string;
  /** Raw scaffold bytes. */
  readonly bytes: Uint8Array;
}

function decodeTemplateBytes(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, "base64"));
}

/**
 * Normalize a user-provided relative path to the canonical POSIX form used
 * as keys in `TEMPLATE_MANIFEST`. Mirrors the POSIX-first normalization
 * used in the generator, so Windows callers (`path.join` with backslashes)
 * still resolve correctly.
 */
function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * List template names that ship with the CLI.
 *
 * The order is deterministic (generator-defined) and stable across builds —
 * tests rely on it.
 */
export function listTemplates(): readonly string[] {
  return Array.from(TEMPLATE_MANIFEST.keys());
}

/**
 * Return the set of files for a named template, or `null` if the template
 * is unknown. Entries are sorted by POSIX `relPath` so callers can rely on
 * a stable iteration order (needed for directory-first creation logic).
 */
export function loadTemplate(name: string): readonly EmbeddedTemplateFile[] | null {
  const inner = TEMPLATE_MANIFEST.get(name);
  if (!inner) return null;

  const out: EmbeddedTemplateFile[] = [];
  for (const [relPath, encoded] of inner) {
    out.push({ relPath, bytes: decodeTemplateBytes(encoded) });
  }
  // Map iteration order already matches generator output (sorted), but we
  // re-sort defensively so downstream copy loops are guaranteed deterministic
  // even if someone hand-edits the generated file.
  out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return out;
}

/**
 * Read the contents of a single template file as UTF-8 text. Returns `null`
 * when either the template or the relative path is unknown.
 */
export async function readTemplateFile(
  name: string,
  relPath: string
): Promise<string | null> {
  const bytes = resolveTemplateBytes(name, relPath);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

/**
 * Read the raw bytes of a single template file. Same null semantics as
 * `readTemplateFile`.
 */
export async function readTemplateFileBytes(
  name: string,
  relPath: string
): Promise<Uint8Array | null> {
  return resolveTemplateBytes(name, relPath);
}

/**
 * Resolve a (template, relPath) pair to its raw bytes, or `null` when
 * either lookup misses.
 */
export function resolveTemplateBytes(name: string, relPath: string): Uint8Array | null {
  const inner = TEMPLATE_MANIFEST.get(name);
  if (!inner) return null;
  const normalized = normalizeRelPath(relPath);
  const encoded = inner.get(normalized);
  return encoded === undefined ? null : decodeTemplateBytes(encoded);
}

/** Resolve a template payload as UTF-8 text. */
export function resolveTemplateContents(name: string, relPath: string): string | null {
  const bytes = resolveTemplateBytes(name, relPath);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

/** Total file count — useful for sanity checks in tests and CLI diagnostics. */
export function getEmbeddedFileCount(): number {
  return EMBEDDED_FILE_COUNT;
}

// ---------------------------------------------------------------------------
// Phase 11.A — Skills manifest (Phase 9 audit I-03).
// ---------------------------------------------------------------------------
//
// The CLI's `mandu init` drives Claude-Code-skills installation through
// `@mandujs/skills/init-integration::setupClaudeSkills`, which originally
// walked the filesystem (`copyFile(srcPath, destPath)`). In a compiled
// binary that logic tries to read `$bunfs/.../packages/skills/skills/<id>/SKILL.md`,
// which never exists because `@mandujs/skills` lives on the user's disk
// (or — in the binary case — is not embedded at all). Result: 9 silent
// warnings during `mandu.exe init`.
//
// The fix embeds the 9 SKILL.md payloads + the shared Claude
// `settings.json` via `with { type: "text" }` so they are inline strings
// in both dev and compiled modes. The API below is what the init step
// (and the skills package, for dev-mode parity) consume.

/**
 * Payload for one embedded skill or auxiliary asset.
 */
export interface EmbeddedSkillFile {
  /**
   * Stable key. For skill IDs, the key matches `@mandujs/skills`'s
   * `SKILL_IDS` entry (e.g. `"mandu-create-feature"`). Auxiliary files
   * carry a `"settings/<rel>"` prefix.
   */
  readonly key: string;
  /** Raw UTF-8 payload. Pass straight to `writeFile()` — no encoding dance. */
  readonly contents: string;
}

/**
 * List every skill payload currently embedded. Order is deterministic
 * (matches the generator output) so downstream progress reporting is
 * stable across runs. Auxiliary entries (e.g. `settings/.claude/settings.json`)
 * are included — filter by `key.startsWith("settings/")` if a caller only
 * wants `SKILL.md` entries.
 */
export function loadSkillFiles(): readonly EmbeddedSkillFile[] {
  const out: EmbeddedSkillFile[] = [];
  for (const [key, contents] of SKILLS_MANIFEST) {
    out.push({ key, contents });
  }
  return out;
}

/**
 * Lookup a single payload by key. Returns `null` for unknown keys — the
 * caller decides whether that's a hard error (missing skill asset) or a
 * soft one (stale key after a skill rename).
 */
export function resolveSkillPayload(key: string): string | null {
  return SKILLS_MANIFEST.get(key) ?? null;
}

/**
 * The ordered list of skill IDs the binary was built against. Used by
 * `setupClaudeSkills` to drive the copy loop + by the regression test
 * that guards against drift vs. the `@mandujs/skills` source export.
 */
export function getEmbeddedSkillIds(): readonly string[] {
  return EMBEDDED_SKILL_IDS;
}

/** Sanity check — 9 SKILL.md files + 1 auxiliary settings.json = 10. */
export function getEmbeddedSkillsCount(): number {
  return SKILLS_PAYLOAD_COUNT;
}
