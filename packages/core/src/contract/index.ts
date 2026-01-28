/**
 * Mandu Contract Module
 * Contract-first API 정의 시스템
 */

export * from "./schema";
export * from "./types";
export * from "./validator";

import type { ContractDefinition, ContractInstance } from "./schema";

/**
 * Create a Mandu API Contract
 *
 * Contract-first 방식으로 API 스키마를 정의합니다.
 * 정의된 스키마는 다음에 활용됩니다:
 * - TypeScript 타입 추론 (Slot에서 자동 완성)
 * - 런타임 요청/응답 검증
 * - OpenAPI 문서 자동 생성
 * - Guard의 Contract-Slot 일관성 검사
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { Mandu } from "@mandujs/core";
 *
 * const UserSchema = z.object({
 *   id: z.string().uuid(),
 *   email: z.string().email(),
 *   name: z.string().min(2),
 * });
 *
 * export default Mandu.contract({
 *   description: "사용자 관리 API",
 *   tags: ["users"],
 *
 *   request: {
 *     GET: {
 *       query: z.object({
 *         page: z.coerce.number().default(1),
 *         limit: z.coerce.number().default(10),
 *       }),
 *     },
 *     POST: {
 *       body: UserSchema.omit({ id: true }),
 *     },
 *   },
 *
 *   response: {
 *     200: z.object({ data: z.array(UserSchema) }),
 *     201: z.object({ data: UserSchema }),
 *     400: z.object({ error: z.string() }),
 *     404: z.object({ error: z.string() }),
 *   },
 * });
 * ```
 */
export function createContract<T extends ContractDefinition>(definition: T): T & ContractInstance {
  return {
    ...definition,
    _validated: false,
  };
}
