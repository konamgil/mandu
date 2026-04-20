/**
 * Phase 18.ν — Consumer-defined Guard rules.
 *
 * Ships `defineGuardRule()` + `GuardRule` / `GuardRuleContext` /
 * `GuardViolation` types so consumers can extend Mandu's architecture
 * guard without forking the framework. Rules declared via
 * `mandu.config.ts` `guard.rules` are merged into the standard Guard
 * report alongside Mandu's built-in presets (fsd/clean/hexagonal/atomic/
 * cqrs/mandu).
 *
 * @module guard/define-rule
 *
 * @example Project-local "no axios" rule.
 * ```ts
 * // mandu.config.ts
 * import { defineGuardRule } from "@mandujs/core/guard/define-rule";
 *
 * export default {
 *   guard: {
 *     rules: [
 *       defineGuardRule({
 *         id: "forbid-axios",
 *         severity: "error",
 *         description: "Use native fetch() instead of axios.",
 *         check: (ctx) => ctx.imports
 *           .filter((imp) => imp.path === "axios" || imp.path.startsWith("axios/"))
 *           .map((imp) => ({
 *             file: ctx.sourceFile,
 *             line: imp.line,
 *             message: `axios import at line ${imp.line} — use fetch().`,
 *             hint: "Replace with globalThis.fetch() or a thin wrapper.",
 *           })),
 *       }),
 *     ],
 *   },
 * };
 * ```
 */

import type { ExportInfo as AstExportInfo } from "./ast-analyzer";
import type { ImportInfo as AstImportInfo } from "./types";
import type { ManduConfig } from "../config/mandu";

/**
 * Severity emitted by a consumer-defined rule when it flags a file.
 *
 *   - `"error"`   — fails `mandu guard check` (non-zero exit code).
 *   - `"warning"` — surfaces in the report but keeps the exit code clean.
 *   - `"info"`    — purely informational; useful for migration-phase
 *                   rules that should not gate CI yet.
 *
 * The built-in `applyRuleSeverity()` downgrades `"info"` → `"warning"`
 * when emitted through the unified report so the rest of the pipeline
 * (reporter, CI formatter) does not have to special-case a third level.
 */
export type GuardRuleSeverity = "error" | "warning" | "info";

/**
 * Information about a single import statement in the file being
 * checked. Shape matches {@link AstImportInfo} from the Guard AST
 * analyzer so rules can consume the two interchangeably.
 */
export type ImportInfo = AstImportInfo;

/**
 * Information about a single export declaration in the file being
 * checked. Shape matches {@link AstExportInfo}.
 */
export type ExportInfo = AstExportInfo;

/**
 * Violation record emitted by a consumer-defined rule. The Guard
 * runner prefixes `ruleId` with `custom:<rule.id>` when merging into
 * the standard report, so the originating rule is always traceable in
 * CI output.
 */
export interface GuardViolation {
  /** Relative (preferred) or absolute file path where the violation occurs. */
  file: string;
  /** 1-indexed line number, if known. */
  line?: number;
  /** 1-indexed column number, if known. */
  column?: number;
  /** Human-readable message surfaced in the reporter. */
  message: string;
  /** Optional remediation hint. Shown alongside `message` in the CLI report. */
  hint?: string;
  /** Optional docs URL (rendered as a clickable link in supported terminals). */
  docsUrl?: string;
}

/**
 * Per-file execution context handed to a rule's `check()` function.
 * The runner parses imports/exports up front with the Guard AST
 * analyzer so every rule gets a pre-tokenized view without paying the
 * parse cost N times.
 */
export interface GuardRuleContext {
  /** Absolute path of the file being checked. */
  sourceFile: string;
  /** Raw file content (UTF-8). */
  content: string;
  /** Parsed import statements (AST-level, comments/strings stripped). */
  imports: ImportInfo[];
  /** Parsed export declarations (AST-level). */
  exports: ExportInfo[];
  /** Resolved Mandu config — useful for rules that branch on project settings. */
  config: ManduConfig;
  /** Project root (absolute). Useful for computing relative paths for `file`. */
  projectRoot: string;
}

/**
 * A consumer-defined Guard rule. Register an array of these under
 * `mandu.config.ts` `guard.rules`.
 *
 * Rules are executed once per source file scanned by
 * `checkInvalidGeneratedImport()`'s source-dir walker (packages/, src/,
 * app/). Each rule's `check()` may be synchronous or asynchronous —
 * the runner awaits both uniformly.
 *
 * @see {@link defineGuardRule}
 */
