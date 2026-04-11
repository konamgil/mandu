// 📜 Mandu Contract - api-sessions
// Pattern: /api/sessions
// Chat session CRUD API

import { z } from "zod";
import { Mandu } from "@mandujs/core";

// ============================================
// 🥟 Schema Definitions
// ============================================

const SessionSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  messageCount: z.number().int(),
  systemPrompt: z.string(),
  updatedAt: z.number(),
});

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
  description: "Chat session CRUD - list, create, update system prompt, delete",
  tags: ["sessions"],

  request: {
    GET: {
      query: z.object({}),
    },

    POST: {
      body: z.object({
        title: z.string().max(100).optional(),
      }),
    },

    PUT: {
      body: z.object({
        sessionId: z.string().uuid("유효하지 않은 세션 ID입니다"),
        systemPrompt: z.string().max(2000, "시스템 프롬프트가 너무 깁니다"),
      }),
    },

    DELETE: {
      body: z.object({
        sessionId: z.string().uuid("유효하지 않은 세션 ID입니다"),
      }),
    },
  },

  response: {
    200: z.object({
      sessions: z.array(SessionSummarySchema).optional(),
      success: z.boolean().optional(),
    }),
    201: z.object({
      id: z.string().uuid(),
      title: z.string(),
      messages: z.array(MessageSchema),
      systemPrompt: z.string(),
    }),
    400: z.object({
      error: z.string(),
    }),
    404: z.object({
      error: z.string(),
    }),
  },
});
