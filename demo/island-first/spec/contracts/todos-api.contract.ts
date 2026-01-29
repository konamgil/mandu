// 📜 Mandu Contract - todos-api
// Pattern: /api/todos
// 이 파일에서 API 스키마를 정의하세요.

import { z } from "zod";
import { Mandu } from "@mandujs/core";

// ============================================
// 🥟 Schema Definitions
// ============================================

// TODO: Define your data schemas here
// const ItemSchema = z.object({
//   id: z.string().uuid(),
//   name: z.string(),
//   createdAt: z.string().datetime(),
// });

// ============================================
// 📜 Contract Definition
// ============================================

export default Mandu.contract({
  description: "TodosApi API",
  tags: ["todos-api"],

  request: {
    GET: {
      query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(10),
      }),
    },

    POST: {
      body: z.object({
        // TODO: Define your request body schema
        name: z.string().min(1),
      }),
    }
  },

  response: {
    200: z.object({
      data: z.unknown(),
      // TODO: Define your success response schema
    }),
    201: z.object({
      data: z.unknown(),
      // TODO: Define your created response schema
    }),
    400: z.object({
      error: z.string(),
      details: z.array(z.object({
        type: z.string(),
        issues: z.array(z.object({
          path: z.string(),
          message: z.string(),
        })),
      })).optional(),
    }),
    404: z.object({
      error: z.string(),
    }),
  },
});

// 💡 Contract 사용법:
// 1. 위의 스키마를 실제 데이터 구조에 맞게 정의하세요
// 2. mandu generate를 실행하면 타입이 자동으로 Slot에 연결됩니다
// 3. OpenAPI 문서가 자동으로 생성됩니다
