// 📜 Mandu Contract - blacklist-api
// Pattern: /api/blacklist

import { z } from "zod";
import { Mandu } from "@mandujs/core";

// ============================================
// 🥟 Schema Definitions
// ============================================

const BlacklistRecordSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  phone: z.string().min(1),
  carModel: z.string().min(1),
  plateNumber: z.string().min(1),
  rentalDate: z.string(),
  amountOwed: z.number().min(0),
  status: z.enum(["stolen", "unpaid"]),
  notes: z.string(),
  createdAt: z.string(),
});

// ============================================
// 📜 Contract Definition
// ============================================

export default Mandu.contract({
  description: "Blacklist CRUD API for rental car stolen/unpaid records",
  tags: ["blacklist-api"],

  request: {
    GET: {
      query: z.object({
        status: z.enum(["all", "stolen", "unpaid"]).default("all"),
        search: z.string().default(""),
      }),
    },

    POST: {
      body: z.object({
        name: z.string().min(1),
        phone: z.string().min(1),
        carModel: z.string().min(1),
        plateNumber: z.string().min(1),
        rentalDate: z.string().min(1),
        amountOwed: z.number().min(0),
        status: z.enum(["stolen", "unpaid"]),
        notes: z.string().default(""),
      }),
    },

    DELETE: {
      query: z.object({
        id: z.coerce.number().int().min(1),
      }),
    },
  },

  response: {
    200: z.object({
      records: z.array(BlacklistRecordSchema),
      total: z.number(),
    }),
    201: z.object({
      record: BlacklistRecordSchema,
    }),
    400: z.object({
      error: z.string(),
      details: z
        .array(
          z.object({
            type: z.string(),
            issues: z.array(
              z.object({
                path: z.string(),
                message: z.string(),
              })
            ),
          })
        )
        .optional(),
    }),
    404: z.object({
      error: z.string(),
    }),
  },
});
