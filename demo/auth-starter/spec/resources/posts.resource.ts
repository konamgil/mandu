/**
 * Phase 4c demo resource — the first `defineResource` that reaches the
 * DB in auth-starter. Kept orthogonal to the in-memory user store so the
 * existing auth flow E2E stays stable.
 *
 * Flow:
 *   1. `mandu db plan`  — emits `spec/db/migrations/NNNN_auto_*.sql`
 *   2. `mandu db apply` — runs the SQL against the local `app.db` SQLite file
 *   3. The slot at `spec/slots/posts.slot.ts` consumes the generated
 *      `createPostsRepo(db)` factory for all read/write paths.
 */

import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "post",
  fields: {
    id: { type: "uuid", required: true },
    userId: { type: "uuid", required: true },
    title: { type: "string", required: true },
    body: { type: "string", required: true },
    createdAt: { type: "date", required: true, default: "now" },
  },
  options: {
    persistence: {
      provider: "sqlite",
      primaryKey: "id",
      fieldOverrides: {
        userId: { indexed: true },
      },
    },
  },
});
