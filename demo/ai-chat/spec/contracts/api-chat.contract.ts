// 📜 Mandu Contract - api-chat
// Pattern: /api/chat
// AI Chat streaming endpoint

import { z } from "zod";
import { Mandu } from "@mandujs/core";

// ============================================
// 🥟 Schema Definitions
// ============================================

const MessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  timestamp: z.number(),
});

// ============================================
// 📜 Contract Definition
// ============================================

export default Mandu.contract({
  description: "AI Chat streaming API - accepts user message, returns SSE token stream",
  tags: ["chat", "streaming"],

  request: {
    POST: {
      body: z.object({
        message: z.string().min(1, "메시지를 입력하세요").max(4000, "메시지가 너무 깁니다"),
        sessionId: z.string().uuid("유효하지 않은 세션 ID입니다"),
      }),
    },
  },

  response: {
    200: z.object({
      stream: z.literal(true),
    }),
    400: z.object({
      error: z.string(),
    }),
    404: z.object({
      error: z.string(),
    }),
  },
});
