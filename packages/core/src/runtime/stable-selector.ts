function fnv1a64Hex(input: string): string {
  // Browser-safe deterministic hash (FNV-1a 64-bit)
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function getBuildSaltFallback(): string {
  try {
    const salt = (typeof process !== "undefined" && process.env?.MANDU_BUILD_SALT) as string | undefined;
    return salt ?? "dev";
  } catch {
    return "dev";
  }
}

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
  const hex = fnv1a64Hex(payload);
  return `mnd_${hex}`;
}

export function inferSourceLocationFromStack(stack: string | undefined): { filePath: string; line: number; column: number } | null {
  if (!stack) return null;
  // naive parser: find first "(file:line:col)" or "at file:line:col" or "fn@file:line:col" frame
  const lines = stack.split("\n").map((l) => l.trim());
  for (const l of lines) {
    const m =
      l.match(/\((.*?):(\d+):(\d+)\)/) ??
      l.match(/\bat\s+(.*?):(\d+):(\d+)\b/) ??
      l.match(/@(.*?):(\d+):(\d+)/);
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
  const salt = buildSalt ?? getBuildSaltFallback();
  const loc = inferSourceLocationFromStack(new Error().stack);
  if (!loc) {
    return createStableManduId({ filePath: "unknown", line: 0, column: 0, symbolName, buildSalt: salt });
  }
  return createStableManduId({ ...loc, symbolName, buildSalt: salt });
}
