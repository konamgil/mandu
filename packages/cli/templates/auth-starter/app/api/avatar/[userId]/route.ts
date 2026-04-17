/**
 * GET /api/avatar/:userId
 *
 * Serves the avatar image for a user. Public endpoint — anyone who knows the
 * user id can fetch their avatar (same model as Gravatar / any public CDN).
 * If you need private avatars, add a session check and verify
 * `currentUserId(ctx) === ctx.params.userId`.
 *
 * Security properties:
 *   - The served file name is stored server-side via `saveAvatar()`. Callers
 *     only supply a userId; the filename is looked up in-process, so a
 *     malicious `userId` cannot traverse the filesystem.
 *   - As a defense in depth, `resolveUploadPath` rejects paths containing
 *     `/`, `\`, or `..` and asserts the resolved path stays under `.uploads/`.
 *     Any stray slash or escape yields `null`, which we turn into a 404.
 *   - Content-Type is derived from the stored extension — never from user
 *     input — so we cannot be tricked into serving `text/html` from a file
 *     claimed to be an image.
 */
import { Mandu } from "@mandujs/core";
import {
  contentTypeForPath,
  getUserAvatar,
  resolveUploadPath,
} from "../../../../server/domain/uploads";

export default Mandu.filling().get(async (ctx) => {
  const userId = ctx.params.userId;
  if (!userId) return ctx.notFound("Unknown user");

  const stored = getUserAvatar(userId);
  if (!stored) return ctx.notFound("Avatar not set");

  const absPath = resolveUploadPath(stored);
  if (!absPath) {
    // Stored filename failed validation — log and refuse. This should never
    // happen with writes from `saveAvatar`, but if the map was seeded
    // manually (or a future bug writes a bad name), we'd rather 404 than
    // leak an arbitrary file.
    console.warn(`[auth-starter] refusing to serve malformed avatar path: ${stored}`);
    return ctx.notFound("Avatar not found");
  }

  // `Bun.file(path)` returns a lazy handle. We set Content-Type explicitly
  // because `Bun.file(...)` on its own defaults to `application/octet-stream`
  // for unknown MIMEs and we want a predictable Image content type.
  const file = Bun.file(absPath);
  if (!(await file.exists())) {
    return ctx.notFound("Avatar file missing");
  }

  return new Response(file, {
    status: 200,
    headers: {
      "Content-Type": contentTypeForPath(stored),
      // Short cache — we don't version the URL, so stale-on-replace is
      // undesirable. 60s is a pragmatic compromise for a demo.
      "Cache-Control": "private, max-age=60",
    },
  });
});
