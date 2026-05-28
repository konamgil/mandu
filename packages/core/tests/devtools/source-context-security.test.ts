/**
 * Security regression tests for SourceContextProvider path handling.
 *
 * The DevTools source-context endpoint reads project files by a
 * request-supplied path. It must never read files outside the project root.
 * Two escapes were possible before the fix:
 *   1. `..` traversal (already blocked by validateRequest), and
 *   2. an ABSOLUTE path input — `path.resolve(root, "/etc/passwd")` returns
 *      "/etc/passwd", and a sibling sharing the root's prefix
 *      ("/app/project-secrets" vs root "/app/project") passed the prefix
 *      `startsWith` check.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SourceContextProvider } from "../../src/devtools/server/source-context";

let baseDir: string;
let projectRoot: string;
let provider: SourceContextProvider;

beforeAll(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "mandu-srcctx-"));
  projectRoot = path.join(baseDir, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "src", "page.ts"), "line1\nline2\nline3\n", "utf-8");

  // Sibling dir that shares the project root's PREFIX — the classic
  // startsWith() escape target.
  mkdirSync(`${projectRoot}-secrets`, { recursive: true });
  writeFileSync(`${projectRoot}-secrets/.env`, "API_KEY=supersecret\n", "utf-8");

  provider = new SourceContextProvider({ projectRoot });
});

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
  rmSync(`${projectRoot}-secrets`, { recursive: true, force: true });
});

describe("SourceContextProvider — path traversal protection", () => {
  it("reads a valid file inside the project root", async () => {
    const res = await provider.getSourceContext({ file: "src/page.ts", line: 2, context: 1 });
    expect(res.success).toBe(true);
    expect(res.data?.content).toContain("line2");
  });

  it("rejects an absolute path that escapes the root", async () => {
    const res = await provider.getSourceContext({
      file: "/etc/passwd",
      line: 1,
      context: 0,
    });
    expect(res.success).toBe(false);
  });

  it("rejects a sibling dir sharing the root prefix (startsWith escape)", async () => {
    const res = await provider.getSourceContext({
      file: `${projectRoot}-secrets/.env`,
      line: 1,
      context: 0,
    });
    expect(res.success).toBe(false);
    // Must NOT leak the secret file's content.
    expect(res.data?.content ?? "").not.toContain("supersecret");
  });

  it("rejects `..` traversal", async () => {
    const res = await provider.getSourceContext({
      file: "../../../etc/passwd",
      line: 1,
      context: 0,
    });
    expect(res.success).toBe(false);
  });
});
