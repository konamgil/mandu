import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { checkDocsDrift } from "./check-docs-drift";

const officialDocs = [
  "README.md",
  "README.ko.md",
  "docs/README.md",
  "docs/README.ko.md",
  "packages/cli/README.md",
  "packages/cli/README.ko.md",
];

async function withFixture(files: Record<string, string>, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "mandu-docs-drift-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), content);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function baseFiles(overrides: Record<string, string> = {}): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of officialDocs) {
    files[file] = "bunx @mandujs/cli create my-app --yes\nhttp://localhost:3333\n";
  }
  files["packages/cli/src/commands/registry.ts"] = "help: '--dry-run --diff', dryRun, diff";
  files["scripts/smoke.ts"] = "create generate page api resource Smoke passed";
  return { ...files, ...overrides };
}

describe("checkDocsDrift", () => {
  it("passes when official quickstarts and generated command surface agree", async () => {
    await withFixture(baseFiles(), async (root) => {
      expect(checkDocsDrift(root)).toEqual([]);
    });
  });

  it("reports stale quickstart commands and ports", async () => {
    await withFixture(
      baseFiles({ "README.md": "bunx @mandujs/cli init my-app\nhttp://localhost:3000" }),
      async (root) => {
        const issues = checkDocsDrift(root);
        expect(issues.some((issue) => issue.file === "README.md")).toBe(true);
        expect(issues.map((issue) => issue.message).join("\n")).toContain("localhost:3333");
      },
    );
  });
});
