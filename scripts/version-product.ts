#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PRODUCT_PACKAGE_DIRS } from "./publish-order";

const ROOT = join(import.meta.dir, "..");
const CHANGESET_DIR = join(ROOT, ".changeset");
const PRODUCT_PACKAGE_NAMES = new Set([
  "@mandujs/core",
  "@mandujs/mcp",
  "@mandujs/cli",
]);

export type ChangesetTrain = "product" | "other" | "mixed" | "empty";

export function changesetPackages(contents: string): string[] {
  const frontmatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return [];

  return [...frontmatter[1].matchAll(/^\s*["']([^"']+)["']\s*:\s*(?:major|minor|patch)\s*$/gm)]
    .map((match) => match[1]);
}

export function classifyChangeset(contents: string): ChangesetTrain {
  const packages = changesetPackages(contents);
  const hasProduct = packages.some((name) => PRODUCT_PACKAGE_NAMES.has(name));
  const hasOther = packages.some((name) => !PRODUCT_PACKAGE_NAMES.has(name));
  if (hasProduct && hasOther) return "mixed";
  if (hasProduct) return "product";
  if (hasOther) return "other";
  return "empty";
}

function requestedPreTag(args: string[]): string | null {
  const index = args.indexOf("--pre");
  if (index === -1) return null;
  const tag = args[index + 1]?.trim();
  if (!tag || !/^[A-Za-z][A-Za-z0-9._-]*$/.test(tag)) {
    throw new Error("--pre requires a valid prerelease tag such as beta");
  }
  return tag;
}

function runChangeset(args: string[]): void {
  execFileSync(process.execPath, ["x", "changeset", ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
}

async function main(): Promise<void> {
  const preTag = requestedPreTag(process.argv.slice(2));
  const files = (await readdir(CHANGESET_DIR))
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort();
  const nonProductFiles: string[] = [];

  for (const file of files) {
    const contents = await readFile(join(CHANGESET_DIR, file), "utf8");
    const train = classifyChangeset(contents);
    if (train === "mixed") {
      throw new Error(
        `${file} mixes Product and non-Product packages. Split it before running version:product.`,
      );
    }
    if (train === "other") nonProductFiles.push(file);
  }

  const rootPackagePath = join(ROOT, "package.json");
  const changesetConfigPath = join(CHANGESET_DIR, "config.json");
  const originalRootPackage = await readFile(rootPackagePath, "utf8");
  const originalChangesetConfig = await readFile(changesetConfigPath, "utf8");
  const rootPackage = JSON.parse(originalRootPackage) as {
    workspaces: string[] | { packages: string[]; catalog?: Record<string, string> };
  };
  const changesetConfig = JSON.parse(originalChangesetConfig) as { ignore?: string[] };
  if (Array.isArray(rootPackage.workspaces)) {
    rootPackage.workspaces = [...PRODUCT_PACKAGE_DIRS];
  } else {
    rootPackage.workspaces.packages = [...PRODUCT_PACKAGE_DIRS];
  }
  changesetConfig.ignore = (changesetConfig.ignore ?? [])
    .filter((name) => PRODUCT_PACKAGE_NAMES.has(name));

  const holdingDir = await mkdtemp(join(tmpdir(), "mandu-product-version-"));
  const movedFiles: string[] = [];
  let versioned = false;

  try {
    for (const file of nonProductFiles) {
      await rename(join(CHANGESET_DIR, file), join(holdingDir, file));
      movedFiles.push(file);
    }
    await writeFile(rootPackagePath, `${JSON.stringify(rootPackage, null, 2)}\n`);
    await writeFile(changesetConfigPath, `${JSON.stringify(changesetConfig, null, 2)}\n`);

    if (preTag) {
      const prePath = join(CHANGESET_DIR, "pre.json");
      const existing = await Bun.file(prePath).exists()
        ? JSON.parse(await readFile(prePath, "utf8")) as { tag?: string }
        : null;
      if (existing?.tag && existing.tag !== preTag) {
        throw new Error(`Already in prerelease mode with tag ${existing.tag}, not ${preTag}`);
      }
      if (!existing) runChangeset(["pre", "enter", preTag]);
    }

    runChangeset(["version"]);
    versioned = true;
  } finally {
    await writeFile(rootPackagePath, originalRootPackage);
    await writeFile(changesetConfigPath, originalChangesetConfig);
    for (const file of movedFiles) {
      await rename(join(holdingDir, file), join(CHANGESET_DIR, file));
    }
    await rm(holdingDir, { recursive: true, force: true });
  }

  if (versioned) {
    execFileSync(process.execPath, ["install"], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    execFileSync(process.execPath, ["run", "generate:official-skills"], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
  }
}

if (import.meta.main) {
  await main();
}
