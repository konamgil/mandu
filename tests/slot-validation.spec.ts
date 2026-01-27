import { describe, test, expect } from "bun:test";
import {
  validateSlotContent,
  correctSlotContent,
  runSlotCorrection,
  summarizeValidationIssues,
} from "../packages/core/src/slot";

describe("Slot Validation", () => {
  test("valid slot content passes validation", () => {
    const validContent = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get(ctx => ctx.ok({ message: "Hello" }))
  .post(async ctx => {
    const body = await ctx.body();
    return ctx.created(body);
  });
`;

    const result = validateSlotContent(validContent);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  test("detects missing Mandu import", () => {
    const content = `
export default Mandu.filling()
  .get(ctx => ctx.ok({ message: "Hello" }));
`;

    const result = validateSlotContent(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_MANDU_IMPORT")).toBe(
      true
    );
  });

  test("detects forbidden imports", () => {
    const content = `
import { Mandu } from "@mandujs/core";
import fs from "fs";

export default Mandu.filling()
  .get(ctx => ctx.ok({ message: "Hello" }));
`;

    const result = validateSlotContent(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "FORBIDDEN_IMPORT")).toBe(true);
  });

  test("detects missing default export", () => {
    const content = `
import { Mandu } from "@mandujs/core";

const handler = Mandu.filling()
  .get(ctx => ctx.ok({ message: "Hello" }));
`;

    const result = validateSlotContent(content);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_DEFAULT_EXPORT")).toBe(
      true
    );
  });

  test("detects unbalanced brackets", () => {
    const content = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get(ctx => ctx.ok({ message: "Hello" })
`;

    const result = validateSlotContent(content);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (i) =>
          i.code === "UNBALANCED_PARENTHESES" || i.code === "UNBALANCED_BRACES"
      )
    ).toBe(true);
  });

  test("warns about missing HTTP handlers", () => {
    const content = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling();
`;

    const result = validateSlotContent(content);
    expect(result.issues.some((i) => i.code === "NO_HTTP_HANDLER")).toBe(true);
    expect(result.issues.find((i) => i.code === "NO_HTTP_HANDLER")?.severity).toBe(
      "warning"
    );
  });
});

describe("Slot Correction", () => {
  test("auto-fixes missing Mandu import", () => {
    const content = `
export default Mandu.filling()
  .get(ctx => ctx.ok({ message: "Hello" }));
`;

    const validation = validateSlotContent(content);
    const correction = correctSlotContent(content, validation.issues);

    expect(correction.corrected).toBe(true);
    expect(correction.appliedFixes.some((f) => f.code === "MISSING_MANDU_IMPORT")).toBe(
      true
    );
    expect(correction.content).toContain('import { Mandu } from "@mandujs/core"');
  });

  test("auto-fixes forbidden imports", () => {
    const content = `
import { Mandu } from "@mandujs/core";
import fs from "fs";

export default Mandu.filling()
  .get(ctx => ctx.ok({ message: "Hello" }));
`;

    const validation = validateSlotContent(content);
    const correction = correctSlotContent(content, validation.issues);

    expect(correction.corrected).toBe(true);
    expect(correction.appliedFixes.some((f) => f.code === "FORBIDDEN_IMPORT")).toBe(
      true
    );
    expect(correction.content).toContain("// REMOVED:");
    expect(correction.content).toContain("Bun.file()");
  });

  test("does not auto-fix unbalanced brackets", () => {
    const content = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get(ctx => ctx.ok({ message: "Hello" })
`;

    const validation = validateSlotContent(content);
    const correction = correctSlotContent(content, validation.issues);

    expect(correction.remainingIssues.length).toBeGreaterThan(0);
    expect(
      correction.remainingIssues.some(
        (i) =>
          i.code === "UNBALANCED_PARENTHESES" || i.code === "UNBALANCED_BRACES"
      )
    ).toBe(true);
  });
});

describe("Slot Correction Loop", () => {
  test("runs multiple correction iterations", async () => {
    const content = `
import fs from "fs";

const handler = Mandu.filling()
  .get(ctx => ctx.ok({ message: "Hello" }));
`;

    const result = await runSlotCorrection(content, validateSlotContent, 3);

    // Should have fixed multiple issues
    expect(result.allFixes.length).toBeGreaterThan(0);
    expect(result.attempts).toBeGreaterThan(0);

    // Content should now have Mandu import and no fs import
    expect(result.finalContent).toContain('import { Mandu } from "@mandujs/core"');
    expect(result.finalContent).toContain("// REMOVED:");
  });

  test("stops when no more auto-fixable issues", async () => {
    const content = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get(ctx => ctx.ok({ message: "Hello" })
`;

    const result = await runSlotCorrection(content, validateSlotContent, 3);

    // Should stop since bracket issues are not auto-fixable
    expect(result.success).toBe(false);
    expect(result.remainingIssues.length).toBeGreaterThan(0);
  });
});

describe("Validation Summary", () => {
  test("summarizes issues correctly", () => {
    const content = `
import fs from "fs";

const handler = Mandu.filling();
`;

    const validation = validateSlotContent(content);
    const summary = summarizeValidationIssues(validation.issues);

    expect(summary).toContain("에러");
  });

  test("returns clean summary for valid content", () => {
    const validContent = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get(ctx => ctx.ok({ message: "Hello" }));
`;

    const validation = validateSlotContent(validContent);
    const summary = summarizeValidationIssues(
      validation.issues.filter((i) => i.severity === "error")
    );

    expect(summary).toBe("문제 없음");
  });
});
