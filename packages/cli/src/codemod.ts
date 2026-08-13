#!/usr/bin/env bun

import { migrateCoreV1Imports } from "./codemods/core-v1-imports";

function usage(): void {
  console.log([
    "Usage: mandu-codemod core-v1 [paths...] [--write|--check]",
    "",
    "Migrates retired @mandujs/core subpaths to @mandujs/core/compat/*.",
    "Stable v1 subpaths and the root import are left unchanged.",
  ].join("\n"));
}

async function main(args: string[]): Promise<void> {
  const [migration, ...rest] = args;
  if (!migration || migration === "--help" || migration === "-h") {
    usage();
    return;
  }
  if (migration !== "core-v1") {
    console.error(`Unknown migration: ${migration}`);
    usage();
    process.exitCode = 1;
    return;
  }

  const write = rest.includes("--write");
  const check = rest.includes("--check");
  const targets = rest.filter((arg) => !arg.startsWith("--"));
  const result = await migrateCoreV1Imports(targets, { write });

  const action = write ? "updated" : "would update";
  console.log(`Scanned ${result.scannedFiles} source files; ${action} ${result.changes.length}.`);
  for (const change of result.changes) {
    console.log(`  ${change.file} (${change.replacements})`);
  }
  if (check && result.changes.length > 0) process.exitCode = 1;
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
