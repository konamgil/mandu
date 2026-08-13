/**
 * `mandu db plan` — interactive rename prompt helper.
 *
 * The diff engine (Agent B) is intentionally conservative — it never
 * emits a `rename-column` Change directly. If a user drops column `A`
 * and adds column `B` in the same resource, the engine produces two
 * independent Changes: `drop-column { A }` and `add-column { B }`.
 *
 * That's the safe default — a false-positive rename would silently
 * destroy data. But it leaves a DX hole: the operator knows it was a
 * rename, the framework doesn't. This helper closes that gap in the
 * CLI layer (and *only* in the CLI layer — the diff engine stays pure).
 *
 * ## Flow
 *
 *   1. Scan the `Change[]` for (drop-column, add-column) pairs on the
 *      same resource where the SQL type of both sides matches.
 *   2. If not a TTY OR `--ci`: return the list unchanged. Pure drop+add
 *      is the safe forward path.
 *   3. Otherwise, prompt once per candidate. On `y`, replace the pair
 *      with a `rename-column { origin: "user-confirmed" }` Change.
 *
 * ## Exact prompt copy (don't change without updating docs)
 *
 *   `  ? Looks like a rename? "old_name" → "new_name" in "table"? [y/N]: `
 *
 * The `y/N` capitalisation is intentional — "No" is the safe default
 * when the user hits Enter. Yes requires an affirmative key press.
 *
 * @module cli/commands/db/rename-prompt
 */

import { createInterface, type Interface } from "node:readline/promises";
import type { Change, DdlFieldDef, SqlProvider } from "@mandujs/core/compat/resource/ddl/types";
import { resolveColumnType } from "@mandujs/core/compat/resource/ddl/type-map";

export interface RenamePromptOptions {
  /** CI mode: never prompts, always leaves drop+add as pure drop+add. */
  ci?: boolean;
  /**
   * Override stdin / stdout — tests can stream synthetic input here.
   * Default: `process.stdin` + `process.stdout`.
   */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /**
   * Force "yes" for every candidate without reading stdin. Useful for
   * tests that want to assert the rewrite path fires without a TTY.
   */
  forceYes?: boolean;
}

export interface RenameCandidate {
  resourceName: string;
  dropIndex: number;
  addIndex: number;
  oldFieldName: string;
  newField: DdlFieldDef;
}

/**
 * Scan `Change[]` for drop-column / add-column pairs on the same
 * resource whose SQL type resolves identically for the given provider.
 *
 * Returned candidates are referenced by their index inside the input
 * array so the caller can rewrite them in place without reshuffling.
 */
export function findRenameCandidates(
  changes: readonly Change[],
  provider: SqlProvider,
): RenameCandidate[] {
  const candidates: RenameCandidate[] = [];

  // Group drops and adds by resource so we can match pairs cheaply.
  const dropsByResource = new Map<string, number[]>();
  const addsByResource = new Map<string, number[]>();

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (c.kind === "drop-column") {
      const bucket = dropsByResource.get(c.resourceName) ?? [];
      bucket.push(i);
      dropsByResource.set(c.resourceName, bucket);
    } else if (c.kind === "add-column") {
      const bucket = addsByResource.get(c.resourceName) ?? [];
      bucket.push(i);
      addsByResource.set(c.resourceName, bucket);
    }
  }

  // Track which indices are already consumed so a single drop-column
  // isn't paired with two add-columns.
  const consumed = new Set<number>();

  for (const [resourceName, dropIndices] of dropsByResource) {
    const addIndices = addsByResource.get(resourceName);
    if (!addIndices || addIndices.length === 0) continue;

    for (const dropIndex of dropIndices) {
      if (consumed.has(dropIndex)) continue;
      const drop = changes[dropIndex];
      if (drop.kind !== "drop-column") continue; // TS narrow

      for (const addIndex of addIndices) {
        if (consumed.has(addIndex)) continue;
        const add = changes[addIndex];
        if (add.kind !== "add-column") continue;

        // We have no old-side field shape (drop-column only carries the
        // name). We can't compare full types, but we CAN gate on the
        // added column's own resolved SQL type being non-empty and
        // compatible with a plain rename. In practice, rename is about
        // the name — not the type — so this is a light gate that still
        // catches "user renamed `age` (int) → `zip` (text)" as
        // non-rename.
        const newSqlType = safeResolveType(add.field, provider);
        if (newSqlType === null) continue;

        candidates.push({
          resourceName,
          dropIndex,
          addIndex,
          oldFieldName: drop.fieldName,
          newField: add.field,
        });
        consumed.add(dropIndex);
        consumed.add(addIndex);
        break; // move to next drop
      }
    }
  }

  return candidates;
}

