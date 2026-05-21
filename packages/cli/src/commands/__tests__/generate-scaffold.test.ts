import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
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

  it("previews page scaffolds without writing files", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };

    try {
      const ok = await generateScaffold({
        kind: "page",
        name: "/dashboard",
        dryRun: true,
        diff: true,
      });

      expect(ok).toBe(true);
      expect(logs.join("\n")).toContain("Would create app/dashboard/page.tsx");
      expect(logs.join("\n")).toContain("diff --git a/app/dashboard/page.tsx b/app/dashboard/page.tsx");
      await expect(access(path.join(root, "app", "dashboard", "page.tsx"))).rejects.toThrow();
    } finally {
      console.log = originalLog;
    }
  });

  it("requires force before previewing replacement output", async () => {
    await mkdir(path.join(root, "app", "dashboard"), { recursive: true });
    await writeFile(path.join(root, "app", "dashboard", "page.tsx"), "export default function Existing() {}\n");

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => {
      errors.push(String(message ?? ""));
    };

    try {
      const ok = await generateScaffold({
        kind: "page",
        name: "/dashboard",
        dryRun: true,
      });

      expect(ok).toBe(false);
      expect(errors.join("\n")).toContain("File already exists: app/dashboard/page.tsx");
      expect(errors.join("\n")).toContain("--force");
    } finally {
      console.error = originalError;
    }
  });
});
