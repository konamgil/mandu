import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { generateScaffold } from "../generate-scaffold";

describe("generateScaffold", () => {
  let root: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    root = await mkdtemp(path.join(tmpdir(), "mandu-generate-scaffold-"));
    process.chdir(root);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  });

  it("creates API route files for mandu generate api", async () => {
    const ok = await generateScaffold({
      kind: "api",
      name: "parties",
      methods: "GET,POST",
    });

    expect(ok).toBe(true);
    const source = await readFile(path.join(root, "app", "api", "parties", "route.ts"), "utf8");
    expect(source).toContain("Mandu.filling()");
    expect(source).toContain(".get(");
    expect(source).toContain(".post(");
  });

  it("creates page and API files for feature scaffolds", async () => {
    const ok = await generateScaffold({
      kind: "feature",
      name: "/dashboard",
    });

    expect(ok).toBe(true);
    expect(await readFile(path.join(root, "app", "dashboard", "page.tsx"), "utf8")).toContain("Dashboard");
    expect(await readFile(path.join(root, "app", "api", "dashboard", "route.ts"), "utf8")).toContain("/api/dashboard");
  });
});
