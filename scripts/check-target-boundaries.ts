#!/usr/bin/env bun

import { Glob } from "bun";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

export type ImportKind = "static" | "dynamic" | "require";

export interface ImportReference {
  file: string;
  specifier: string;
  kind: ImportKind;
}

export interface BoundaryPolicy {
  name: string;
  roots: string[];
  forbidden: (specifier: string, kind: ImportKind) => string | null;
}

export interface BoundaryIssue {
  policy: string;
  file: string;
  specifier: string;
  kind: ImportKind;
  reason: string;
}

const OPTIONAL_PEER_MODULES = new Set([
  "@babel/core",
  "@tailwindcss/cli",
  "axe-core",
  "babel-plugin-react-compiler",
  "eslint",
  "eslint-plugin-react-compiler",
  "happy-dom",
  "jsdom",
  "react-refresh",
  "webview-bun",
]);

const TARGET_POLICIES: BoundaryPolicy[] = [
  {
    name: "optional peers stay lazy",
    roots: ["packages/core/src", "packages/cli/src", "packages/edge/src"],
    forbidden(specifier, kind) {
      if (kind === "dynamic") return null;
      return optionalPeerName(specifier)
        ? "optional peer dependencies must be loaded lazily"
        : null;
    },
  },
  {
    name: "edge source stays runtime-neutral",
    roots: ["packages/edge/src"],
    forbidden(specifier, kind) {
      if (kind === "dynamic" && specifier === "node:async_hooks") return null;
      if (specifier.startsWith("node:")) return "edge source must not import Node builtins";
      if (specifier.startsWith("bun:")) return "edge source must not import Bun builtins";
      return null;
    },
  },
  {
    name: "browser client source stays runtime-neutral",
    roots: [
      "packages/core/src/client",
      "packages/core/src/components",
      "packages/core/src/island",
    ],
    forbidden(specifier) {
      if (specifier.startsWith("node:")) return "browser client source must not import Node builtins";
      if (specifier.startsWith("bun:")) return "browser client source must not import Bun builtins";
      return null;
    },
  },
];

function optionalPeerName(specifier: string): string | null {
  for (const name of OPTIONAL_PEER_MODULES) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      return name;
    }
  }
  return null;
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

function startsKeyword(source: string, index: number, keyword: string): boolean {
  return (
    source.startsWith(keyword, index) &&
    !isIdentChar(source[index - 1]) &&
    !isIdentChar(source[index + keyword.length])
  );
}

function skipQuoted(source: string, index: number): number {
  const quote = source[index];
  let i = index + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return source.length;
}

function readStatement(source: string, index: number): { statement: string; end: number } {
  let i = index;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuoted(source, i);
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === ";") {
      return { statement: source.slice(index, i + 1), end: i + 1 };
    }
    i += 1;
  }
  return { statement: source.slice(index), end: source.length };
}

function readStringArgument(source: string, openParenIndex: number): string | null {
  let i = openParenIndex + 1;
  while (/\s/.test(source[i] ?? "")) i += 1;
  const quote = source[i];
  if (quote !== "'" && quote !== '"') return null;
  let value = "";
  i += 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      value += source[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (ch === quote) return value;
    value += ch;
    i += 1;
  }
  return null;
}

function skipLineComment(source: string, index: number): number {
  const end = source.indexOf("\n", index + 2);
  return end === -1 ? source.length : end + 1;
}

function skipBlockComment(source: string, index: number): number {
  const end = source.indexOf("*/", index + 2);
  return end === -1 ? source.length : end + 2;
}

function parseStaticImport(statement: string): string | null {
  const sideEffect = statement.match(/\bimport\s+(?:type\s+)?["']([^"']+)["']/);
  if (sideEffect) return sideEffect[1] ?? null;
  const from = statement.match(/\bfrom\s+["']([^"']+)["']/);
  return from?.[1] ?? null;
}

export function scanImportReferences(source: string, file = "<inline>"): ImportReference[] {
  const refs: ImportReference[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuoted(source, i);
      continue;
    }
    if (ch === "/" && next === "/") {
      i = skipLineComment(source, i);
      continue;
    }
    if (ch === "/" && next === "*") {
      i = skipBlockComment(source, i);
      continue;
    }

    if (startsKeyword(source, i, "import")) {
      const afterKeyword = i + "import".length;
      let j = afterKeyword;
      while (/\s/.test(source[j] ?? "")) j += 1;
      if (source[j] === "(") {
        const specifier = readStringArgument(source, j);
        if (specifier) refs.push({ file, specifier, kind: "dynamic" });
        i = j + 1;
        continue;
      }
      const { statement, end } = readStatement(source, i);
      const specifier = parseStaticImport(statement);
      if (specifier) refs.push({ file, specifier, kind: "static" });
      i = end;
      continue;
    }

    if (startsKeyword(source, i, "export")) {
      const { statement, end } = readStatement(source, i);
      const specifier = parseStaticImport(statement);
      if (specifier) refs.push({ file, specifier, kind: "static" });
      i = end;
      continue;
    }

    if (startsKeyword(source, i, "require")) {
      let j = i + "require".length;
      while (/\s/.test(source[j] ?? "")) j += 1;
      if (source[j] === "(") {
        const specifier = readStringArgument(source, j);
        if (specifier) refs.push({ file, specifier, kind: "require" });
      }
      i = j + 1;
      continue;
    }

    i += 1;
  }

  return refs;
}

async function collectSourceFiles(repoRoot: string, roots: string[]): Promise<string[]> {
  const files = new Set<string>();
  const glob = new Glob("**/*.{ts,tsx,js,jsx,mjs,cjs}");

  for (const root of roots) {
    const absRoot = resolve(repoRoot, root);
    if (!existsSync(absRoot)) continue;
    for await (const rel of glob.scan({ cwd: absRoot })) {
      if (
        rel.includes("__tests__/") ||
        rel.includes("__tests__\\") ||
        rel.endsWith(".test.ts") ||
        rel.endsWith(".test.tsx")
      ) {
        continue;
      }
      files.add(resolve(absRoot, rel));
    }
  }

  return [...files].sort();
}

export async function checkTargetBoundaries(
  repoRoot = process.cwd(),
  policies: readonly BoundaryPolicy[] = TARGET_POLICIES
): Promise<BoundaryIssue[]> {
  const issues: BoundaryIssue[] = [];

  for (const policy of policies) {
    const files = await collectSourceFiles(repoRoot, policy.roots);
    for (const file of files) {
      const text = await readFile(file, "utf-8");
      const refs = scanImportReferences(text, relative(repoRoot, file));
      for (const ref of refs) {
        const reason = policy.forbidden(ref.specifier, ref.kind);
        if (!reason) continue;
        issues.push({
          policy: policy.name,
          file: ref.file,
          specifier: ref.specifier,
          kind: ref.kind,
          reason,
        });
      }
    }
  }

  return issues;
}

if (import.meta.main) {
  const issues = await checkTargetBoundaries(process.cwd());

  if (issues.length > 0) {
    console.error("Target boundary check failed:");
    for (const issue of issues) {
      console.error(
        `  - ${issue.file}: ${issue.kind} import of ${issue.specifier} violates "${issue.policy}" (${issue.reason})`
      );
    }
    process.exit(1);
  }

  console.log("Target boundary check passed.");
}
