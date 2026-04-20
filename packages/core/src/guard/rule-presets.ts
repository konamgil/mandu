/**
 * Phase 18.ν — Convenience presets for consumer-defined Guard rules.
 *
 * Wraps {@link defineGuardRule} with the three most common project-local
 * patterns observed in Mandu consumer projects:
 *
 *   1. `forbidImport()` — reject imports whose specifier matches a regex
 *      (or equals a literal string). Replaces the 90% case of
 *      `eslint-plugin-local` rules.
 *   2. `requireNamedExport()` — require specific named exports in files
 *      whose paths match a glob/regex. Useful for enforcing file-based
 *      routing conventions (`route.ts` must export a `handler`, etc.).
 *   3. `requirePrefixForExports()` — require exported functions to start
 *      with a given prefix (e.g. HTTP verb names for API route files).
 *
 * All helpers return a {@link GuardRule} so they can be pushed directly
 * into `mandu.config.ts` `guard.rules: [...]`.
 *
 * @module guard/rule-presets
 *
 * @example
 * ```ts
 * // mandu.config.ts
 * import {
 *   forbidImport,
 *   requireNamedExport,
 *   requirePrefixForExports,
 * } from "@mandujs/core/guard/define-rule";
 *
 * export default {
 *   guard: {
 *     rules: [
 *       forbidImport({ from: "axios", matches: /./ }),
 *       requireNamedExport({
 *         patterns: [/app\/api\/.*\/route\.ts$/],
 *         names: ["GET", "POST"],
 *         requireAny: true,
 *       }),
 *       requirePrefixForExports({
 *         patterns: [/app\/api\/.*\/route\.ts$/],
 *         prefix: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/,
 *       }),
 *     ],
 *   },
 * };
 * ```
 */

import {
  defineGuardRule,
  type GuardRule,
  type GuardRuleContext,
  type GuardRuleSeverity,
  type GuardViolation,
} from "./define-rule";

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Normalize a string | RegExp matcher into a `.test(value)`-capable object. */
function toRegex(matcher: string | RegExp): RegExp {
  if (matcher instanceof RegExp) return matcher;
  // Escape regex metacharacters for literal-string matches.
  const escaped = matcher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped);
}

/**
 * Returns true when `filePath` matches at least one of the supplied
 * patterns. Strings are treated as literal substrings; RegExps use
 * `.test()`. Forward slashes are used throughout (the Guard runner
 * already normalizes Windows backslashes upstream).
 */
