export type OutputFormat = "console" | "agent" | "json";

function normalizeFormat(value?: string): OutputFormat | undefined {
  if (!value) return undefined;
  if (value === "console" || value === "agent" || value === "json") {
    return value;
  }
  return undefined;
}

export function resolveOutputFormat(explicit?: OutputFormat): OutputFormat {
  const env = process.env;

  const direct = normalizeFormat(explicit) ?? normalizeFormat(env.MANDU_OUTPUT);
  if (direct) return direct;

  const agentSignals = [
    "MANDU_AGENT",
    "CODEX_AGENT",
    "CODEX",
    "CLAUDE_CODE",
    "ANTHROPIC_CLAUDE_CODE",
  ];

  for (const key of agentSignals) {
    const value = env[key];
    if (value === "1" || value === "true") {
      return "json";
    }
  }

  if (env.CI === "true") {
    return "json";
  }

  if (process.stdout && !process.stdout.isTTY) {
    return "json";
  }

  return "console";
}
