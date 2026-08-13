import {
  explainRule,
  type GuardPreset,
  type ViolationType,
} from "@mandujs/core/guard";

const EXPLAIN_TYPE_ALIASES: Record<string, string> = {
  circular: "circular-dependency",
  "circular-dependency": "circular-dependency",
  "cross-slice": "cross-slice",
  deep: "deep-nesting",
  "deep-nesting": "deep-nesting",
  "guard-import-001": "layer-violation",
  "guard_import_001": "layer-violation",
  import: "layer-violation",
  "import-001": "layer-violation",
  import_001: "layer-violation",
  layer: "layer-violation",
  "layer-violation": "layer-violation",
};

export interface ExplainOptions {
  codeOrType?: string;
  fromLayer?: string;
  json?: boolean;
  preset?: string;
  toLayer?: string;
}

function resolveExplainType(input?: string): ViolationType | null {
  if (!input) return null;
  return (EXPLAIN_TYPE_ALIASES[input.trim().toLowerCase()] as ViolationType | undefined) ?? null;
}

export async function explain(options: ExplainOptions = {}): Promise<boolean> {
  const type = resolveExplainType(options.codeOrType);

  if (!type || !options.fromLayer || !options.toLayer) {
    console.error("Usage: bunx mandu explain <type> --from <layer> --to <layer> [--preset mandu]");
    console.error("Example: bunx mandu explain layer-violation --from client --to server");
    return false;
  }

  const explanation = explainRule(
    type,
    options.fromLayer,
    options.toLayer,
    (options.preset as GuardPreset | undefined) ?? "mandu",
  );
  const result = {
    rule: explanation.rule,
    explanation: { why: explanation.why, how: explanation.how },
    documentation: explanation.documentation,
    examples: explanation.examples,
    preset: options.preset ?? "mandu",
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return true;
  }

  const rule = result.rule;
  console.log(`📋 ${rule}`);

  const why = result.explanation.why;
  const how = result.explanation.how;
  const documentation = result.documentation;
  const bad = result.examples.bad;
  const good = result.examples.good;

  if (why) {
    console.log(`\nWhy:\n${why}`);
  }
  if (how) {
    console.log(`\nHow To Fix:\n${how}`);
  }
  if (bad) {
    console.log(`\nBad Example:\n${bad}`);
  }
  if (good) {
    console.log(`\nGood Example:\n${good}`);
  }
  if (documentation) {
    console.log(`\nDocs: ${documentation}`);
  }

  return true;
}
