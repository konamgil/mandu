import { executeMcpTool } from "./mcp";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveExplainType(input?: string): string | null {
  if (!input) return null;
  return EXPLAIN_TYPE_ALIASES[input.trim().toLowerCase()] ?? null;
}

export async function explain(options: ExplainOptions = {}): Promise<boolean> {
  const type = resolveExplainType(options.codeOrType);

  if (!type || !options.fromLayer || !options.toLayer) {
    console.error("Usage: bunx mandu explain <type> --from <layer> --to <layer> [--preset mandu]");
    console.error("Example: bunx mandu explain layer-violation --from client --to server");
    return false;
  }

  const result = await executeMcpTool("mandu.guard.explain", {
    type,
    fromLayer: options.fromLayer,
    toLayer: options.toLayer,
    preset: options.preset,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return true;
  }

  if (!isRecord(result)) {
    console.log(JSON.stringify(result, null, 2));
    return true;
  }

  const rule = typeof result.rule === "string" ? result.rule : type;
  console.log(`📋 ${rule}`);

  const explanation = isRecord(result.explanation) ? result.explanation : null;
  const why = explanation && typeof explanation.why === "string" ? explanation.why : null;
  const how = explanation && typeof explanation.how === "string" ? explanation.how : null;
  const documentation = typeof result.documentation === "string" ? result.documentation : null;
  const examples = isRecord(result.examples) ? result.examples : null;
  const bad = examples && typeof examples.bad === "string" ? examples.bad : null;
  const good = examples && typeof examples.good === "string" ? examples.good : null;

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
