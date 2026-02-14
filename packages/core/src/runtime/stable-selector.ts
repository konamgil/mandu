import { createHash } from "node:crypto";

export interface StableManduIdInput {
  filePath: string;
  line: number;
  column: number;
  symbolName: string;
  buildSalt: string;
}

/**
 * Stable selector id generator
 * rule: hash(filePath + line + column + symbolName + buildSalt)
 */
export function createStableManduId(input: StableManduIdInput): string {
  const payload = `${input.filePath}:${input.line}:${input.column}:${input.symbolName}:${input.buildSalt}`;
  const hash = createHash("sha256").update(payload).digest("hex").slice(0, 16);
  return `mnd_${hash}`;
}

export function inferSourceLocationFromStack(stack: string | undefined): { filePath: string; line: number; column: number } | null {
  if (!stack) return null;
  // naive parser: find first "(file:line:col)" frame
  const lines = stack.split("\n").map((l) => l.trim());
  for (const l of lines) {
    const m = l.match(/\((.*?):(\d+):(\d+)\)/);
    if (!m) continue;
    const filePath = m[1];
    // skip internal/node/bun frames
    if (filePath.includes("node:") || filePath.includes("bun:") || filePath.includes("internal")) continue;
    return { filePath, line: Number(m[2]), column: Number(m[3]) };
  }
  return null;
}

/**
 * Best-effort auto injection for Mandu standard interaction components.
 * - NOTE: In the browser, stack traces may point to bundled files.
 * - This is a minimum skeleton; ATE can build selector-map and improve fallbacks.
 */
export function autoStableManduId(symbolName: string, buildSalt?: string): string {
  const salt = buildSalt ?? process.env.MANDU_BUILD_SALT ?? "dev";
  const loc = inferSourceLocationFromStack(new Error().stack);
  if (!loc) {
    return createStableManduId({ filePath: "unknown", line: 0, column: 0, symbolName, buildSalt: salt });
  }
  return createStableManduId({ ...loc, symbolName, buildSalt: salt });
}
