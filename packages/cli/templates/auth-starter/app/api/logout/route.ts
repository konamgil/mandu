/**
 * POST /api/logout
 *
 * `logoutUser(ctx)` clears the session in memory AND emits a Max-Age=0
 * Set-Cookie so the browser drops its copy. The redirect response picks up
 * that Set-Cookie via `ctx.redirect` (which calls `applyToResponse` under
 * the hood).
 *
 * Idempotent: calling on an already-logged-out request still emits the
 * expiring Set-Cookie and 302s to /.
 */
import { Mandu } from "@mandujs/core";
import { logoutUser } from "@mandujs/core/auth";
import { withSession, withCsrf } from "../../../src/lib/auth";

export default Mandu.filling()
  .use(withSession())
  .use(withCsrf())
  .post(async (ctx) => {
    await logoutUser(ctx);
    return ctx.redirect("/", 302);
  });
