/**
 * POST /api/avatar
 *
 * Upload (or replace) the current user's avatar.
 *
 * Pipeline:
 *   1. `session()` middleware — so `currentUserId(ctx)` resolves.
 *   2. `csrf()` middleware — validates `_csrf` form field (double-submit cookie).
 *      The middleware clones the request before reading the form, so the
 *      handler below still has access to the raw multipart body.
 *   3. Handler:
 *      a. Require auth — no session → 401 (API consumers) / 302 (form POSTs).
 *      b. Parse multipart body — extract the File under the "avatar" key.
 *      c. `saveAvatar(file)` — validates MIME/size, SHA-256-hashes, writes to
 *         `<root>/.uploads/<hash>.<ext>` via `Bun.write`.
 *      d. `userStore.setAvatar(userId, filename)` — persist the association.
 *      e. 302 → /dashboard so the user sees the new avatar immediately.
 *
 * Error paths:
 *   - Missing CSRF token → 403 from middleware (never reaches handler).
 *   - Unauthenticated:
 *       - HTML form submit (browser default) → 302 /login
 *       - Programmatic fetch with `Accept: application/json` → 401
 *     The heuristic: if the request accepts HTML, redirect; otherwise JSON.
 *   - File validation failure → 302 /dashboard?uploadError=<reason> so the
 *     dashboard can render an inline error next to the form.
 */
import { Mandu, type ManduContext } from "@mandujs/core";
import { currentUserId } from "@mandujs/core/auth";
import { withSession, withCsrf } from "../../../src/lib/auth";
import { userStore } from "../../../server/domain/users";
import { saveAvatar, setUserAvatar, UploadRejectedError } from "../../../server/domain/uploads";

/**
 * Decide whether the caller prefers HTML (redirect) or JSON (status code).
 * Matches the convention used by `/api/login`: a browser form POST lands on
 * a page, but an `await fetch(...)` call gets structured JSON.
 */
function prefersHtml(ctx: ManduContext): boolean {
  const accept = (ctx.headers.get("accept") ?? "").toLowerCase();
  // Default to HTML when Accept is absent or explicitly requests HTML —
  // matches browser form submission behaviour.
  if (accept === "" || accept.includes("text/html")) return true;
  // If the caller explicitly asks for JSON, honour it.
  if (accept.includes("application/json")) return false;
  // Unknown — default to HTML (safer for browsers).
  return true;
}

export default Mandu.filling()
  .use(withSession())
  .use(withCsrf())
  .post(async (ctx) => {
    // 1. Auth check.
    const userId = currentUserId(ctx);
    if (!userId) {
      return prefersHtml(ctx) ? ctx.redirect("/login", 302) : ctx.unauthorized();
    }

    // Defensive: the user might exist in session but have been removed from
    // the store (e.g. across a reset during tests). Refuse to attach an
    // avatar to a phantom record.
    const user = userStore.findById(userId);
    if (!user) {
      return prefersHtml(ctx) ? ctx.redirect("/login", 302) : ctx.unauthorized();
    }

    // 2. Parse multipart body. `ctx.request.formData()` is the canonical Web
    //    API — Bun decodes the file parts into `File` instances for us. The
    //    CSRF middleware cloned the request before reading, so the stream is
    //    still intact here.
    let formData: FormData;
    try {
      formData = await ctx.request.formData();
    } catch {
      return prefersHtml(ctx)
        ? ctx.redirect("/dashboard?uploadError=invalid-body", 302)
        : ctx.json({ status: "error", error: "invalid-body" }, 400);
    }

    const avatarField = formData.get("avatar");

    // 3. Persist. `saveAvatar` throws UploadRejectedError for validation
    //    failures — we translate those into a stable `reason` in the URL so
    //    the dashboard can render a friendly message.
    let storedName: string;
    try {
      storedName = await saveAvatar(avatarField);
    } catch (err) {
      if (err instanceof UploadRejectedError) {
        const reason = err.reason;
        return prefersHtml(ctx)
          ? ctx.redirect(`/dashboard?uploadError=${encodeURIComponent(reason)}`, 302)
          : ctx.json({ status: "error", error: reason }, 400);
      }
      // Unexpected — bubble to Mandu's error filter (500).
      throw err;
    }

    // 4. Wire the file to the user. Both the in-memory `userAvatars` map and
    //    the user record hold the reference — the map is what avatar-serving
    //    authorizes against, the user record is what the dashboard reads.
    setUserAvatar(userId, storedName);
    userStore.setAvatar(userId, storedName);

    return prefersHtml(ctx)
      ? ctx.redirect("/dashboard?uploadOk=1", 302)
      : ctx.json({ status: "ok", avatar: storedName }, 200);
  });
