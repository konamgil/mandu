import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { CLI_ERROR_CODES, formatCLIError } from "../../src/errors";

const ANSI_ESC = /\x1b\[/;

describe("error templates (CLI_E001 / CLI_E010 / CLI_E022)", () => {
  const templatesDir = path.resolve(
    import.meta.dir,
    "..",
    "..",
    "templates",
    "errors"
  );

  for (const code of ["CLI_E001", "CLI_E010", "CLI_E022"]) {
    it(`has a markdown template for ${code}`, () => {
      const p = path.join(templatesDir, `${code}.md`);
      expect(existsSync(p)).toBe(true);
      const raw = readFileSync(p, "utf-8");
      expect(raw).toContain(`# ${code}`);
    });
  }

  it("CLI_E001 template defines path/message placeholders", () => {
    const raw = readFileSync(path.join(templatesDir, "CLI_E001.md"), "utf-8");
    expect(raw).toContain("{{path}}");
    expect(raw).toContain("{{message}}");
  });

  it("CLI_E010 template defines port/message placeholders", () => {
    const raw = readFileSync(path.join(templatesDir, "CLI_E010.md"), "utf-8");
    expect(raw).toContain("{{port}}");
    expect(raw).toContain("{{message}}");
  });

  it("CLI_E022 template defines count/message placeholders", () => {
    const raw = readFileSync(path.join(templatesDir, "CLI_E022.md"), "utf-8");
    expect(raw).toContain("{{count}}");
    expect(raw).toContain("{{message}}");
  });
});

describe("formatCLIError with markdown templates", () => {
  const envSnapshot = {
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
    CI: process.env.CI,
    TERM: process.env.TERM,
  };
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    delete process.env.CI;
    process.env.TERM = "xterm-256color";
    (process.stdout as { isTTY?: boolean }).isTTY = true;
  });

  afterEach(() => {
    for (const key of ["NO_COLOR", "FORCE_COLOR", "CI", "TERM"] as const) {
      const prev = envSnapshot[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
    (process.stdout as { isTTY?: boolean }).isTTY = originalIsTTY;
  });

  it("emits ANSI output for CLI_E001 under rich TTY", () => {
    const out = formatCLIError(CLI_ERROR_CODES.INIT_DIR_EXISTS, {
      path: "/tmp/mandu-app",
    });
    expect(out).toMatch(ANSI_ESC);
    expect(out).toContain("CLI_E001");
    expect(out).toContain("/tmp/mandu-app");
  });

  it("falls back to plain text under NO_COLOR for CLI_E001", () => {
    process.env.NO_COLOR = "1";
    const out = formatCLIError(CLI_ERROR_CODES.INIT_DIR_EXISTS, {
      path: "/tmp/mandu-app",
    });
    expect(out).not.toMatch(ANSI_ESC);
    expect(out).toContain("CLI_E001");
    expect(out).toContain("/tmp/mandu-app");
  });

  it("interpolates port placeholder for CLI_E010", () => {
    process.env.NO_COLOR = "1";
    const out = formatCLIError(CLI_ERROR_CODES.DEV_PORT_IN_USE, { port: 3333 });
    expect(out).toContain("CLI_E010");
    expect(out).toContain("3333");
  });

  it("interpolates count placeholder for CLI_E022", () => {
    process.env.NO_COLOR = "1";
    const out = formatCLIError(CLI_ERROR_CODES.GUARD_VIOLATION_FOUND, { count: 7 });
    expect(out).toContain("CLI_E022");
    expect(out).toContain("7");
  });

  it("preserves legacy format for codes without markdown template", () => {
    process.env.NO_COLOR = "1";
    const out = formatCLIError(CLI_ERROR_CODES.INIT_BUN_NOT_FOUND);
    expect(out).toContain("CLI_E002");
    expect(out).toContain("Bun runtime not found");
    // Legacy path should include the `❌ Error [` prefix.
    expect(out).toContain("❌ Error [CLI_E002]");
    expect(out).toContain("Cause:");
    expect(out).toContain("Action:");
    expect(out).toContain("Docs:");
  });
});
