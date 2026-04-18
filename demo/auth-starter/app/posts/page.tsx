/**
 * Protected `/posts` — Phase 4c demo page. Shows every post the
 * current user has authored (newest first) plus an inline form to
 * create a new one. Unauthed callers are redirected to /login by the
 * loader before SSR runs.
 *
 * Data is read via the generated `createPostsRepo(db).findMany` —
 * specifically, its `Post` row type is the source of truth for the
 * rendered fields. Writes go through /api/posts (see route.ts).
 */
import { Mandu, redirect } from "@mandujs/core";
import { attachAuthContext } from "../../src/lib/auth";
import { postsRepo } from "../../src/lib/db";
import type { Post } from "../../.mandu/generated/server/repos/post.repo";

interface LoaderData {
  userId: string;
  csrfToken: string;
  posts: Post[];
  error: string | null;
}

function PostsPage({ loaderData }: { loaderData?: LoaderData }) {
  const userId = loaderData?.userId ?? "";
  const csrfToken = loaderData?.csrfToken ?? "";
  const posts = loaderData?.posts ?? [];
  const error = loaderData?.error ?? null;

  return (
    <div>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        Posts
      </h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Persistent SQLite-backed list for{" "}
        <code data-testid="posts-uid" style={{ fontSize: "0.8125rem" }}>
          {userId}
        </code>
        .
      </p>

      {error === "missing-fields" ? (
        <div
          data-testid="posts-error"
          className="alert-error"
          style={{ marginBottom: "1rem", fontSize: "0.8125rem" }}
        >
          Title and body are both required.
        </div>
      ) : null}

      <section className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          New post
        </h2>
        <form
          data-testid="posts-form"
          method="POST"
          action="/api/posts"
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          <input type="hidden" name="_csrf" value={csrfToken} />
          <input
            data-testid="posts-title"
            type="text"
            name="title"
            placeholder="Title"
            required
            style={{ padding: "0.5rem", fontSize: "0.875rem" }}
          />
          <textarea
            data-testid="posts-body"
            name="body"
            placeholder="Body"
            required
            rows={3}
            style={{ padding: "0.5rem", fontSize: "0.875rem", fontFamily: "inherit" }}
          />
          <button
            data-testid="posts-submit"
            type="submit"
            className="btn-primary"
            style={{ alignSelf: "flex-start", marginTop: "0.25rem" }}
          >
            Create post
          </button>
        </form>
      </section>

      <section data-testid="posts-list">
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Your posts ({posts.length})
        </h2>
        {posts.length === 0 ? (
          <p data-testid="posts-empty" style={{ color: "var(--ink-muted)" }}>
            No posts yet. Create your first one above.
          </p>
        ) : (
          <ul style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: 0, listStyle: "none" }}>
            {posts.map((p) => (
              <li
                key={p.id}
                data-testid="posts-item"
                className="card"
                style={{ padding: "1rem" }}
              >
                <div data-testid="posts-item-title" style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                  {p.title}
                </div>
                <div data-testid="posts-item-body" style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>
                  {p.body}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--ink-muted)" }}>
                  {new Date(p.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export const filling = Mandu.filling<LoaderData>().loader(async (ctx) => {
  const { userId, csrfToken } = await attachAuthContext(ctx);
  if (!userId) {
    return redirect("/login");
  }
  const all = await postsRepo.findMany(100, 0);
  const mine = all.filter((p) => p.userId === userId).sort(
    (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0),
  );
  const error = typeof ctx.query.error === "string" ? ctx.query.error : null;
  return { userId, csrfToken, posts: mine, error };
});

export default PostsPage;
