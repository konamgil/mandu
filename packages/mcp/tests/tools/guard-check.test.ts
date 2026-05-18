import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { guardTools } from "../../src/tools/guard";

async function writeFile(root: string, relPath: string, content: string): Promise<void> {
  const filePath = path.join(root, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

describe("mandu.guard.check", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the CLI architecture rules for FS Routes imports", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-mcp-guard-"));
    tempDirs.push(root);

    await writeFile(
      root,
      "mandu.config.json",
      JSON.stringify({ guard: { preset: "mandu", srcDir: "src" } }, null, 2),
    );
    await writeFile(
      root,
      ".mandu/routes.manifest.json",
      JSON.stringify({ version: 1, routes: [] }, null, 2),
    );
    await writeFile(
      root,
      "app/page.tsx",
      [
        'import { getRows } from "@/server/infra/queries";',
        "",
        "export default function Page() {",
        "  return <pre>{String(getRows())}</pre>;",
        "}",
        "",
      ].join("\n"),
    );
    await writeFile(
      root,
      "src/server/infra/queries.ts",
      "export function getRows() { return 1; }\n",
    );

    const handlers = guardTools(root);
    const result = await handlers["mandu.guard.check"]({ autoCorrect: false }) as {
      passed: boolean;
      architecture?: { passed: boolean };
      violations?: Array<{
        ruleId?: string;
        fromLayer?: string;
        toLayer?: string;
      }>;
    };

    expect(result.passed).toBe(false);
    expect(result.architecture?.passed).toBe(false);
    expect(result.violations?.some((violation) =>
      violation.ruleId === "FS Routes Import Rule" &&
      violation.fromLayer === "page" &&
      violation.toLayer === "server/infra"
    )).toBe(true);
  });
});
