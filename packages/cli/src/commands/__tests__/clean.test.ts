import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clean } from "../clean";

const originalCwd = process.cwd();
let dir = "";

afterEach(() => {
  process.chdir(originalCwd);
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = "";
  }
});

describe("mandu clean", () => {
  it("removes .mandu/vendor-cache so a stale _react.js can't survive a clean", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "mandu-clean-"));
    const manduDir = path.join(dir, ".mandu");
    const vendorCache = path.join(manduDir, "vendor-cache");
    const client = path.join(manduDir, "client");
    mkdirSync(vendorCache, { recursive: true });
    writeFileSync(path.join(vendorCache, "_react.js"), "stale", "utf-8");
    mkdirSync(client, { recursive: true });
    writeFileSync(path.join(client, "globals.css"), "x", "utf-8");

    process.chdir(dir);
    await clean();

    // The cached vendor shims (the #322/#323 culprit) must be gone.
    expect(existsSync(vendorCache)).toBe(false);
    expect(existsSync(client)).toBe(false);
  });
});
