import { getOutputMode } from "../terminal/output";

export type OutputFormat = "console" | "agent" | "json";

function normalizeFormat(value?: string): OutputFormat | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "console" || normalized === "agent" || normalized === "json") {
    return normalized;
  }
  return undefined;
}

export function resolveOutputFormat(explicit?: OutputFormat): OutputFormat {
  const env = process.env;

  const direct = normalizeFormat(explicit) ?? normalizeFormat(env.MANDU_OUTPUT);
  if (direct) return direct;

  const mode = getOutputMode();
  return mode === "json" ? "json" : "console";
}