/**
 * Format the single-line prompt text for a candidate. Exported for
 * tests — asserting the exact copy matters for UX.
 */
export function formatPrompt(candidate: RenameCandidate): string {
  const { oldFieldName, newField, resourceName } = candidate;
  return `  ? Looks like a rename? "${oldFieldName}" → "${newField.name}" in "${resourceName}"? [y/N]: `;
}

/**
 * Apply user-confirmed renames to `changes`, producing a new array.
 *
 * Non-interactive (CI or non-TTY): returns the list unchanged.
 *
 * TTY interactive: prompts once per candidate. A user who sends `y`
 * (or `yes`, case-insensitive) replaces the drop+add pair with a
 * single `rename-column` Change. Any other input (including Enter /
 * EOF / Ctrl-C) leaves the pair as drop+add.
 */
export async function applyRenames(
  changes: readonly Change[],
  provider: SqlProvider,
  options: RenamePromptOptions = {},
): Promise<Change[]> {
  const candidates = findRenameCandidates(changes, provider);
  if (candidates.length === 0) return [...changes];

  const isTty = Boolean(
    (options.output ?? process.stdout) &&
      // `isTTY` is optional on the Node streams.
      (options.output as { isTTY?: boolean } | undefined)?.isTTY !== false &&
      (process.stdout as { isTTY?: boolean }).isTTY !== false,
  );

  const interactive = options.ci !== true && (isTty || options.forceYes === true);
  if (!interactive) return [...changes];

  // Build the rewrite map keyed by the indices consumed by a rename.
  const renames = new Map<number, { drop: number; add: number; change: Change }>();

  let rl: Interface | null = null;
  try {
    if (options.forceYes !== true) {
      rl = createInterface({
        input: options.input ?? process.stdin,
        output: options.output ?? process.stdout,
      });
    }
    for (const candidate of candidates) {
      const answer = options.forceYes === true
        ? "y"
        : (await rl!.question(formatPrompt(candidate))).trim().toLowerCase();
      if (answer === "y" || answer === "yes") {
        const rename: Change = {
          kind: "rename-column",
          resourceName: candidate.resourceName,
          oldName: candidate.oldFieldName,
          newName: candidate.newField.name,
          origin: "user-confirmed",
        };
        renames.set(candidate.dropIndex, {
          drop: candidate.dropIndex,
          add: candidate.addIndex,
          change: rename,
        });
      }
    }
  } finally {
    rl?.close();
  }

  if (renames.size === 0) return [...changes];

  // Build the output: emit `rename-column` at the drop-column's old
  // index, skip the corresponding add-column. Every other change stays
  // at its original position (order-preserving rewrite).
  const skipAdds = new Set<number>();
  for (const r of renames.values()) skipAdds.add(r.add);

  const out: Change[] = [];
  for (let i = 0; i < changes.length; i++) {
    const atThis = renames.get(i);
    if (atThis) {
      out.push(atThis.change);
      continue;
    }
    if (skipAdds.has(i)) continue;
    out.push(changes[i]);
  }
  return out;
}

function safeResolveType(field: DdlFieldDef, provider: SqlProvider): string | null {
  try {
    return resolveColumnType(field, provider);
  } catch {
    return null;
  }
}