export interface GuardRule {
  /**
   * Stable rule identifier, e.g. `"company-no-axios"`. The runner
   * prefixes this with `custom:` when emitting violations, so the final
   * `ruleId` in the report is `custom:company-no-axios`.
   *
   * Must be unique within a config; duplicate ids trigger a
   * config-load-time warning via `validateCustomRules()`.
   */
  id: string;
  /** Default severity for violations emitted by this rule. */
  severity: GuardRuleSeverity;
  /** One-line description surfaced in the reporter and in `mandu guard explain`. */
  description: string;
  /**
   * Predicate that returns zero or more violations for the given file.
   * May be sync or async; the runner awaits uniformly with a
   * concurrency-limited `Promise.all`.
   *
   * Throwing inside `check()` is non-fatal — the runner catches the
   * error, emits a `custom:<id>` violation with the thrown message,
   * and continues scanning the rest of the files. This keeps one
   * malformed rule from tearing down the whole report.
   */
  check: (ctx: GuardRuleContext) => GuardViolation[] | Promise<GuardViolation[]>;
}

/**
 * Identity helper that returns the rule it was given. The only
 * behavior-bearing piece is the type guard — `defineGuardRule()`
 * validates the minimum shape (`id`, `severity`, `check`) at runtime
 * so typos in a plain-JS `mandu.config.js` surface immediately instead
 * of hiding inside the Guard runner.
 *
 * @throws `TypeError` when `rule` is missing a required field, or
 *         when `severity` is not one of `"error" | "warning" | "info"`.
 */
export function defineGuardRule(rule: GuardRule): GuardRule {
  if (!rule || typeof rule !== "object") {
    throw new TypeError("defineGuardRule: argument must be an object.");
  }
  if (typeof rule.id !== "string" || rule.id.length === 0) {
    throw new TypeError("defineGuardRule: `id` must be a non-empty string.");
  }
  if (rule.severity !== "error" && rule.severity !== "warning" && rule.severity !== "info") {
    throw new TypeError(
      `defineGuardRule: \`severity\` must be one of "error" | "warning" | "info" (got ${JSON.stringify(rule.severity)}).`
    );
  }
  if (typeof rule.check !== "function") {
    throw new TypeError("defineGuardRule: `check` must be a function (sync or async).");
  }
  if (typeof rule.description !== "string") {
    throw new TypeError("defineGuardRule: `description` must be a string.");
  }
  return rule;
}

/**
 * Structural check used by the Zod `z.custom<GuardRule>()` guard in
 * `config/validate.ts` and by `validateCustomRules()` at load time.
 * Kept deliberately loose — we only reject values that are obviously
 * not `GuardRule` objects; deeper validation (severity enum,
 * description type) happens in `defineGuardRule()` for the clearest
 * DX error, or in the runner (`check` throws) where the violation is
 * reported in-band.
 */
export function isGuardRuleLike(value: unknown): value is GuardRule {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== "string" || obj.id.length === 0) return false;
  if (typeof obj.check !== "function") return false;
  return true;
}

/**
 * Duplicate-id result returned by {@link validateCustomRules}.
 */
export interface DuplicateRuleId {
  id: string;
  /** Zero-indexed positions in the original array where the id appears. */
  indices: number[];
}

/**
 * Structural validation executed at config-load. Returns the list of
 * duplicate ids plus a list of entries that failed {@link isGuardRuleLike}.
 * The CLI prints a warning per duplicate; malformed rules are surfaced
 * via Zod's standard error path.
 */
export function validateCustomRules(rules: readonly unknown[]): {
  duplicates: DuplicateRuleId[];
  malformed: number[];
} {
  const duplicates: DuplicateRuleId[] = [];
  const malformed: number[] = [];
  const seen = new Map<string, number[]>();

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!isGuardRuleLike(rule)) {
      malformed.push(i);
      continue;
    }
    const existing = seen.get(rule.id);
    if (existing) {
      existing.push(i);
    } else {
      seen.set(rule.id, [i]);
    }
  }

  for (const [id, indices] of seen) {
    if (indices.length > 1) {
      duplicates.push({ id, indices });
    }
  }

  return { duplicates, malformed };
}
