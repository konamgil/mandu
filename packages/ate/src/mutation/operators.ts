/**
 * Phase C.2 — Contract-semantic mutation operators.
 *
 * Nine operators, each a pure function `(sourceFile, ctx) ⇒ MutatedSourceFile[]`.
 * Each operator returns a list because a single target file can yield many
 * independent mutations (one per required field, one per enum value, etc).
 *
 * Implementation approach:
 *   - We collect mutation *sites* first — positions + new text — by
 *     analyzing the AST without modifying it. Each site produces one
 *     mutated source string by splicing the replacement into a fresh
 *     copy of the original text. This avoids the stale-node problem
 *     that comes from mutating a live ts-morph SourceFile repeatedly.
 *
 * Spec: docs/ate/phase-c-spec.md §C.2.2.
 */
import type { SourceFile, SyntaxKind as SyntaxKindEnum, Node } from "ts-morph";

export interface MutationContext {
  targetFile: string;
  SyntaxKind: typeof SyntaxKindEnum;
}

export interface MutatedSourceFile {
  /** Stable id unique within the batch — `<operator>-<index>`. */
  id: string;
  operator: MutationOperatorName;
  description: string;
  /** Full source of the mutated file. */
  mutatedSource: string;
  line?: number;
}

export type MutationOperatorName =
  | "remove_required_field"
  | "narrow_type"
  | "widen_enum"
  | "flip_nullable"
  | "rename_field"
  | "swap_sibling_type"
  | "skip_middleware"
  | "early_return"
  | "bypass_validation";

export interface MutationOperator {
  name: MutationOperatorName;
  run: (sf: SourceFile, ctx: MutationContext) => MutatedSourceFile[];
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function findZCalls(sf: SourceFile, SK: typeof SyntaxKindEnum, fnName: string): Node[] {
  const out: Node[] = [];
  const calls = sf.getDescendantsOfKind(SK.CallExpression);
  for (const c of calls) {
    const expr = (c as unknown as { getExpression(): Node }).getExpression().getText();
    if (expr === `z.${fnName}`) out.push(c);
  }
  return out;
}

function isOptionalOrDefaultInit(initText: string): boolean {
  return /\.\s*(optional|default)\s*\(\s*[^)]*\)\s*$/.test(initText.trim());
}

// ────────────────────────────────────────────────────────────────────────────
// Shared helpers for z.object extraction
// ────────────────────────────────────────────────────────────────────────────

interface PropertySite {
  name: string;
  /** Full span of the entire property assignment (including trailing comma if any — we track separately). */
  propStart: number;
  propEnd: number;
  /** Span of the identifier node (just the name). */
  nameStart: number;
  nameEnd: number;
  /** Span of the initializer (z.string(), etc). */
  initStart: number;
  initEnd: number;
  initText: string;
  line: number;
}