function matchesAny(filePath: string, patterns: ReadonlyArray<string | RegExp>): boolean {
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      if (filePath.includes(pattern)) return true;
    } else if (pattern.test(filePath)) {
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// forbidImport
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for {@link forbidImport}.
 */
export interface ForbidImportOptions {
  /**
   * Package name / path that triggers the rule. Matched against
   * {@link ImportInfo.path} via `===` (literal) or `.test()` (regex).
   * Pass a regex like `/^(node:fs|fs|fs\/promises)$/` for a set match.
   */
  from: string | RegExp;
  /**
   * Only the imports whose import path also matches this regex are
   * flagged. Defaults to `/./` (all imports). Useful for cases where
   * you want to forbid a package except when imported for types only.
   */
  matches?: RegExp;
  /** Rule severity. Defaults to `"error"`. */
  severity?: GuardRuleSeverity;
  /** Override rule `id`. Defaults to `forbid-import:<normalized-from>`. */
  id?: string;
  /**
   * Override rule `description`. Defaults to a human-friendly sentence
   * describing the forbidden source.
   */
  description?: string;
  /**
   * Remediation hint surfaced alongside each violation. Defaults to a
   * generic "Use a project-approved alternative" string.
   */
  hint?: string;
  /** Optional docs URL surfaced with each violation. */
  docsUrl?: string;
  /**
   * Restrict the rule to files whose path matches one of these
   * patterns. When omitted, every scanned file is considered.
   */
  includePaths?: ReadonlyArray<string | RegExp>;
  /**
   * Exclude files whose path matches one of these patterns. Applied
   * after `includePaths`.
   */
  excludePaths?: ReadonlyArray<string | RegExp>;
}

function normalizeIdFragment(value: string | RegExp): string {
  const raw = value instanceof RegExp ? value.source : value;
  return raw.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "import";
}

/**
 * Create a rule that rejects every `import ... from "<from>"` whose
 * specifier matches `matches` (default: all). Works for static,
 * dynamic, and CommonJS `require()` imports.
 */
export function forbidImport(options: ForbidImportOptions): GuardRule {
  const fromMatcher = toRegex(options.from);
  const extraMatcher = options.matches ?? /./;
  const id = options.id ?? `forbid-import:${normalizeIdFragment(options.from)}`;
  const description =
    options.description ??
    `Imports from \`${options.from instanceof RegExp ? options.from.source : options.from}\` are forbidden.`;
  const hint = options.hint ?? "Use a project-approved alternative.";
  const severity = options.severity ?? "error";

  return defineGuardRule({
    id,
    severity,
    description,
    check(ctx: GuardRuleContext): GuardViolation[] {
      if (options.includePaths && !matchesAny(ctx.sourceFile, options.includePaths)) {
        return [];
      }
      if (options.excludePaths && matchesAny(ctx.sourceFile, options.excludePaths)) {
        return [];
      }

      const violations: GuardViolation[] = [];
      for (const imp of ctx.imports) {
        if (!fromMatcher.test(imp.path)) continue;
        if (!extraMatcher.test(imp.path)) continue;

        violations.push({
          file: ctx.sourceFile,
          line: imp.line,
          column: imp.column,
          message: `Forbidden import: \`${imp.path}\` (${description})`,
          hint,
          docsUrl: options.docsUrl,
        });
      }
      return violations;
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// requireNamedExport
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for {@link requireNamedExport}.
 */
export interface RequireNamedExportOptions {
  /**
   * Only files whose path matches one of these patterns are checked.
   * Strings are substring matches; regexes use `.test()`.
   */
  patterns: ReadonlyArray<string | RegExp>;
  /**
   * Export names that must be present. By default (`requireAny === false`)
   * *all* names in this array must be exported; pass `requireAny: true`
   * to require at least one.
   */
  names: readonly string[];
  /**
   * If `true`, a file passes when at least one of `names` is exported.
   * Defaults to `false` (all names required).
   */
  requireAny?: boolean;
  /** Rule severity. Defaults to `"error"`. */
  severity?: GuardRuleSeverity;
  /** Override rule `id`. Defaults to `require-named-export:<names.join("|")>`. */
  id?: string;
  /** Override rule `description`. */
  description?: string;
  /** Remediation hint. */
  hint?: string;
  /** Optional docs URL. */
  docsUrl?: string;
}

/**
 * Create a rule that requires specific named exports to exist in
 * matching files. Useful for enforcing file-based routing conventions
 * (e.g. `app/api/**\/route.ts` must export a `GET` or `POST` handler).
 */
export function requireNamedExport(options: RequireNamedExportOptions): GuardRule {
  if (!Array.isArray(options.names) || options.names.length === 0) {
    throw new TypeError("requireNamedExport: `names` must be a non-empty array of strings.");
  }
  if (!Array.isArray(options.patterns) || options.patterns.length === 0) {
    throw new TypeError("requireNamedExport: `patterns` must be a non-empty array.");
  }

  const id = options.id ?? `require-named-export:${options.names.join("|")}`;
  const description =
    options.description ??
    (options.requireAny
      ? `Files matching the pattern must export at least one of: ${options.names.join(", ")}.`
      : `Files matching the pattern must export all of: ${options.names.join(", ")}.`);
  const hint = options.hint ?? `Add the missing \`export\` declarations.`;
  const severity = options.severity ?? "error";

  return defineGuardRule({
    id,
    severity,
    description,
    check(ctx: GuardRuleContext): GuardViolation[] {
      if (!matchesAny(ctx.sourceFile, options.patterns)) return [];

      const exportedNames = new Set<string>();
      for (const exp of ctx.exports) {
        if (exp.type === "named" || exp.type === "default") {
          if (exp.name) exportedNames.add(exp.name);
        }
      }

      const missing = options.names.filter((n) => !exportedNames.has(n));

      if (options.requireAny) {
        if (missing.length === options.names.length) {
          return [
            {
              file: ctx.sourceFile,
              message: `Missing required export: expected at least one of [${options.names.join(", ")}], found none.`,
              hint,
              docsUrl: options.docsUrl,
            },
          ];
        }
        return [];
      }

      if (missing.length === 0) return [];
      return [
        {
          file: ctx.sourceFile,
          message: `Missing required exports: ${missing.join(", ")}.`,
          hint,
          docsUrl: options.docsUrl,
        },
      ];
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// requirePrefixForExports
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Options for {@link requirePrefixForExports}.
 */
export interface RequirePrefixForExportsOptions {
  /**
   * Only files whose path matches one of these patterns are checked.
   */
  patterns: ReadonlyArray<string | RegExp>;
  /**
   * Prefix that every named export must match. String is treated as a
   * literal prefix (`startsWith`); RegExp is `.test()`-ed against the
   * full export name.
   */
  prefix: string | RegExp;
  /**
   * Export names to exempt from the check (e.g. `"default"`, helper
   * types). Literal strings only — kept simple because this is the
   * common case.
   */
  allowList?: readonly string[];
  /**
   * When `true`, only check exports whose `type` is `"named"` (skip
   * `default`, `all`, and `type` re-exports). Defaults to `true`.
   */
  onlyNamed?: boolean;
  /** Rule severity. Defaults to `"error"`. */
  severity?: GuardRuleSeverity;
  /** Override rule `id`. Defaults to `require-prefix:<normalized-prefix>`. */
  id?: string;
  /** Override rule `description`. */
  description?: string;
  /** Remediation hint. */
  hint?: string;
  /** Optional docs URL. */
  docsUrl?: string;
}

/**
 * Create a rule that requires every named export in matching files to
 * match `prefix`. Classic use case: enforce that `app/api/**\/route.ts`
 * files only export HTTP verb names (`GET`, `POST`, ...).
 */
export function requirePrefixForExports(options: RequirePrefixForExportsOptions): GuardRule {
  if (!Array.isArray(options.patterns) || options.patterns.length === 0) {
    throw new TypeError("requirePrefixForExports: `patterns` must be a non-empty array.");
  }

  const prefixRegex =
    options.prefix instanceof RegExp
      ? options.prefix
      : new RegExp(`^${options.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const id = options.id ?? `require-prefix:${normalizeIdFragment(options.prefix)}`;
  const description =
    options.description ??
    `Named exports in matching files must start with \`${options.prefix instanceof RegExp ? options.prefix.source : options.prefix}\`.`;
  const hint =
    options.hint ??
    `Rename the export to match the required prefix, or move the helper to a different module.`;
  const severity = options.severity ?? "error";
  const allowSet = new Set(options.allowList ?? []);
  const onlyNamed = options.onlyNamed ?? true;

  return defineGuardRule({
    id,
    severity,
    description,
    check(ctx: GuardRuleContext): GuardViolation[] {
      if (!matchesAny(ctx.sourceFile, options.patterns)) return [];

      const violations: GuardViolation[] = [];
      for (const exp of ctx.exports) {
        if (onlyNamed && exp.type !== "named") continue;
        if (!exp.name) continue;
        if (allowSet.has(exp.name)) continue;
        if (prefixRegex.test(exp.name)) continue;

        violations.push({
          file: ctx.sourceFile,
          line: exp.line,
          message: `Export \`${exp.name}\` does not match the required prefix ${
            options.prefix instanceof RegExp ? options.prefix.source : `"${options.prefix}"`
          }.`,
          hint,
          docsUrl: options.docsUrl,
        });
      }
      return violations;
    },
  });
}
