/**
 * Schema Re-exports (Issue #199)
 *
 * Thin re-export shim so content authors can `import { z } from
 * '@mandujs/core/compat/content/index'` without pulling `zod` directly into their
 * `content.config.ts`. This keeps the import path consistent with
 * how users import `defineCollection`, and it gives us one chokepoint
 * if we ever need to swap the validation backend or wrap Zod with
 * Mandu-specific helpers.
 *
 * NOTE: we intentionally do NOT add a "fat" z here (no custom helpers,
 * no `.mandu()` extensions) — keeping it identical to upstream Zod
 * means `content.config.ts` files stay portable if a project moves
 * between frameworks.
 */

import { z } from "zod";

export { z };
export type { ZodSchema, ZodError, ZodType, ZodTypeAny, infer as Infer } from "zod";
