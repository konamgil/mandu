/**
 * Phase 4c DB singleton for auth-starter.
 *
 * Creates one long-lived `Db` handle backed by SQLite (`./app.db`),
 * consumed by `app/api/posts/*` and `app/posts/page.tsx`. Kept in its
 * own module so any route can import without re-opening the pool.
 *
 * The URL defaults to a project-relative file so `mandu dev` and the
 * Playwright E2E webServer share the same database (the migration
 * runner wrote to it via `mandu db apply` as part of R3 setup). Set
 * `DATABASE_URL` to override (e.g. pointing at a sibling test DB).
 */
import { createDb, type Db } from "@mandujs/core/db";
import { createPostsRepo } from "../../.mandu/generated/server/repos/post.repo";

const DATABASE_URL = process.env.DATABASE_URL ?? "sqlite://./app.db";

export const db: Db = createDb({ url: DATABASE_URL });

export const postsRepo = createPostsRepo(db);
