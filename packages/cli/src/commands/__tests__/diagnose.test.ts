/**
 * CLI `mandu diagnose` command tests (Issue #215).
 *
 * Exercises the full command path: chdir into an isolated fixture root,
 * run `diagnose()`, capture stdout, assert exit semantics.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { diagnose } from "../diagnose";

async function mkRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mandu-diagnose-cli-"));
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
}

function captureStdout(fn: () => Promise<boolean>): Promise<{ result: boolean; out: string }> {
  const origLog = console.log;
  const origError = console.error;
  let out = "";
  console.log = (...args: unknown[]) => { out += args.join(" ") + "\n"; };
  console.error = (...args: unknown[]) => { out += args.join(" ") + "\n"; };
  return fn()
    .then((result) => ({ result, out }))
    .finally(() => { console.log = origLog; console.error = origError; });
}

describe("mandu diagnose CLI", () => {
  let root: string;
  let origCwd: string;

  beforeEach(async () => {
    root = await mkRoot();
    origCwd = process.cwd();
    process.chdir(root);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("exits non-zero (returns false) when manifest is missing (#211 repro)", async () => {
    const { result, out } = await captureStdout(() => diagnose({}));
    expect(result).toBe(false);
    expect(out).toMatch(/UNHEALTHY/);
    expect(out).toMatch(/manifest_freshness/);
  });

  it("exits zero (returns true) when all extended checks pass", async () => {
    await writeFile(root, ".mandu/manifest.json", JSON.stringify({
      version: 1, buildTime: "2026-04-20T00:00:00.000Z", env: "production",
      bundles: { page: { js: "/p.js", dependencies: [], priority: "immediate" } },
      shared: { runtime: "/r.js", vendor: "/v.js" },
    }));
    const { result, out } = await captureStdout(() => diagnose({}));
    expect(result).toBe(true);
    expect(out).toMatch(/HEALTHY/);
  });

  it("warnings alone (prerender_pollution) do not flip healthy to false", async () => {
    await writeFile(root, ".mandu/manifest.json", JSON.stringify({
      version: 1, buildTime: "x", env: "production",
      bundles: { h: { js: "/h.js", dependencies: [], priority: "immediate" } },
      shared: { runtime: "/r.js", vendor: "/v.js" },
    }));
    await writeFile(root, ".mandu/prerendered/path/index.html", "<html></html>");
    const { result, out } = await captureStdout(() => diagnose({}));
    // Warning severity should NOT block — healthy stays true.
    expect(result).toBe(true);
    expect(out).toMatch(/prerender_pollution/);
  });

  it("emits JSON when --json is passed", async () => {
    const { out } = await captureStdout(() => diagnose({ json: true }));
    const parsed = JSON.parse(out.trim());
    expect(parsed).toHaveProperty("healthy");
    expect(parsed).toHaveProperty("checks");
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.length).toBe(5); // 5 extended checks in CLI path
  });

  it("each check in JSON output has the unified shape", async () => {
    const { out } = await captureStdout(() => diagnose({ json: true }));
    const parsed = JSON.parse(out.trim());
    for (const check of parsed.checks) {
      expect(typeof check.ok).toBe("boolean");
      expect(typeof check.rule).toBe("string");
      expect(typeof check.message).toBe("string");
    }
  });
});
