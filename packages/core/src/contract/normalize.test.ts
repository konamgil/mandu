/**
 * Mandu Schema Normalization Tests
 */

import { describe, test, expect } from "bun:test";
import { z } from "zod";
import {
  normalizeData,
  safeNormalizeData,
  normalizeSchema,
  createCoerceSchema,
  normalizeRequestData,
  setNormalizeOptions,
  resetNormalizeOptions,
  getNormalizeOptions,
} from "./normalize";

describe("normalizeData", () => {
  const schema = z.object({
    name: z.string(),
    age: z.number(),
  });

  test("strip 모드: 정의되지 않은 필드 제거", () => {
    const input = { name: "Kim", age: 25, admin: true, role: "superuser" };
    const result = normalizeData(schema, input, { mode: "strip" });

    expect(result).toEqual({ name: "Kim", age: 25 });
    expect(result).not.toHaveProperty("admin");
    expect(result).not.toHaveProperty("role");
  });

  test("strict 모드: 정의되지 않은 필드 있으면 에러", () => {
    const input = { name: "Kim", age: 25, admin: true };

    expect(() => {
      normalizeData(schema, input, { mode: "strict" });
    }).toThrow();
  });

  test("passthrough 모드: 모든 필드 허용", () => {
    const input = { name: "Kim", age: 25, admin: true };
    const result = normalizeData(schema, input, { mode: "passthrough" });

    expect(result).toEqual({ name: "Kim", age: 25, admin: true });
  });

  test("기본 모드는 strip", () => {
    resetNormalizeOptions();
    const input = { name: "Kim", age: 25, extra: "field" };
    const result = normalizeData(schema, input);

    expect(result).toEqual({ name: "Kim", age: 25 });
  });
});

describe("safeNormalizeData", () => {
  const schema = z.object({
    name: z.string(),
    age: z.number(),
  });

  test("성공 시 success: true와 data 반환", () => {
    const input = { name: "Kim", age: 25, extra: true };
    const result = safeNormalizeData(schema, input, { mode: "strip" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Kim", age: 25 });
    }
  });

  test("실패 시 success: false와 error 반환", () => {
    const input = { name: "Kim", age: "not a number" };
    const result = safeNormalizeData(schema, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});

describe("createCoerceSchema", () => {
  test("문자열을 숫자로 변환", () => {
    const schema = z.object({
      page: z.number(),
      limit: z.number(),
    });

    const coerced = createCoerceSchema(schema);
    const result = coerced.parse({ page: "1", limit: "10" });

    expect(result).toEqual({ page: 1, limit: 10 });
  });

  test("문자열을 불리언으로 변환", () => {
    const schema = z.object({
      active: z.boolean(),
      verified: z.boolean(),
    });

    const coerced = createCoerceSchema(schema);

    expect(coerced.parse({ active: "true", verified: "false" })).toEqual({
      active: true,
      verified: false,
    });

    expect(coerced.parse({ active: "1", verified: "0" })).toEqual({
      active: true,
      verified: false,
    });
  });

  test("optional 필드 처리", () => {
    const schema = z.object({
      page: z.number().optional(),
      sort: z.string().optional(),
    });

    const coerced = createCoerceSchema(schema);

    expect(coerced.parse({ page: "5" })).toEqual({ page: 5 });
    expect(coerced.parse({})).toEqual({});
  });

  test("default 값 처리", () => {
    const schema = z.object({
      page: z.number().default(1),
      limit: z.number().default(10),
    });

    const coerced = createCoerceSchema(schema);

    expect(coerced.parse({})).toEqual({ page: 1, limit: 10 });
    expect(coerced.parse({ page: "5" })).toEqual({ page: 5, limit: 10 });
  });

  test("숫자 제약 조건 유지 (min, max)", () => {
    const schema = z.object({
      page: z.number().min(1).max(100),
    });

    const coerced = createCoerceSchema(schema);

    expect(coerced.parse({ page: "50" })).toEqual({ page: 50 });
    expect(() => coerced.parse({ page: "0" })).toThrow();
    expect(() => coerced.parse({ page: "101" })).toThrow();
  });

  test("배열 요소 변환", () => {
    const schema = z.object({
      ids: z.array(z.number()),
    });

    const coerced = createCoerceSchema(schema);

    expect(coerced.parse({ ids: ["1", "2", "3"] })).toEqual({
      ids: [1, 2, 3],
    });
  });
});

describe("normalizeRequestData", () => {
  const schemas = {
    query: z.object({
      page: z.number(),
      limit: z.number(),
    }),
    params: z.object({
      id: z.number(),
    }),
    body: z.object({
      name: z.string(),
      email: z.string(),
    }),
  };

  test("query: coerce + strip 적용", () => {
    const result = normalizeRequestData(
      schemas,
      {
        query: { page: "1", limit: "10", extra: "field" },
        params: { id: "123" },
        body: { name: "Kim", email: "a@b.c" },
      },
      { mode: "strip", coerceQueryParams: true }
    );

    expect(result.query).toEqual({ page: 1, limit: 10 });
    expect(result.params).toEqual({ id: 123 });
    expect(result.body).toEqual({ name: "Kim", email: "a@b.c" });
  });

  test("body: strip 적용 (악의적 필드 제거)", () => {
    const result = normalizeRequestData(
      schemas,
      {
        body: {
          name: "Kim",
          email: "a@b.c",
          admin: true,
          role: "superuser",
        },
      },
      { mode: "strip" }
    );

    expect(result.body).toEqual({ name: "Kim", email: "a@b.c" });
    expect(result.body).not.toHaveProperty("admin");
    expect(result.body).not.toHaveProperty("role");
  });
});

describe("전역 옵션 설정", () => {
  test("setNormalizeOptions로 기본 모드 변경", () => {
    resetNormalizeOptions();
    expect(getNormalizeOptions().mode).toBe("strip");

    setNormalizeOptions({ mode: "strict" });
    expect(getNormalizeOptions().mode).toBe("strict");

    resetNormalizeOptions();
    expect(getNormalizeOptions().mode).toBe("strip");
  });
});

describe("보안 시나리오", () => {
  test("Mass Assignment 공격 방지", () => {
    const UserSchema = z.object({
      name: z.string(),
      email: z.string().email(),
    });

    // 공격자가 admin 필드를 추가해서 보냄
    const attackPayload = {
      name: "Hacker",
      email: "hacker@evil.com",
      isAdmin: true,
      role: "superuser",
      permissions: ["all"],
    };

    const result = normalizeData(UserSchema, attackPayload, { mode: "strip" });

    // 정의된 필드만 남음
    expect(result).toEqual({
      name: "Hacker",
      email: "hacker@evil.com",
    });
    expect(result).not.toHaveProperty("isAdmin");
    expect(result).not.toHaveProperty("role");
    expect(result).not.toHaveProperty("permissions");
  });

  test("Prototype Pollution 방지", () => {
    const schema = z.object({
      name: z.string(),
    });

    // __proto__ 필드로 공격 시도
    const attackPayload = {
      name: "Kim",
      __proto__: { polluted: true },
      constructor: { prototype: { hacked: true } },
    };

    const result = normalizeData(schema, attackPayload, { mode: "strip" });

    expect(result).toEqual({ name: "Kim" });
    // Object.keys()로 실제 own property 확인 (모든 객체는 __proto__ 접근 가능)
    expect(Object.keys(result)).toEqual(["name"]);
    expect(Object.keys(result)).not.toContain("constructor");
  });
});
