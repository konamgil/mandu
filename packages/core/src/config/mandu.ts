import path from "path";
import fs from "fs/promises";

export type GuardRuleSeverity = "error" | "warn" | "off";

export interface ManduConfig {
  guard?: {
    rules?: Record<string, GuardRuleSeverity>;
    contractRequired?: GuardRuleSeverity;
  };
}

const CONFIG_FILES = [
  "mandu.config.ts",
  "mandu.config.js",
  "mandu.config.json",
  path.join(".mandu", "guard.json"),
];

function coerceConfig(raw: unknown, source: string): ManduConfig {
  if (!raw || typeof raw !== "object") return {};

  // .mandu/guard.json can be guard-only
  if (source.endsWith("guard.json") && !("guard" in (raw as Record<string, unknown>))) {
    return { guard: raw as ManduConfig["guard"] };
  }

  return raw as ManduConfig;
}

export async function loadManduConfig(rootDir: string): Promise<ManduConfig> {
  for (const fileName of CONFIG_FILES) {
    const filePath = path.join(rootDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      continue;
    }

    if (fileName.endsWith(".json")) {
      try {
        const content = await Bun.file(filePath).text();
        const parsed = JSON.parse(content);
        return coerceConfig(parsed, fileName);
      } catch {
        return {};
      }
    }

    try {
      const module = await import(filePath);
      const raw = module?.default ?? module;
      return coerceConfig(raw, fileName);
    } catch {
      return {};
    }
  }

  return {};
}