function collectPropertySites(sf: SourceFile, SK: typeof SyntaxKindEnum): PropertySite[] {
  const out: PropertySite[] = [];
  const objectCalls = findZCalls(sf, SK, "object");
  for (const call of objectCalls) {
    const args = (call as unknown as { getArguments(): Node[] }).getArguments();
    if (args.length === 0) continue;
    const obj = args[0];
    if (obj.getKind() !== SK.ObjectLiteralExpression) continue;
    const directProps = (obj as unknown as { getProperties(): Node[] }).getProperties();
    for (const prop of directProps) {
      if (prop.getKind() !== SK.PropertyAssignment) continue;
      const p = prop as unknown as {
        getNameNode(): Node;
        getInitializer(): Node | undefined;
        getStart(): number;
        getEnd(): number;
        getStartLineNumber(): number;
      };
      const init = p.getInitializer();
      if (!init) continue;
      const nameNode = p.getNameNode();
      const nameText = nameNode.getText().replace(/^['"]|['"]$/g, "");
      out.push({
        name: nameText,
        propStart: p.getStart(),
        propEnd: p.getEnd(),
        nameStart: nameNode.getStart(),
        nameEnd: nameNode.getEnd(),
        initStart: init.getStart(),
        initEnd: init.getEnd(),
        initText: init.getText(),
        line: p.getStartLineNumber(),
      });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. remove_required_field
// ────────────────────────────────────────────────────────────────────────────

function expandToIncludeTrailingComma(source: string, endPos: number): number {
  // Slurp trailing comma + spaces so the mutated source remains valid.
  let i = endPos;
  while (i < source.length && source[i] === " ") i++;
  if (source[i] === ",") i++;
  return i;
}

const removeRequiredField: MutationOperator = {
  name: "remove_required_field",
  run(sf, ctx) {
    const original = sf.getFullText();
    const sites = collectPropertySites(sf, ctx.SyntaxKind);
    const out: MutatedSourceFile[] = [];
    let idx = 0;
    for (const s of sites) {
      if (isOptionalOrDefaultInit(s.initText)) continue;
      const end = expandToIncludeTrailingComma(original, s.propEnd);
      const mutated =
        original.slice(0, s.propStart) +
        original.slice(end);
      out.push({
        id: `remove_required_field-${idx++}`,
        operator: "remove_required_field",
        description: `removed required field '${s.name}' from z.object`,
        mutatedSource: mutated,
        line: s.line,
      });
    }
    return out;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 2. narrow_type — `z.string()` → `z.literal("__MUTATION_NARROWED__")`
// ────────────────────────────────────────────────────────────────────────────

const narrowType: MutationOperator = {
  name: "narrow_type",
  run(sf, ctx) {
    const SK = ctx.SyntaxKind;
    const original = sf.getFullText();
    const out: MutatedSourceFile[] = [];
    const stringCalls = findZCalls(sf, SK, "string");
    let idx = 0;
    for (const c of stringCalls) {
      const start = c.getStart();
      const end = c.getEnd();
      const line = (c as unknown as { getStartLineNumber(): number }).getStartLineNumber();
      const mutated =
        original.slice(0, start) +
        'z.literal("__MUTATION_NARROWED__")' +
        original.slice(end);
      out.push({
        id: `narrow_type-${idx++}`,
        operator: "narrow_type",
        description: 'narrowed z.string() to z.literal("__MUTATION_NARROWED__")',
        mutatedSource: mutated,
        line,
      });
    }
    return out;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 3. widen_enum — add a sentinel entry to every z.enum([...])
// ────────────────────────────────────────────────────────────────────────────

const widenEnum: MutationOperator = {
  name: "widen_enum",
  run(sf, ctx) {
    const SK = ctx.SyntaxKind;
    const original = sf.getFullText();
    const out: MutatedSourceFile[] = [];
    const enumCalls = findZCalls(sf, SK, "enum");
    let idx = 0;
    for (const c of enumCalls) {
      const args = (c as unknown as { getArguments(): Node[] }).getArguments();
      if (args.length === 0) continue;
      const arr = args[0];
      if (arr.getKind() !== SK.ArrayLiteralExpression) continue;
      const arrText = arr.getText();
      if (!arrText.trim().endsWith("]")) continue;
      const widened = arrText.replace(/]\s*$/, ', "__MUTATION_WIDENED__"]');
      const start = arr.getStart();
      const end = arr.getEnd();
      const line = (c as unknown as { getStartLineNumber(): number }).getStartLineNumber();
      const mutated = original.slice(0, start) + widened + original.slice(end);
      out.push({
        id: `widen_enum-${idx++}`,
        operator: "widen_enum",
        description: "widened z.enum with sentinel '__MUTATION_WIDENED__'",
        mutatedSource: mutated,
        line,
      });
    }
    return out;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 4. flip_nullable
// ────────────────────────────────────────────────────────────────────────────

const flipNullable: MutationOperator = {
  name: "flip_nullable",
  run(sf, ctx) {
    const original = sf.getFullText();
    const sites = collectPropertySites(sf, ctx.SyntaxKind);
    const out: MutatedSourceFile[] = [];
    let idx = 0;
    for (const s of sites) {
      if (/\.\s*nullable\s*\(\s*\)/.test(s.initText)) continue;
      const mutated =
        original.slice(0, s.initStart) +
        `(${s.initText}).nullable()` +
        original.slice(s.initEnd);
      out.push({
        id: `flip_nullable-${idx++}`,
        operator: "flip_nullable",
        description: `flipped '${s.name}' to .nullable()`,
        mutatedSource: mutated,
        line: s.line,
      });
    }
    return out;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 5. rename_field — camelCase → snake_case
// ────────────────────────────────────────────────────────────────────────────

function toSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

const renameField: MutationOperator = {
  name: "rename_field",
  run(sf, ctx) {
    const original = sf.getFullText();
    const sites = collectPropertySites(sf, ctx.SyntaxKind);
    const out: MutatedSourceFile[] = [];
    let idx = 0;
    for (const s of sites) {
      const snake = toSnake(s.name);
      if (snake === s.name) continue;
      const mutated =
        original.slice(0, s.nameStart) + snake + original.slice(s.nameEnd);
      out.push({
        id: `rename_field-${idx++}`,
        operator: "rename_field",
        description: `renamed '${s.name}' → '${snake}'`,
        mutatedSource: mutated,
        line: s.line,
      });
    }
    return out;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 6. swap_sibling_type
// ────────────────────────────────────────────────────────────────────────────

const swapSiblingType: MutationOperator = {
  name: "swap_sibling_type",
  run(sf, ctx) {
    const SK = ctx.SyntaxKind;
    const original = sf.getFullText();
    const out: MutatedSourceFile[] = [];
    let idx = 0;
    for (const fnName of ["number", "boolean"] as const) {
      const calls = findZCalls(sf, SK, fnName);
      for (const c of calls) {
        const start = c.getStart();
        const end = c.getEnd();
        const line = (c as unknown as { getStartLineNumber(): number }).getStartLineNumber();
        const mutated = original.slice(0, start) + "z.string()" + original.slice(end);
        out.push({
          id: `swap_sibling_type-${idx++}`,
          operator: "swap_sibling_type",
          description: `swapped z.${fnName}() → z.string()`,
          mutatedSource: mutated,
          line,
        });
      }
    }
    return out;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 7. skip_middleware
// ────────────────────────────────────────────────────────────────────────────

const skipMiddleware: MutationOperator = {
  name: "skip_middleware",
  run(sf, ctx) {
    const SK = ctx.SyntaxKind;
    const original = sf.getFullText();
    const out: MutatedSourceFile[] = [];
    const calls = sf.getDescendantsOfKind(SK.CallExpression);
    let idx = 0;
    for (const c of calls) {
      const expr = (c as unknown as { getExpression(): Node }).getExpression();
      if (expr.getKind() !== SK.PropertyAccessExpression) continue;
      const exprText = expr.getText();
      if (!exprText.endsWith(".use")) continue;
      const receiverNode = (expr as unknown as { getExpression(): Node }).getExpression();
      const receiverText = receiverNode.getText();
      const start = c.getStart();
      const end = c.getEnd();
      const line = (c as unknown as { getStartLineNumber(): number }).getStartLineNumber();
      const mutated = original.slice(0, start) + receiverText + original.slice(end);
      out.push({
        id: `skip_middleware-${idx++}`,
        operator: "skip_middleware",
        description: `removed '.use(...)' call — receiver retained`,
        mutatedSource: mutated,
        line,
      });
    }
    return out;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 8. early_return
// ────────────────────────────────────────────────────────────────────────────

const earlyReturn: MutationOperator = {
  name: "early_return",
  run(sf, ctx) {
    const SK = ctx.SyntaxKind;
    const original = sf.getFullText();
    const out: MutatedSourceFile[] = [];
    const arrows = sf.getDescendantsOfKind(SK.ArrowFunction);
    const funcs = sf.getDescendantsOfKind(SK.FunctionDeclaration);
    const funcExprs = sf.getDescendantsOfKind(SK.FunctionExpression);
    const methods = sf.getDescendantsOfKind(SK.MethodDeclaration);

    const candidates: Array<{ body: Node; line: number }> = [];
    for (const n of arrows) {
      const body = (n as unknown as { getBody(): Node | undefined }).getBody();
      if (!body || body.getKind() !== SK.Block) continue;
      candidates.push({ body, line: (n as unknown as { getStartLineNumber(): number }).getStartLineNumber() });
    }
    for (const n of funcs) {
      const body = (n as unknown as { getBody(): Node | undefined }).getBody();
      if (!body) continue;
      candidates.push({ body, line: (n as unknown as { getStartLineNumber(): number }).getStartLineNumber() });
    }
    for (const n of funcExprs) {
      const body = (n as unknown as { getBody(): Node | undefined }).getBody();
      if (!body) continue;
      candidates.push({ body, line: (n as unknown as { getStartLineNumber(): number }).getStartLineNumber() });
    }
    for (const n of methods) {
      const body = (n as unknown as { getBody(): Node | undefined }).getBody();
      if (!body) continue;
      candidates.push({ body, line: (n as unknown as { getStartLineNumber(): number }).getStartLineNumber() });
    }

    let idx = 0;
    for (const { body, line } of candidates) {
      const text = body.getText();
      // Heuristic: must have at least one return-response style statement.
      if (!/(Response\.|ctx\.ok|ctx\.json|\breturn\s)/.test(text)) continue;
      // Skip trivial pre-shortened bodies.
      if (/^{\s*return\s+Response\.json\(\s*\{\s*\}\s*\)\s*;?\s*}$/.test(text)) continue;
      const start = body.getStart();
      const end = body.getEnd();
      const mutated =
        original.slice(0, start) +
        "{ return Response.json({}); }" +
        original.slice(end);
      out.push({
        id: `early_return-${idx++}`,
        operator: "early_return",
        description: "injected 'return Response.json({})' at function start",
        mutatedSource: mutated,
        line,
      });
    }
    return out;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 9. bypass_validation
// ────────────────────────────────────────────────────────────────────────────

const bypassValidation: MutationOperator = {
  name: "bypass_validation",
  run(sf, ctx) {
    const SK = ctx.SyntaxKind;
    const original = sf.getFullText();
    const out: MutatedSourceFile[] = [];
    const calls = sf.getDescendantsOfKind(SK.CallExpression);
    let idx = 0;
    for (const c of calls) {
      const expr = (c as unknown as { getExpression(): Node }).getExpression();
      if (expr.getKind() !== SK.PropertyAccessExpression) continue;
      const exprText = expr.getText();
      if (!/\.parse$|\.safeParse$/.test(exprText)) continue;
      const args = (c as unknown as { getArguments(): Node[] }).getArguments();
      if (args.length === 0) continue;
      const firstArgText = args[0].getText();
      const start = c.getStart();
      const end = c.getEnd();
      const line = (c as unknown as { getStartLineNumber(): number }).getStartLineNumber();
      const mutated = original.slice(0, start) + firstArgText + original.slice(end);
      out.push({
        id: `bypass_validation-${idx++}`,
        operator: "bypass_validation",
        description: `bypassed ${exprText}(...) call`,
        mutatedSource: mutated,
        line,
      });
    }
    return out;
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────────────────────

export const ALL_OPERATORS: readonly MutationOperator[] = Object.freeze([
  removeRequiredField,
  narrowType,
  widenEnum,
  flipNullable,
  renameField,
  swapSiblingType,
  skipMiddleware,
  earlyReturn,
  bypassValidation,
]);

export const OPERATOR_NAMES: readonly MutationOperatorName[] = Object.freeze(
  ALL_OPERATORS.map((o) => o.name),
);

/**
 * Run all 9 operators on a single ts-morph `SourceFile`. Returns the
 * combined mutation set. Operators compute their edits against the
 * original source text without mutating the AST, so the input is safe
 * to reuse.
 */
export function runAllOperators(sf: SourceFile, ctx: MutationContext): MutatedSourceFile[] {
  const out: MutatedSourceFile[] = [];
  for (const op of ALL_OPERATORS) {
    try {
      out.push(...op.run(sf, ctx));
    } catch {
      // one operator failing should not kill the rest
    }
  }
  return out;
}
