/**
 * Slot Validator Tests
 * 개선된 Slot 검증 기능 테스트
 */

import { describe, test, expect } from "bun:test";
import { validateSlotContent, summarizeValidationIssues } from "./validator";

describe("Slot Validator - 기본 검증", () => {
  test("올바른 Slot 파일은 통과해야 함", () => {
    const validSlot = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ data: [] });
  })
  .post(async (ctx) => {
    const body = await ctx.body();
    return ctx.created({ data: body });
  });
`;

    const result = validateSlotContent(validSlot);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  test("Mandu import 누락 감지", () => {
    const noImport = `
export default Mandu.filling()
  .get((ctx) => ctx.ok({ data: [] }));
`;

    const result = validateSlotContent(noImport);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_MANDU_IMPORT")).toBe(true);
  });

  test("Mandu.filling() 패턴 누락 감지", () => {
    const noFilling = `
import { Mandu } from "@mandujs/core";

export default {
  get: (ctx) => ctx.ok({ data: [] })
};
`;

    const result = validateSlotContent(noFilling);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_FILLING_PATTERN")).toBe(true);
  });
});

describe("Slot Validator - export default 검증 강화", () => {
  test("export default 누락 감지 (변수에 할당만 한 경우)", () => {
    const noExport = `
import { Mandu } from "@mandujs/core";

const myFilling = Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ data: [] });
  });

// export default 빠짐!
`;

    const result = validateSlotContent(noExport);
    expect(result.valid).toBe(false);
    const exportError = result.issues.find((i) => i.code === "MISSING_DEFAULT_EXPORT");
    expect(exportError).toBeDefined();
    expect(exportError?.message).toContain("myFilling");
  });

  test("변수를 export default로 내보내면 통과", () => {
    const withExport = `
import { Mandu } from "@mandujs/core";

const myFilling = Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ data: [] });
  });

export default myFilling;
`;

    const result = validateSlotContent(withExport);
    expect(result.valid).toBe(true);
  });
});

describe("Slot Validator - 응답 패턴 검증 강화", () => {
  test("ctx.ok() 등 응답 메서드 없으면 에러", () => {
    const noResponse = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    // 응답 메서드 호출 없음
  });
`;

    const result = validateSlotContent(noResponse);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "NO_RESPONSE_PATTERN")).toBe(true);
  });

  test("일반 객체 직접 반환 감지", () => {
    const directObject = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    return { data: [], status: "ok" };
  });
`;

    const result = validateSlotContent(directObject);
    // 응답 패턴이 없으므로 에러
    expect(result.issues.some((i) => i.code === "NO_RESPONSE_PATTERN")).toBe(true);
  });

  test("다양한 ctx 응답 메서드 허용", () => {
    const validResponses = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => ctx.ok({ data: [] }))
  .post((ctx) => ctx.created({ data: {} }))
  .put((ctx) => ctx.json({ updated: true }))
  .delete((ctx) => ctx.noContent());
`;

    const result = validateSlotContent(validResponses);
    expect(result.valid).toBe(true);
  });
});

describe("Slot Validator - 문법 검사", () => {
  test("괄호 불균형 감지 - 중괄호", () => {
    const unbalancedBraces = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ data: [];  // 중괄호 } 누락
  });
`;

    const result = validateSlotContent(unbalancedBraces);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "UNBALANCED_BRACES")).toBe(true);
  });

  test("괄호 불균형 감지 - 소괄호", () => {
    const unbalancedParens = `
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ data: [] };  // 소괄호 ) 누락
  });
`;

    const result = validateSlotContent(unbalancedParens);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "UNBALANCED_PARENTHESES")).toBe(true);
  });

  test("금지된 모듈 import 감지", () => {
    const forbidden = `
import { Mandu } from "@mandujs/core";
import fs from "fs";

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ data: [] });
  });
`;

    const result = validateSlotContent(forbidden);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "FORBIDDEN_IMPORT")).toBe(true);
  });
});

describe("Slot Validator - summarizeValidationIssues", () => {
  test("에러와 경고 개수 요약", () => {
    const issues = [
      { code: "A", severity: "error" as const, message: "", suggestion: "", autoFixable: false },
      { code: "B", severity: "error" as const, message: "", suggestion: "", autoFixable: false },
      { code: "C", severity: "warning" as const, message: "", suggestion: "", autoFixable: false },
    ];

    const summary = summarizeValidationIssues(issues);
    expect(summary).toBe("2개 에러, 1개 경고");
  });

  test("문제 없으면 '문제 없음' 반환", () => {
    const summary = summarizeValidationIssues([]);
    expect(summary).toBe("문제 없음");
  });
});
