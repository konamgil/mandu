/**
 * In-memory avatar upload store — Phase 3.3 demo only.
 *
 * Responsibilities:
 *   1. Validate a multipart File against an allowlisted image MIME type and
 *      a conservative size budget.
 *   2. Content-address the bytes with SHA-256 so duplicate uploads dedupe on
 *      disk (two users uploading the same cat photo share one file).
 *   3. Persist to `<projectRoot>/.uploads/<hash>.<ext>` via `Bun.write`.
 *   4. Track a simple `userId → storedPath` map so the dashboard loader can
 *      render `<img>` tags without hitting the filesystem first.
 *
 * Production migration path (documented, NOT implemented):
 *   - Swap `Bun.write(absPath, file)` for `await s3Client.upload({ key, body })`
 *     using `@mandujs/core/storage/s3`. The `getContentType(key)` helper there
 *     already handles MIME lookup, so the only other change is rewriting the
 *     served URL in `app/api/avatar/[userId]/route.ts` to emit a 302 pointing
 *     at the presigned GET URL (or the bucket's public CDN domain).
 *   - Replace the in-memory `userAvatars` Map with whatever user-store your app
 *     uses — the `userStore.setAvatar(id, key)` API is already generic enough.
 *
 * Non-goals (by design):
 *   - No resize / crop / re-encode — would pull in sharp / libvips and delay
 *     Phase 3 shipping. The MIME check is sufficient for the demo's purpose.
 *   - No rate limiting — rate-limit middleware from Phase 1 can be added at
 *     the route level without touching this file.
 *   - No persistence of the user→path map — restart wipes uploaded state so
 *     running the demo twice doesn't accumulate stray cross-run state.
 */
import path from "node:path";

/** Allow-list of MIME types. Keep small: common web image formats only. */
const ALLOWED_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

/** 2 MB — same order-of-magnitude as common avatar upload limits. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Absolute directory where uploads land. Lazily created on first save. */
const UPLOAD_DIR = path.resolve(process.cwd(), ".uploads");

/** userId → relative path ("<hash>.<ext>"); relative so GET handler can rebuild. */
const userAvatars = new Map<string, string>();

/**
 * Typed error the handler catches and converts to an HTTP response. Using a
 * class lets the handler do `err instanceof UploadRejectedError` without
 * leaking reason strings across module boundaries.
 */
export class UploadRejectedError extends Error {
  readonly statusCode = 400;
  constructor(public readonly reason: UploadRejectReason, message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

export type UploadRejectReason =
  | "no-file"
  | "not-a-file"
  | "empty-file"
  | "too-large"
  | "unsupported-type";

/** Content-Type lookup for the GET handler — keeps the module self-contained. */
export function contentTypeForPath(stored: string): string {
  const dot = stored.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  const ext = stored.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    default: return "application/octet-stream";
  }
}

/** Compute SHA-256 over the blob bytes. URL-safe hex → short enough for filenames. */
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const bytesView = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytesView.length; i++) {
    hex += bytesView[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Validate + persist an uploaded avatar, returning the relative stored path
 * (filename only — no directory prefix). Throws {@link UploadRejectedError} on
 * any validation failure; the handler turns those into 400 responses.
 */
export async function saveAvatar(input: unknown): Promise<string> {
  if (input == null) {
    throw new UploadRejectedError("no-file", "No avatar file was provided.");
  }
  // `formData.get(...)` returns `File | string | null`. Strings are form text
  // fields, which must never be accepted here.
  if (!(input instanceof File)) {
    throw new UploadRejectedError("not-a-file", "Uploaded value is not a file.");
  }
  const file = input;

  if (file.size === 0) {
    throw new UploadRejectedError("empty-file", "File is empty.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadRejectedError(
      "too-large",
      `File exceeds ${Math.floor(MAX_UPLOAD_BYTES / 1024)} KB limit.`,
    );
  }
  // Browsers occasionally append a charset to image MIME (we saw this in tests);
  // strip anything past the first `;` to normalize.
  const rawType = (file.type ?? "").toLowerCase();
  const mime = rawType.split(";", 1)[0].trim();
  const ext = ALLOWED_MIME_TYPES.get(mime);
  if (!ext) {
    throw new UploadRejectedError(
      "unsupported-type",
      `Unsupported file type: ${mime || "(unknown)"}. Use PNG, JPEG, WebP, or GIF.`,
    );
  }

  // Hash → stable filename. Two users uploading identical bytes share one file,
  // which also means "delete avatar" must reference-count in production — the
  // demo sidesteps this since we never delete.
  const buf = await file.arrayBuffer();
  const hash = await sha256Hex(buf);
  const filename = `${hash}.${ext}`;
  const absPath = path.join(UPLOAD_DIR, filename);

  // Bun.write creates parent dirs for us. Write a Blob-compatible input so the
  // header/mime metadata is preserved — `Bun.file` reads it back later.
  // PRODUCTION NOTE: replace with `s3Client.upload({ key: filename, body: file })`
  // from `@mandujs/core/storage/s3` — one line swap, same return semantics.
  await Bun.write(absPath, file);

  return filename;
}

/** Associate an avatar filename with a user. Overwrites any prior mapping. */
export function setUserAvatar(userId: string, filename: string): void {
  userAvatars.set(userId, filename);
}

/** Look up the stored avatar filename for a user, or null if they have none. */
export function getUserAvatar(userId: string): string | null {
  return userAvatars.get(userId) ?? null;
}

/**
 * Resolve a requested filename to an absolute path INSIDE `.uploads/`.
 * Returns null if the filename is attempting traversal (contains `/`, `\`, or
 * `..`) or resolves outside the upload directory. Callers MUST treat null as
 * "refuse to serve".
 */
export function resolveUploadPath(filename: string): string | null {
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return null;
  }
  const absPath = path.join(UPLOAD_DIR, filename);
  // Defense in depth: enforce that the resolved path is a descendant of the
  // upload dir even after normalization. Any discrepancy → refuse.
  const normalizedDir = UPLOAD_DIR.endsWith(path.sep) ? UPLOAD_DIR : UPLOAD_DIR + path.sep;
  if (!absPath.startsWith(normalizedDir)) {
    return null;
  }
  return absPath;
}

/** Test helper — wipe the user→avatar map. Does NOT remove `.uploads/` files. */
export function _resetUploadsForTests(): void {
  userAvatars.clear();
}
