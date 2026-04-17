/**
 * Protected dashboard. If the caller has no session, the loader short-
 * circuits via `redirect("/login")` — a 302 is emitted server-side with
 * no SSR render, no client-side bounce, no meta-refresh shell. Cookies
 * set earlier in the loader (e.g. the CSRF token) survive the redirect.
 *
 * Before DX-3 this page rendered a meta-refresh + script fallback for the
 * unauthenticated branch because loaders couldn't return Responses; that
 * workaround is no longer needed.
 *
 * Phase 3.3: also renders the avatar upload form + current avatar.
 * `uploadError=<reason>` / `uploadOk=1` on the query string come from the
 * /api/avatar handler and drive an inline banner.
 */
import { Mandu, redirect } from "@mandujs/core";
import { attachAuthContext } from "../../src/lib/auth";
import { userStore, type User } from "../../server/domain/users";

interface PublicUser {
  id: string;
  email: string;
  createdAt: number;
  hasAvatar: boolean;
}

interface LoaderData {
  user: PublicUser;
  csrfToken: string;
  uploadError: string | null;
  uploadOk: boolean;
}

function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    createdAt: u.createdAt,
    hasAvatar: typeof u.avatarPath === "string" && u.avatarPath.length > 0,
  };
}

/** Maps the stable `reason` strings from uploads.ts to user-facing copy. */
function uploadErrorMessage(reason: string): string {
  switch (reason) {
    case "no-file": return "Please choose a file to upload.";
    case "not-a-file": return "Uploaded value is not a file.";
    case "empty-file": return "The file you uploaded is empty.";
    case "too-large": return "That file is too large. Max 2 MB.";
    case "unsupported-type": return "Unsupported file type. Use PNG, JPEG, WebP, or GIF.";
    case "invalid-body": return "Could not parse upload. Try again.";
    default: return "Upload failed. Try again.";
  }
}

function DashboardPage({ loaderData }: { loaderData?: LoaderData }) {
  // After DX-3, an unauthenticated caller never reaches this render path —
  // the loader returns a 302 before SSR runs. If loaderData is somehow
  // missing (shouldn't happen), fall back to a minimal safe view.
  const user = loaderData?.user;
  const csrfToken = loaderData?.csrfToken ?? "";
  const uploadError = loaderData?.uploadError ?? null;
  const uploadOk = loaderData?.uploadOk ?? false;

  if (!user) {
    // Defensive fallback — guarded by the redirect above, shouldn't render.
    return <div data-testid="dashboard-unauthed" />;
  }

  const createdDate = new Date(user.createdAt).toISOString().slice(0, 10);
  // Bust the `Cache-Control: max-age=60` by appending the user id as a
  // query param on each replace — `?v=<uid>` is stable across reloads but
  // the `uploadOk` query indicates a fresh upload, so we add a time cache
  // buster in that case.
  const avatarUrl = user.hasAvatar
    ? `/api/avatar/${encodeURIComponent(user.id)}${uploadOk ? `?t=${Date.now()}` : ""}`
    : null;

  return (
    <div>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        Dashboard
      </h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "0.875rem", marginBottom: "1.75rem" }}>
        You're logged in. This page is server-rendered behind a session check.
      </p>

      <section className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", rowGap: "0.5rem", fontSize: "0.875rem" }}>
          <span style={{ color: "var(--ink-muted)" }}>Email</span>
          <span data-testid="dashboard-email" style={{ fontWeight: 500 }}>{user.email}</span>
          <span style={{ color: "var(--ink-muted)" }}>User ID</span>
          <code data-testid="dashboard-uid" style={{ fontSize: "0.8125rem" }}>{user.id}</code>
          <span style={{ color: "var(--ink-muted)" }}>Joined</span>
          <span>{createdDate}</span>
        </div>
      </section>

      <section className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }} data-testid="avatar-section">
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Profile picture
        </h2>

        {avatarUrl ? (
          <img
            data-testid="avatar-image"
            src={avatarUrl}
            alt="Your avatar"
            width={96}
            height={96}
            style={{
              width: "96px",
              height: "96px",
              borderRadius: "8px",
              objectFit: "cover",
              marginBottom: "0.875rem",
              border: "1px solid var(--border)",
            }}
          />
        ) : (
          <div
            data-testid="avatar-empty"
            style={{
              width: "96px",
              height: "96px",
              borderRadius: "8px",
              background: "var(--surface-muted, #f0f0f0)",
              marginBottom: "0.875rem",
              border: "1px dashed var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.75rem",
              color: "var(--ink-muted)",
            }}
          >
            No avatar
          </div>
        )}

        {uploadError ? (
          <div
            data-testid="avatar-error"
            className="alert-error"
            style={{ marginBottom: "0.75rem", fontSize: "0.8125rem" }}
          >
            {uploadErrorMessage(uploadError)}
          </div>
        ) : null}

        {uploadOk && !uploadError ? (
          <div
            data-testid="avatar-success"
            style={{
              marginBottom: "0.75rem",
              fontSize: "0.8125rem",
              color: "var(--accent, #2563eb)",
            }}
          >
            Avatar updated.
          </div>
        ) : null}

        <form
          data-testid="avatar-form"
          method="POST"
          action="/api/avatar"
          encType="multipart/form-data"
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          <input type="hidden" name="_csrf" value={csrfToken} />
          <input
            data-testid="avatar-input"
            type="file"
            name="avatar"
            accept="image/png,image/jpeg,image/webp,image/gif"
            required
          />
          <button
            data-testid="avatar-submit"
            type="submit"
            className="btn-primary"
            style={{ alignSelf: "flex-start", marginTop: "0.25rem" }}
          >
            Upload avatar
          </button>
        </form>
      </section>

      <form method="POST" action="/api/logout">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <button type="submit" className="btn-secondary" data-testid="dashboard-logout">
          Log out
        </button>
      </form>
    </div>
  );
}

export const filling = Mandu.filling<LoaderData>().loader(async (ctx) => {
  const { userId, csrfToken } = await attachAuthContext(ctx);
  if (!userId) {
    // DX-3: loader-level redirect. attachAuthContext may have set a CSRF
    // cookie on ctx.cookies — it is merged into the 302 automatically.
    return redirect("/login");
  }
  const raw = userStore.findById(userId);
  if (!raw) {
    // Session points at a deleted user — log them out and bounce to /login.
    return redirect("/login");
  }
  // Banner state comes from the /api/avatar redirect. Defensively narrow the
  // query values — a malicious uploadError value is already neutralised by
  // the switch in `uploadErrorMessage`.
  const uploadError = typeof ctx.query.uploadError === "string" ? ctx.query.uploadError : null;
  const uploadOk = ctx.query.uploadOk === "1";
  return { user: toPublicUser(raw), csrfToken, uploadError, uploadOk };
});

export default DashboardPage;
