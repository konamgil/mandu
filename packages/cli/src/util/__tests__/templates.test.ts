/**
 * Phase 9b B — Template embedding unit tests.
 *
 * Pins the contract that `src/util/templates.ts` must honor so that
 * `bun build --compile` scaffolding (mandu init inside a single-file
 * binary) keeps working.
 *
 * Coverage matrix:
 *   1. `listTemplates()` returns the three canonical names in the
 *      generator-defined order.
 *   2. `loadTemplate("default")` returns a non-empty, sorted-by-path
 *      file list whose entries all contain inline payloads.
 *   3. `loadTemplate("nonexistent")` returns null (fails closed — the
 *      init command relies on this for its error branch).
 *   4. Embedded file byte count matches the on-disk `templates/default/`
 *      directory — guards against `templates.generated.ts` drifting out
 *      of sync with the generator output.
 *   5. `readTemplateFile()` and `readTemplateFileBytes()` return byte-for-
 *      byte identical content to the source-of-truth on-disk file.
 *   6. Windows-style backslash paths normalize to the same POSIX key — so
 *      Windows callers that `path.join()` don't silently miss entries.
 *   7. `EMBEDDED_FILE_COUNT` sanity-check (> 100, bounded below so a
 *      future truncation of the manifest is caught loudly).
 *
 * These tests intentionally run against the `bun run` form of execution
 * only — the compiled-binary smoke is covered by the `build:binary`
 * script and Phase 9 R2 e2e bench (`--e2e=binary`).
 */

import { describe, expect, it } from "bun:test";
import path from "node:path";
import fs from "node:fs/promises";
import {
  listTemplates,
  loadTemplate,
  readTemplateFile,
  readTemplateFileBytes,
  resolveTemplateContents,
  getEmbeddedFileCount,
} from "../templates";

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const ON_DISK_TEMPLATES = path.join(PACKAGE_ROOT, "templates");

describe("templates.ts — embedded template access", () => {
  it("lists the three canonical templates in generator order", () => {
    const names = listTemplates();
    expect(names).toEqual(["default", "realtime-chat", "auth-starter"]);
  });

  it("loadTemplate('default') returns a non-empty, sorted file list", () => {
    const files = loadTemplate("default");
    expect(files).not.toBeNull();
    expect(files!.length).toBeGreaterThan(0);

    // Every entry has both a relPath and inline contents.
    for (const entry of files!) {
      expect(typeof entry.relPath).toBe("string");
      expect(entry.relPath.length).toBeGreaterThan(0);
      expect(entry.bytes).toBeInstanceOf(Uint8Array);
      expect(entry.bytes.length).toBeGreaterThan(0);
    }

    // Iteration order must be stable (POSIX string sort on relPath).
    const sorted = [...files!].sort((a, b) =>
      a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0
    );
    expect(files!.map((f) => f.relPath)).toEqual(sorted.map((s) => s.relPath));
  });

  it("loadTemplate('nonexistent') returns null", () => {
    expect(loadTemplate("nonexistent")).toBeNull();
    expect(loadTemplate("")).toBeNull();
    // Path-traversal attempts must also miss. (Init command adds its own
    // defense-in-depth via resolveTemplateName(); this is the second layer.)
    expect(loadTemplate("../default")).toBeNull();
  });

  it("includes the three expected templates and has > 100 total files", () => {
    expect(getEmbeddedFileCount()).toBeGreaterThan(100);
    expect(loadTemplate("default")).not.toBeNull();
    expect(loadTemplate("realtime-chat")).not.toBeNull();
    expect(loadTemplate("auth-starter")).not.toBeNull();
  });

  it("embedded file count matches on-disk templates/default/ walk", async () => {
    async function walk(dir: string, out: string[] = []): Promise<string[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs, out);
        else if (entry.isFile()) out.push(abs);
      }
      return out;
    }

    const onDisk = await walk(path.join(ON_DISK_TEMPLATES, "default"));
    const embedded = loadTemplate("default");
    expect(embedded).not.toBeNull();
    expect(embedded!.length).toBe(onDisk.length);
  });

  it("readTemplateFile returns checkout-independent normalized text", async () => {
    // Pick a stable, small, text file that ships with every release.
    const relPath = "package.json";
    const onDiskPath = path.join(ON_DISK_TEMPLATES, "default", relPath);
    const expected = (await fs.readFile(onDiskPath, "utf-8")).replace(/\r\n?/g, "\n");
    const actual = await readTemplateFile("default", relPath);
    expect(actual).toBe(expected);
  });

  it("readTemplateFileBytes preserves normalized UTF-8 bytes", async () => {
    const relPath = "app/page.tsx";
    const onDiskPath = path.join(ON_DISK_TEMPLATES, "default", relPath);
    const source = (await fs.readFile(onDiskPath, "utf-8")).replace(/\r\n?/g, "\n");
    const expected = new TextEncoder().encode(source);
    const actual = await readTemplateFileBytes("default", relPath);
    expect(actual).not.toBeNull();
    expect(actual!.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      if (actual![i] !== expected[i]) {
        throw new Error(`Byte mismatch at offset ${i}`);
      }
    }
  });

  it("readTemplateFile returns null for unknown template or relPath", async () => {
    expect(await readTemplateFile("nonexistent", "package.json")).toBeNull();
    expect(await readTemplateFile("default", "does/not/exist.ts")).toBeNull();
  });

  it("normalizes Windows-style backslash paths to the same POSIX key", () => {
    const posixHit = resolveTemplateContents("default", "app/page.tsx");
    const winHit = resolveTemplateContents("default", "app\\page.tsx");
    const leadingSlash = resolveTemplateContents("default", "/app/page.tsx");
    const dotSlash = resolveTemplateContents("default", "./app/page.tsx");

    expect(posixHit).not.toBeNull();
    expect(winHit).toBe(posixHit);
    expect(leadingSlash).toBe(posixHit);
    expect(dotSlash).toBe(posixHit);
  });

  it("lefthook templates avoid curl-based local smoke hooks", async () => {
    for (const name of ["default", "realtime-chat", "auth-starter"]) {
      const content = await readTemplateFile(name, "lefthook.yml");
      expect(content).not.toBeNull();
      expect(content!).toContain("bun run check");
      expect(content!).not.toContain("curl");
      expect(content!).not.toContain("/dev/null");
    }
  });

  it("all embedded entries expose inline payloads", () => {
    const files = loadTemplate("default");
    expect(files).not.toBeNull();
    // Spot-check first 3 entries to keep the test fast.
    for (const entry of files!.slice(0, 3)) {
      expect(entry.bytes).toBeInstanceOf(Uint8Array);
      expect(entry.bytes.length).toBeGreaterThan(0);
    }
  });
});
