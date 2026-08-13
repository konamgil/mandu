#!/usr/bin/env bun

import fs from "fs/promises";
import path from "path";
import { renderOfficialSkillCatalog } from "./generate-official-skills";

const ROOT = path.resolve(import.meta.dir, "..");
const SOURCE = path.join(ROOT, "skills", "official");
const TARGETS = [
  path.join(ROOT, "packages", "skills", "generated", "skills"),
  path.join(ROOT, "packages", "mcp", "src", "resources", "generated-skills"),
] as const;

const manifest = JSON.parse(await fs.readFile(path.join(SOURCE, "manifest.json"), "utf8")) as {
  schemaVersion: number;
  skills: Array<{ id: string; description: string }>;
};
const ids = manifest.skills.map((skill) => skill.id);
const issues: string[] = [];

if (manifest.schemaVersion !== 1) issues.push(`unsupported manifest schema: ${manifest.schemaVersion}`);
if (ids.length !== 6) issues.push(`official skill budget mismatch: ${ids.length} != 6`);
if (new Set(ids).size !== ids.length) issues.push("official skill IDs must be unique");

const canonicalDirs = (await fs.readdir(SOURCE, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (JSON.stringify(canonicalDirs) !== JSON.stringify([...ids].sort())) {
  issues.push("canonical skill directories do not match manifest IDs");
}

const expectedCatalog = renderOfficialSkillCatalog(manifest);
for (const id of ids) {
  const canonical = await fs.readFile(path.join(SOURCE, id, "SKILL.md"), "utf8");
  for (const target of TARGETS) {
    const generated = await fs.readFile(path.join(target, id, "SKILL.md"), "utf8").catch(() => null);
    if (generated !== canonical) {
      issues.push(`generated skill drift: ${path.relative(ROOT, path.join(target, id, "SKILL.md"))}`);
    }
  }
}
for (const target of TARGETS) {
  const targetDirs = (await fs.readdir(target, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(targetDirs) !== JSON.stringify([...ids].sort())) {
    issues.push(`generated skill set drift: ${path.relative(ROOT, target)}`);
  }
  const catalog = await fs.readFile(path.join(target, "catalog.ts"), "utf8").catch(() => null);
  if (catalog !== expectedCatalog) {
    issues.push(`generated catalog drift: ${path.relative(ROOT, path.join(target, "catalog.ts"))}`);
  }
}

if (issues.length > 0) {
  issues.forEach((issue) => console.error(`❌ ${issue}`));
  process.exit(1);
}
console.log(`Official skill check passed: ${ids.length} skills, one canonical source, two generated consumers.`);
