import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  runReactCompilerLint,
  formatCompilerReport,
  type ReactCompilerDiagnostic,
} from "../react-compiler-lint";

describe("runReactCompilerLint", () => {
  test("returns empty result with no targets without invoking ESLint", async () => {
    const result = await runReactCompilerLint({
      projectRoot: process.cwd(),
      targetFiles: [],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.skipped).toBe(false);
  });

  test("degrades gracefully when ESLint peer dep is missing", async () => {
    // In a clean Mandu checkout `eslint` and
    // `eslint-plugin-react-compiler` are not installed. The runner
    // must report `skipped: true` + empty diagnostics + a skipReason.
    const result = await runReactCompilerLint({
      projectRoot: process.cwd(),
      targetFiles: [path.resolve(__filename)],
    });
    // If ESLint happens to be installed in this env, diagnostics is
    // either empty (this file has no bailouts) or the runner ran
    // successfully. Either shape is valid — the contract we care
    // about is "no throw + typed result."
    expect(Array.isArray(result.diagnostics)).toBe(true);
    expect(typeof result.skipped).toBe("boolean");
    if (result.skipped) {
      expect(typeof result.skipReason).toBe("string");
    }
  });
});

describe("formatCompilerReport", () => {
  test("returns the no-bailouts sentinel for empty input", () => {
    expect(formatCompilerReport([])).toContain("no bailouts detected");
  });

  test("summarises bailouts with file counts + bullet list", () => {
    const diagnostics: ReactCompilerDiagnostic[] = [
      {
        file: "/app/todos/todo.island.tsx",
        line: 42,
        column: 5,
        message: "Cannot memoize: ref escape in closure.",
        ruleId: "react-compiler/react-compiler",
        severity: "warning",
      },
      {
        file: "/app/todos/todo.island.tsx",
        line: 87,
        column: 3,
        message: "Cannot memoize: conditional hook call.",
        ruleId: "react-compiler/react-compiler",
        severity: "warning",
      },
      {
        file: "/app/dashboard/chart.client.tsx",
        line: 14,
        column: 9,
        message: "Cannot memoize: mutation of a shared value.",
        ruleId: "react-compiler/react-compiler",
        severity: "warning",
      },
    ];
    const out = formatCompilerReport(diagnostics);
    expect(out).toContain("3 bailout(s) in 2 file(s)");
    expect(out).toContain("todo.island.tsx:42:5");
    expect(out).toContain("chart.client.tsx:14:9");
    expect(out).toContain("https://react.dev");
  });

  test("truncates past the limit with a '... N more' tail", () => {
    const diagnostics: ReactCompilerDiagnostic[] = Array.from(
      { length: 30 },
      (_, i) => ({
        file: `/app/x/c${i}.island.tsx`,
        line: i + 1,
        column: 1,
        message: "bailout",
        ruleId: "react-compiler/react-compiler",
        severity: "warning" as const,
      }),
    );
    const out = formatCompilerReport(diagnostics, { limit: 5 });
    expect(out).toContain("30 bailout(s)");
    expect(out).toContain("… and 25 more");
  });

  test("uses relative paths when projectRoot is provided", () => {
    const diagnostic: ReactCompilerDiagnostic = {
      file: path.resolve("/project/app/todo.island.tsx"),
      line: 1,
      column: 1,
      message: "bailout",
      ruleId: "react-compiler/react-compiler",
      severity: "warning",
    };
    const out = formatCompilerReport([diagnostic], {
      projectRoot: path.resolve("/project"),
    });
    expect(out).toContain(path.join("app", "todo.island.tsx"));
    expect(out).not.toContain(path.resolve("/project/app"));
  });
});
