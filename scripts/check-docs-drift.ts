#!/usr/bin/env bun

import { readFileSync } from "fs";
import { join, resolve } from "path";

export interface DocsDriftIssue {
  file: string;
  message: string;
}

const OFFICIAL_QUICKSTART_DOCS = [
  "README.md",
  "README.ko.md",
  "docs/README.md",
  "docs/README.ko.md",
  "packages/cli/README.md",
  "packages/cli/README.ko.md",
];

const CANONICAL_CREATE_COMMAND = "bunx @mandujs/cli create my-app --yes";

function read(rootDir: string, file: string): string {
  return readFileSync(join(rootDir, file), "utf-8");
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

export function checkDocsDrift(rootDir = process.cwd()): DocsDriftIssue[] {
  const root = resolve(rootDir);
  const issues: DocsDriftIssue[] = [];

  for (const file of OFFICIAL_QUICKSTART_DOCS) {
    const text = read(root, file);
    if (!text.includes(CANONICAL_CREATE_COMMAND)) {
      issues.push({
        file,
        message: `official quickstart must include \`${CANONICAL_CREATE_COMMAND}\``,
      });
    }
    if (text.includes("bunx @mandujs/cli init my-app")) {
      issues.push({
        file,
        message: "official quickstart still advertises `bunx @mandujs/cli init my-app`",
      });
    }
    if (text.includes("http://localhost:3000")) {
      issues.push({
        file,
        message: "official quickstart must use Mandu's default port `http://localhost:3333`",
      });
    }
  }

  const registry = read(root, "packages/cli/src/commands/registry.ts");
  if (!includesAny(registry, ["--dry-run", "dryRun"])) {
    issues.push({
      file: "packages/cli/src/commands/registry.ts",
      message: "`mandu generate` help/handler must expose dry-run support",
    });
  }
  if (!includesAny(registry, ["--diff", "diff"])) {
    issues.push({
      file: "packages/cli/src/commands/registry.ts",
      message: "`mandu generate` help/handler must expose diff preview support",
    });
  }

  const smoke = read(root, "scripts/smoke.ts");
  for (const required of ["create", "generate", "page", "api", "resource", "Smoke passed"]) {
    if (!smoke.includes(required)) {
      issues.push({
        file: "scripts/smoke.ts",
        message: `smoke path must cover ${required}`,
      });
    }
  }

  return issues;
}

if (import.meta.main) {
  const issues = checkDocsDrift();
  if (issues.length > 0) {
    console.error("Docs drift check failed:");
    for (const issue of issues) {
      console.error(`- ${issue.file}: ${issue.message}`);
    }
    process.exit(1);
  }
  console.log("Docs drift check passed.");
}
