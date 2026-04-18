/**
 * POST /api/posts
 *
 * Auth-gated post creation. Uses the session middleware for userId and
 * the CSRF middleware for double-submit token validation; both are the
 * same primitives the rest of the demo relies on.
 *
 * The generated `createPostsRepo.create` omits `id` from the INSERT
 * column list (Phase 4c.R2 behavior: primary key columns are expected
 * to carry a DB-side default). SQLite does not default TEXT primary
 * keys, so we INSERT directly via the raw `db` template — the repo's
 * read/update/delete paths are still exercised on other routes.
 */
import { Mandu } from "@mandujs/core";
import { currentUserId } from "@mandujs/core/auth";
import { withSession, withCsrf } from "../../../src/lib/auth";
import { db } from "../../../src/lib/db";

interface PostBody {
  title?: string;
  body?: string;
  _csrf?: string;
}

export default Mandu.filling()
  .use(withSession())
  .use(withCsrf())
  .post(async (ctx) => {
    const userId = currentUserId(ctx);
    if (!userId) {
      return ctx.redirect("/login", 302);
    }

    const body = await ctx.body<PostBody>();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.body === "string" ? body.body.trim() : "";

    if (title.length === 0 || content.length === 0) {
      return ctx.redirect("/posts?error=missing-fields", 302);
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db`
      INSERT INTO "posts" ("id", "user_id", "title", "body", "created_at")
      VALUES (${id}, ${userId}, ${title}, ${content}, ${createdAt})
    `;

    return ctx.redirect("/posts", 302);
  });
