import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import { getAtePaths, ensureDir, writeJson } from "./fs";

export interface SelectorFallback {
  kind: string;
  selector: string;
}

export interface SelectorMapEntry {
  manduId: string;
  fallback: SelectorFallback[];
}

export interface SelectorMapJson {
  version: 1;
  buildSalt: string;
  generatedAt: string;
  entries: SelectorMapEntry[];
}

function uniqFallback(fallback: SelectorFallback[]): SelectorFallback[] {
  const seen = new Set<string>();
  const out: SelectorFallback[] = [];
  for (const f of fallback) {
    const k = `${f.kind}::${f.selector}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

export function mergeSelectorMaps(base: SelectorMapJson, incoming: SelectorMapJson | { buildSalt?: string; entries: SelectorMapEntry[] }): SelectorMapJson {
  const byId = new Map<string, SelectorMapEntry>();

  for (const e of base.entries) {
    byId.set(e.manduId, { manduId: e.manduId, fallback: uniqFallback(e.fallback ?? []) });
  }

  for (const e of incoming.entries) {
    if (!e?.manduId) continue;
    const prev = byId.get(e.manduId);
    if (!prev) {
      byId.set(e.manduId, { manduId: e.manduId, fallback: uniqFallback(e.fallback ?? []) });
    } else {
      byId.set(e.manduId, {
        manduId: e.manduId,
        fallback: uniqFallback([...(prev.fallback ?? []), ...(e.fallback ?? [])]),
      });
    }
  }

  return {
    version: 1,
    buildSalt: (incoming as any).buildSalt ?? base.buildSalt,
    generatedAt: new Date().toISOString(),
    entries: Array.from(byId.values()).sort((a, b) => a.manduId.localeCompare(b.manduId)),
  };
}

export function readSelectorMapOrEmpty(repoRoot: string, buildSalt: string): SelectorMapJson {
  const paths = getAtePaths(repoRoot);
  if (!existsSync(paths.selectorMapPath)) {
    return { version: 1, buildSalt, generatedAt: new Date().toISOString(), entries: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(paths.selectorMapPath, "utf8")) as SelectorMapJson;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return { version: 1, buildSalt, generatedAt: new Date().toISOString(), entries: [] };
}

/**
 * Merge selector-map fragments (written during Playwright run) into .mandu/selector-map.json
 */
export async function updateSelectorMapFromFragments(params: { repoRoot: string; fragmentsDir: string; buildSalt: string }): Promise<{ ok: true; selectorMapPath: string; mergedEntries: number; fragmentFiles: number }> {
  const paths = getAtePaths(params.repoRoot);
  ensureDir(paths.manduDir);

  const base = readSelectorMapOrEmpty(params.repoRoot, params.buildSalt);

  const files = await fg(["**/*.json"], { cwd: params.fragmentsDir, absolute: true, onlyFiles: true });

  let merged = base;
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as any;
      if (parsed && Array.isArray(parsed.entries)) {
        merged = mergeSelectorMaps(merged, { buildSalt: parsed.buildSalt, entries: parsed.entries });
      }
    } catch {
      // ignore
    }
  }

  writeJson(paths.selectorMapPath, merged);

  return { ok: true, selectorMapPath: paths.selectorMapPath, mergedEntries: merged.entries.length, fragmentFiles: files.length };
}

/**
 * Convenience for tests: build fragment entry from a set of mandu ids.
 */
export function makeSelectorMapFragment(buildSalt: string, manduIds: string[]): SelectorMapJson {
  const uniqueIds = Array.from(new Set(manduIds)).filter(Boolean).sort();
  return {
    version: 1,
    buildSalt,
    generatedAt: new Date().toISOString(),
    entries: uniqueIds.map((id) => ({
      manduId: id,
      fallback: [
        { kind: "css", selector: `[data-mandu-id=\"${id}\"]` },
      ],
    })),
  };
}
