/**
 * Phase 18.ν — `defineGuardRule()` API + custom-rule runner tests.
 *
 * Covers:
 *   - Shape validation (throws on malformed input)
 *   - Duplicate-id detection via `validateCustomRules()`
 *   - Sync + async rule execution through `runCustomRules()`
 *   - Severity downgrade (`info`) and error severity
 *   - Rule exception isolation (one throwing rule does not abort others)
 *   - ruleId prefix (`custom:<id>`)
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "path";
import fs from "fs/promises";
import os from "os";
import {
  defineGuardRule,
  validateCustomRules,
  isGuardRuleLike,
  type GuardRule,
  type GuardRuleContext,
  type GuardViolation,
} from "../../src/guard/define-rule";
import { runCustomRules } from "../../src/guard/check";

// ─── Fixture helpers ─────────────────────────────────────────────────────
let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-define-rule-"));
  await fs.mkdir(path.join(tmpRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(tmpRoot, "src", "a.ts"),
    `import axios from "axios";\nimport { foo } from "lodash";\nexport const handler = () => axios.get("/");\n`,
    "utf-8"
  );
  await fs.writeFile(
    path.join(tmpRoot, "src", "b.ts"),
    `import { z } from "zod";\nexport function bar() { return z; }\n`,
    "utf-8"
  );
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════
// defineGuardRule — shape validation
// ═════════════════════════════════════════════════════════════════════════

describe("defineGuardRule", () => {
  it("returns the rule object unchanged when valid", () => {
    const rule: GuardRule = defineGuardRule({
      id: "ok-rule",
      severity: "error",
      description: "valid rule",
      check: () => [],
    });
    expect(rule.id).toBe("ok-rule");
    expect(rule.severity).toBe("error");
    expect(typeof rule.check).toBe("function");
  });

  it("throws TypeError on missing id", () => {
    expect(() =>
      defineGuardRule({
        id: "",
        severity: "error",
        description: "bad",
        check: () => [],
      })
    ).toThrow(/id/);
  });

  it("throws TypeError on invalid severity", () => {
    expect(() =>
      defineGuardRule({
        id: "x",
        // @ts-expect-error intentionally invalid
        severity: "fatal",
        description: "bad",
        check: () => [],
      })
    ).toThrow(/severity/);
  });

  it("throws TypeError on missing check function", () => {
    expect(() =>
      defineGuardRule({
        id: "x",
        severity: "error",
        description: "bad",
        // @ts-expect-error intentionally invalid
        check: "not-a-fn",
      })
    ).toThrow(/check/);
  });

  it("throws TypeError on non-object input", () => {
    // @ts-expect-error intentionally invalid
    expect(() => defineGuardRule(null)).toThrow(/object/);
  });

  it("accepts all three severity levels", () => {
    for (const sev of ["error", "warning", "info"] as const) {
      const rule = defineGuardRule({ id: "a", severity: sev, description: "x", check: () => [] });
      expect(rule.severity).toBe(sev);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// isGuardRuleLike + validateCustomRules
// ═════════════════════════════════════════════════════════════════════════

describe("isGuardRuleLike", () => {
  it("accepts a minimally valid rule", () => {
    expect(isGuardRuleLike({ id: "x", check: () => [] })).toBe(true);
  });

  it("rejects objects missing id", () => {
    expect(isGuardRuleLike({ check: () => [] })).toBe(false);
  });

  it("rejects objects missing check", () => {
    expect(isGuardRuleLike({ id: "x" })).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isGuardRuleLike(null)).toBe(false);
    expect(isGuardRuleLike(undefined)).toBe(false);
    expect(isGuardRuleLike("rule")).toBe(false);
    expect(isGuardRuleLike(42)).toBe(false);
  });
});

describe("validateCustomRules", () => {
  it("detects duplicates and reports indices", () => {
    const r1 = defineGuardRule({ id: "dup", severity: "error", description: "d", check: () => [] });
    const r2 = defineGuardRule({ id: "dup", severity: "error", description: "d", check: () => [] });
    const r3 = defineGuardRule({ id: "ok", severity: "error", description: "d", check: () => [] });
    const result = validateCustomRules([r1, r2, r3]);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].id).toBe("dup");
    expect(result.duplicates[0].indices).toEqual([0, 1]);
    expect(result.malformed).toHaveLength(0);
  });

  it("flags malformed entries by index", () => {
    const ok = defineGuardRule({ id: "ok", severity: "error", description: "d", check: () => [] });
    const result = validateCustomRules([ok, null, { id: "x" }, ok]);
    expect(result.malformed).toEqual([1, 2]);
    // ok appears twice → duplicate
    expect(result.duplicates.map((d) => d.id)).toContain("ok");
  });

  it("returns empty arrays on clean input", () => {
    const result = validateCustomRules([
      defineGuardRule({ id: "a", severity: "error", description: "d", check: () => [] }),
      defineGuardRule({ id: "b", severity: "warning", description: "d", check: () => [] }),
    ]);
    expect(result.duplicates).toEqual([]);
    expect(result.malformed).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// runCustomRules — end-to-end runner behavior
// ═════════════════════════════════════════════════════════════════════════

describe("runCustomRules — execution", () => {
  it("runs a sync rule against every source file and prefixes ruleId with custom:", async () => {
    const rule = defineGuardRule({
      id: "has-axios",
      severity: "error",
      description: "flags axios imports",
      check: (ctx: GuardRuleContext): GuardViolation[] =>
        ctx.imports
          .filter((i) => i.path === "axios")
          .map((i) => ({ file: ctx.sourceFile, line: i.line, message: `axios at ${i.line}` })),
    });
    const out = await runCustomRules([rule], tmpRoot, {});
    expect(out.length).toBeGreaterThan(0);
    const axiosViolations = out.filter((v) => v.ruleId === "custom:has-axios");
    expect(axiosViolations).toHaveLength(1);
    expect(axiosViolations[0].file).toBe("src/a.ts");
    expect(axiosViolations[0].severity).toBe("error");
  });

  it("supports async check() functions", async () => {
    const rule = defineGuardRule({
      id: "async-rule",
      severity: "warning",
      description: "async example",
      check: async (ctx: GuardRuleContext) => {
        await new Promise((r) => setTimeout(r, 1));
        return ctx.imports.some((i) => i.path === "zod")
          ? [{ file: ctx.sourceFile, message: "found zod" }]
          : [];
      },
    });
    const out = await runCustomRules([rule], tmpRoot, {});
    const hits = out.filter((v) => v.ruleId === "custom:async-rule");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warning");
  });

  it("captures thrown errors as violations instead of crashing", async () => {
    const good = defineGuardRule({
      id: "good",
      severity: "error",
      description: "ok",
      check: () => [],
    });
    const bad = defineGuardRule({
      id: "bad",
      severity: "error",
      description: "throws",
      check: () => {
        throw new Error("boom");
      },
    });
    const out = await runCustomRules([good, bad], tmpRoot, {});
    const badHits = out.filter((v) => v.ruleId === "custom:bad");
    expect(badHits.length).toBeGreaterThan(0);
    expect(badHits[0].message).toContain("boom");
  });

  it("emits a warning violation for duplicate ids", async () => {
    const a = defineGuardRule({ id: "dup", severity: "error", description: "d", check: () => [] });
    const b = defineGuardRule({ id: "dup", severity: "error", description: "d", check: () => [] });
    const out = await runCustomRules([a, b], tmpRoot, {});
    const dups = out.filter(
      (v) => v.ruleId === "custom:dup" && v.file === "mandu.config"
    );
    expect(dups).toHaveLength(1);
    expect(dups[0].severity).toBe("warning");
    expect(dups[0].message).toContain("Duplicate");
  });

  it("emits an invalid-rule error for malformed entries", async () => {
    const good = defineGuardRule({
      id: "good",
      severity: "error",
      description: "ok",
      check: () => [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await runCustomRules([good, null as any, { id: "x" } as any], tmpRoot, {});
    const invalid = out.filter((v) => v.ruleId === "custom:__invalid__");
    expect(invalid.length).toBeGreaterThanOrEqual(2);
  });

  it("returns an empty array when no rules supplied", async () => {
    const out = await runCustomRules([], tmpRoot, {});
    expect(out).toEqual([]);
  });

  it("downgrades info severity to warning in the report", async () => {
    const rule = defineGuardRule({
      id: "info-rule",
      severity: "info",
      description: "informational",
      check: (ctx) =>
        ctx.imports.some((i) => i.path === "axios") ? [{ file: ctx.sourceFile, message: "info" }] : [],
    });
    const out = await runCustomRules([rule], tmpRoot, {});
    const hits = out.filter((v) => v.ruleId === "custom:info-rule");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warning");
  });

  it("hands a populated GuardRuleContext to each rule", async () => {
    let observed: GuardRuleContext | null = null;
    const rule = defineGuardRule({
      id: "inspect",
      severity: "error",
      description: "inspect",
      check: (ctx) => {
        if (ctx.sourceFile.endsWith("a.ts")) observed = ctx;
        return [];
      },
    });
    await runCustomRules([rule], tmpRoot, {});
    expect(observed).not.toBeNull();
    expect(observed!.imports.length).toBeGreaterThan(0);
    expect(observed!.content).toContain("axios");
    expect(observed!.projectRoot).toBe(tmpRoot);
  });

  it("carries hint + docsUrl through to the report via suggestion", async () => {
    const rule = defineGuardRule({
      id: "hinted",
      severity: "error",
      description: "has hint",
      check: (ctx) =>
        ctx.imports.some((i) => i.path === "axios")
          ? [{ file: ctx.sourceFile, message: "msg", hint: "do X", docsUrl: "https://x" }]
          : [],
    });
    const out = await runCustomRules([rule], tmpRoot, {});
    const hit = out.find((v) => v.ruleId === "custom:hinted");
    expect(hit).toBeTruthy();
    expect(hit!.suggestion).toBe("do X");
  });

  it("ignores files under .mandu/ and __generated__", async () => {
    await fs.mkdir(path.join(tmpRoot, ".mandu", "x"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, ".mandu", "x", "inside.ts"),
      `import axios from "axios";\n`,
      "utf-8"
    );
    let seenGenerated = false;
    const rule = defineGuardRule({
      id: "path-check",
      severity: "error",
      description: "d",
      check: (ctx) => {
        if (ctx.sourceFile.includes(".mandu") || ctx.sourceFile.includes("__generated__")) {
          seenGenerated = true;
        }
        return [];
      },
    });
    await runCustomRules([rule], tmpRoot, {});
    // .mandu/ lives outside src/, packages/, app/ but the check still
    // defensively filters — either way the rule must not observe it.
    expect(seenGenerated).toBe(false);
  });
});
