/**
 * `mandu desktop --entry=<path>` containment tests — Phase 11.B (L-03).
 *
 * Pre-patch the command allowed `--entry=/etc/cron.hourly/evil.sh` — the
 * scaffolder would happily write the template there. Post-patch the
 * entry path is canonicalized and required to remain inside `cwd`.
 *
 * We test the helper directly (`validateDesktopEntryPath`) rather than
 * driving through the CLI, so the tests are isolated from build/peer
 * lookups and run in every environment — including Windows CI where
 * webview-bun is unavailable.
 *
 * See `docs/security/phase-9-audit.md` §L-03 for the threat model.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  validateDesktopEntryPath,
  scaffoldDesktopEntry,
} from "../desktop";

// Stable per-run fixture root. mkdtemp takes a prefix; we append a nonce
// so concurrent suites don't collide even under `bun test --randomize`.
const FIXTURE_PREFIX = path.join(os.tmpdir(), "mandu-desktop-test-");

describe("validateDesktopEntryPath", () => {
  let cwd: string;
  let externalDir: string;

  beforeAll(async () => {
    cwd = await fs.mkdtemp(FIXTURE_PREFIX);
    externalDir = await fs.mkdtemp(FIXTURE_PREFIX + "external-");
  });

  afterAll(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
    await fs.rm(externalDir, { recursive: true, force: true });
  });

  it("accepts a relative path inside cwd", async () => {
    const abs = await validateDesktopEntryPath(cwd, "src/desktop/main.ts");
    expect(abs).toBe(path.resolve(cwd, "src/desktop/main.ts"));
  });

  it("accepts an absolute path inside cwd", async () => {
    const inside = path.join(cwd, "src", "desktop", "main.ts");
    const abs = await validateDesktopEntryPath(cwd, inside);
    expect(abs).toBe(path.resolve(inside));
  });

  it("accepts './' prefix inside cwd", async () => {
    const abs = await validateDesktopEntryPath(cwd, "./src/app.ts");
    expect(abs).toBe(path.resolve(cwd, "src/app.ts"));
  });

  it("rejects absolute paths outside cwd", async () => {
    // Use the sibling temp dir — guaranteed absolute + outside cwd.
    const evil = path.join(externalDir, "evil.ts");
    await expect(validateDesktopEntryPath(cwd, evil)).rejects.toThrow(
      /must be inside the project directory/,
    );
  });

  it("rejects relative traversal (..) escaping cwd", async () => {
    await expect(validateDesktopEntryPath(cwd, "../evil.ts")).rejects.toThrow(
      /must be inside the project directory/,
    );
  });

  it("rejects deeply nested traversal", async () => {
    await expect(
      validateDesktopEntryPath(cwd, "src/./../../../../../evil.ts"),
    ).rejects.toThrow(/must be inside the project directory/);
  });

  it("rejects empty entry", async () => {
    await expect(validateDesktopEntryPath(cwd, "")).rejects.toThrow(
      /must be a non-empty path/,
    );
  });

  // Symlink behavior is filesystem-dependent. On Windows a non-admin
  // user typically lacks `SeCreateSymbolicLinkPrivilege`, so we gate
  // this test on whether we can actually create a symlink.
  it("rejects entry whose directory symlinks outside cwd", async () => {
    const linkDir = path.join(cwd, "trap");
    let skipped = false;
    try {
      await fs.symlink(externalDir, linkDir, "dir");
    } catch (err) {
      // Windows without dev-mode / admin — skip gracefully.
      if (process.platform === "win32" && (err as NodeJS.ErrnoException).code === "EPERM") {
        skipped = true;
      } else if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        // pre-existing from a prior run — acceptable
      } else {
        throw err;
      }
    }
    if (skipped) {
      return;
    }

    // trap/ itself is inside cwd lexically, but realpath resolves to
    // externalDir. Our canonical check must catch this.
    await expect(
      validateDesktopEntryPath(cwd, path.join("trap", "planted.ts")),
    ).rejects.toThrow(/resolves \(via symlink\) outside the project/);

    // Cleanup the symlink so later tests aren't perturbed.
    await fs.rm(linkDir, { recursive: true, force: true });
  });

  it("accepts a symlink whose target stays inside cwd", async () => {
    // Create a legit real dir and a symlink pointing to it, both inside cwd.
    const realDir = path.join(cwd, "real-src");
    const linkDir = path.join(cwd, "linked-src");
    await fs.mkdir(realDir, { recursive: true });

    let skipped = false;
    try {
      await fs.symlink(realDir, linkDir, "dir");
    } catch (err) {
      if (process.platform === "win32" && (err as NodeJS.ErrnoException).code === "EPERM") {
        skipped = true;
      } else if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        // reuse existing symlink
      } else {
        throw err;
      }
    }
    if (skipped) return;

    const abs = await validateDesktopEntryPath(cwd, "linked-src/entry.ts");
    expect(abs).toBe(path.resolve(cwd, "linked-src/entry.ts"));

    await fs.rm(linkDir, { recursive: true, force: true });
    await fs.rm(realDir, { recursive: true, force: true });
  });

  if (process.platform === "win32") {
    it("rejects a Windows drive-letter crossing (cwd on C:, entry on D:)", async () => {
      // We can't actually create a D: drive in CI, but path.relative()
      // returns the absolute D:-rooted string verbatim when drives
      // differ, which our isAbsolute check rejects.
      await expect(
        validateDesktopEntryPath(cwd, "D:\\foo\\bar.ts"),
      ).rejects.toThrow(/must be inside the project directory/);
    });
  }
});

describe("scaffoldDesktopEntry uses validateDesktopEntryPath", () => {
  let cwd: string;
  let externalDir: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(FIXTURE_PREFIX + "scaffold-");
    externalDir = await fs.mkdtemp(FIXTURE_PREFIX + "external-scaffold-");
  });

  it("writes the entry when path is inside cwd", async () => {
    const { wrote, path: entryPath } = await scaffoldDesktopEntry({
      cwd,
      entry: "src/desktop/main.ts",
      force: false,
    });
    expect(wrote).toBe(true);
    expect(entryPath).toBe(path.resolve(cwd, "src/desktop/main.ts"));
    // File must actually exist — confirm the mkdir+writeFile succeeded.
    const stat = await fs.stat(entryPath);
    expect(stat.isFile()).toBe(true);

    await fs.rm(cwd, { recursive: true, force: true });
    await fs.rm(externalDir, { recursive: true, force: true });
  });

  it("refuses to write outside cwd (absolute path)", async () => {
    const evil = path.join(externalDir, "planted.ts");
    await expect(
      scaffoldDesktopEntry({ cwd, entry: evil, force: true }),
    ).rejects.toThrow(/must be inside the project directory/);
    // And crucially, no file was written at the evil path.
    const existed = await fs
      .access(evil)
      .then(() => true)
      .catch(() => false);
    expect(existed).toBe(false);

    await fs.rm(cwd, { recursive: true, force: true });
    await fs.rm(externalDir, { recursive: true, force: true });
  });

  it("refuses traversal even with --force", async () => {
    await expect(
      scaffoldDesktopEntry({ cwd, entry: "../../../tmp/evil.ts", force: true }),
    ).rejects.toThrow(/must be inside the project directory/);

    await fs.rm(cwd, { recursive: true, force: true });
    await fs.rm(externalDir, { recursive: true, force: true });
  });
});
