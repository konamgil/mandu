/**
 * @mandujs/core/storage/s3
 *
 * Thin, S3-compatible object storage helper backed by **native `Bun.S3Client`**
 * (no AWS SDK, no external deps). The same client works against AWS S3,
 * Cloudflare R2, MinIO, DigitalOcean Spaces, and any other S3-compatible
 * service — the only thing that changes is the `endpoint` URL.
 *
 * ## Credentials
 *
 * Bun reads `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (and optionally
 * `AWS_SESSION_TOKEN`) — plus the `S3_*` variants — from the environment at
 * initialization time. You can also pass them explicitly to the underlying
 * `Bun.S3Client`, but this helper intentionally does **not** surface that
 * option: routing secrets through env vars (or a `.env` file loaded by Bun)
 * keeps credentials out of application code. See
 * https://bun.com/docs/runtime/s3#credentials for the full matrix.
 *
 * ## Endpoint
 *
 * Pass `endpoint` on the client config for R2/MinIO/GCS/Supabase/etc. Omit it
 * for AWS (Bun infers the endpoint from `region` + `bucket`).
 *
 * @example
 * ```ts
 * import { createS3Client } from "@mandujs/core/compat/storage/s3/index";
 *
 * const storage = createS3Client({
 *   bucket: "uploads",
 *   endpoint: "https://<account>.r2.cloudflarestorage.com",
 *   region: "auto",
 * });
 *
 * const url = await storage.upload(file, { key: `u/${id}.png` });
 * const presigned = await storage.presign({ key: "u/next.png", method: "PUT", contentType: "image/png" });
 * ```
 *
 * @module storage/s3
 */

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * S3 client configuration. Credentials are **not** part of this interface —
 * they come from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars that
 * Bun auto-reads. See module docs.
 */
export interface S3Config {
  /** Bucket name. Required. */
  bucket: string;
  /**
   * Custom endpoint URL. Required for R2/MinIO/GCS/etc.; omit for AWS (Bun
   * infers from `region`).
   */
  endpoint?: string;
  /**
   * Force path-style URLs (`endpoint/bucket/key`) instead of virtual-hosted
   * (`bucket.endpoint/key`). MinIO usually needs this set to `true`. AWS and
   * R2 work with either but default to virtual-hosted. Default: `false`.
   */
  forcePathStyle?: boolean;
  /**
   * Region. Bun defaults to `us-east-1` for AWS; set `"auto"` for Cloudflare
   * R2. No default applied here — we pass through as-is so Bun's own
   * defaulting logic stays authoritative.
   */
  region?: string;
}

/** Options for uploading a single object. */
export interface S3UploadOptions {
  /** Target object key (path inside the bucket). Required. */
  key: string;
  /**
   * Content-Type header. Inferred from the key's file extension when omitted
   * — see `getContentType` below for the covered extensions.
   */
  contentType?: string;
  /**
   * User metadata. Keys are lowercased and prefixed with `x-amz-meta-` by S3.
   * Values must be ASCII — non-ASCII characters will be rejected by most
   * providers; we do not validate here.
   */
  metadata?: Record<string, string>;
  /**
   * Canned ACL. Applied to this upload only. Omit to inherit the bucket
   * default (recommended for private buckets).
   */
  acl?: "private" | "public-read";
}

/** Options for generating a presigned URL. */
export interface S3PresignOptions {
  /** Object key. Required. */
  key: string;
  /** HTTP method. Default: `"PUT"` (client-direct upload is the common case). */
  method?: "GET" | "PUT";
  /** URL lifetime in **seconds**. Default: 900 (15 minutes). */
  expiresIn?: number;
  /**
   * `Content-Type` baked into the signature. Only meaningful for `PUT`; the
   * uploading client MUST send a matching header or the signature will fail.
   */
  contentType?: string;
}

/** Opaque client instance. */
export interface S3Client {
  /**
   * Uploads a blob/buffer and resolves to the canonical object URL
   * (endpoint + bucket + key).
   */
  upload(
    body: Blob | ArrayBuffer | Uint8Array,
    options: S3UploadOptions,
  ): Promise<string>;

  /** Generates a presigned URL for client-direct upload (PUT) or download (GET). */
  presign(options: S3PresignOptions): Promise<string>;

  /** Deletes an object. Resolves silently if the object does not exist. */
  delete(key: string): Promise<void>;

  /** Returns a readable stream for the object body. Throws if not found. */
  getReadable(key: string): Promise<ReadableStream>;

  /**
   * Head check — `true` if the object exists, `false` on 404. Any other error
   * (network failure, 403, malformed response) is re-thrown.
   */
  exists(key: string): Promise<boolean>;
}

// ─── Bun runtime surface (structural; no `any`) ─────────────────────────────

/** Options accepted by `S3File.write`. Mirrors Bun's BlobPropertyBag extensions. */
interface BunS3WriteOptions {
  type?: string;
  acl?: "private" | "public-read";
}

/** Options accepted by `S3File.presign`. */
interface BunS3PresignOptions {
  method?: "GET" | "PUT";
  expiresIn?: number;
  type?: string;
}

/** Minimal shape of the `S3File` handle returned by `client.file(key)`. */
interface BunS3File {
  write(
    body: Blob | ArrayBuffer | Uint8Array,
    options?: BunS3WriteOptions,
  ): Promise<number>;
  presign(options?: BunS3PresignOptions): string;
  delete(): Promise<void>;
  exists(): Promise<boolean>;
  stream(): ReadableStream;
}

/** Options accepted by the `Bun.S3Client` constructor. */
interface BunS3ClientConfig {
  bucket: string;
  endpoint?: string;
  region?: string;
  virtualHostedStyle?: boolean;
}

/** Minimal `Bun.S3Client` instance shape used by this module. */
export interface BunS3ClientInstance {
  file(key: string): BunS3File;
}

/**
 * Constructor surface — `Bun.S3Client` is a class. We only need the `new`
 * signature structurally, so we type it as a callable returning an instance.
 */
export type BunS3ClientCtor = new (config: BunS3ClientConfig) => BunS3ClientInstance;

// ─── Content-type inference ─────────────────────────────────────────────────

const EXTENSION_MAP: ReadonlyMap<string, string> = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["pdf", "application/pdf"],
  ["txt", "text/plain"],
  ["json", "application/json"],
  ["csv", "text/csv"],
  ["zip", "application/zip"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
]);

/**
 * Maps a key's trailing file extension to a MIME type. Returns
 * `application/octet-stream` for unknown/missing extensions.
 *
 * Exported for tests and for callers that want to inspect the mapping without
 * uploading (e.g., for building a `Content-Type` header on a presigned PUT).
 */
export function getContentType(key: string): string {
  const lastDot = key.lastIndexOf(".");
  if (lastDot === -1 || lastDot === key.length - 1) {
    return "application/octet-stream";
  }
  const ext = key.slice(lastDot + 1).toLowerCase();
  return EXTENSION_MAP.get(ext) ?? "application/octet-stream";
}

// ─── URL construction ───────────────────────────────────────────────────────

/**
 * Builds the canonical object URL that `upload()` returns. Uses the same
 * path-vs-virtual-host logic Bun itself applies, so the URL matches what
 * `fetch()` would resolve.
 *
 * For AWS (no endpoint set), we return an `s3://<bucket>/<key>` URI — the
 * caller may not know the region and we don't want to guess at a public URL.
 */
function buildObjectUrl(
  config: S3Config,
  key: string,
): string {
  const encodedKey = encodeKey(key);

  if (!config.endpoint) {
    // Bun infers the AWS endpoint; returning s3:// keeps this provider-agnostic
    // without pretending to know if the bucket is public-read.
    return `s3://${config.bucket}/${encodedKey}`;
  }

  const base = config.endpoint.replace(/\/+$/, "");
  if (config.forcePathStyle) {
    return `${base}/${config.bucket}/${encodedKey}`;
  }

  // Virtual-hosted style: splice bucket into the hostname.
  try {
    const url = new URL(base);
    url.hostname = `${config.bucket}.${url.hostname}`;
    return `${url.toString().replace(/\/+$/, "")}/${encodedKey}`;
  } catch {
    // Malformed endpoint — fall back to path style so we still return a
    // deterministic, debuggable URL.
    return `${base}/${config.bucket}/${encodedKey}`;
  }
}

/** URL-encodes every path segment of an S3 key while preserving `/` separators. */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

// ─── Bun runtime probe ──────────────────────────────────────────────────────

function getBunS3ClientCtor(): BunS3ClientCtor {
  const g = globalThis as unknown as { Bun?: { S3Client?: BunS3ClientCtor } };
  if (!g.Bun || !g.Bun.S3Client) {
    throw new Error(
      "[@mandujs/core/storage/s3] Bun.S3Client is unavailable — this module requires the Bun runtime (>= 1.3).",
    );
  }
  return g.Bun.S3Client;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Internal factory accepting an injectable `S3Client` constructor — used by
 * unit tests to swap in a fake implementation. Production callers use
 * {@link createS3Client}, which binds this to `Bun.S3Client`.
 */
export function _createS3ClientWith(
  Ctor: BunS3ClientCtor,
  config: S3Config,
): S3Client {
  if (!config.bucket || typeof config.bucket !== "string") {
    throw new TypeError(
      "[@mandujs/core/storage/s3] createS3Client: 'bucket' is required.",
    );
  }

  const bunClient = new Ctor({
    bucket: config.bucket,
    endpoint: config.endpoint,
    region: config.region,
    // forcePathStyle === true  ⇒ virtualHostedStyle: false (the Bun default).
    // forcePathStyle === false ⇒ leave Bun's default untouched.
    // Only set virtualHostedStyle explicitly if the user *opts out* of path
    // style for a service that normally defaults to it. The map here is 1:1.
    virtualHostedStyle: config.forcePathStyle === true ? false : undefined,
  });

  async function upload(
    body: Blob | ArrayBuffer | Uint8Array,
    options: S3UploadOptions,
  ): Promise<string> {
    if (!options.key) {
      throw new TypeError(
        "[@mandujs/core/storage/s3] upload: 'key' is required.",
      );
    }
    const file = bunClient.file(options.key);
    const contentType = options.contentType ?? getContentType(options.key);

    await file.write(body, {
      type: contentType,
      ...(options.acl !== undefined ? { acl: options.acl } : {}),
    });

    // NOTE: metadata is accepted in our public type for forward-compat, but
    // Bun 1.3's `S3File.write` does not surface a `metadata` option. Dropping
    // it silently would be a bug waiting to happen, so we throw at call time.
    if (options.metadata && Object.keys(options.metadata).length > 0) {
      throw new Error(
        "[@mandujs/core/storage/s3] upload: 'metadata' is not yet supported by Bun.S3Client.write. Use a presigned URL with custom headers, or file an issue upstream.",
      );
    }

    return buildObjectUrl(config, options.key);
  }

  async function presign(options: S3PresignOptions): Promise<string> {
    if (!options.key) {
      throw new TypeError(
        "[@mandujs/core/storage/s3] presign: 'key' is required.",
      );
    }
    const method = options.method ?? "PUT";
    const expiresIn = options.expiresIn ?? 900;
    const file = bunClient.file(options.key);

    // Bun.S3File.presign is synchronous; we wrap in a Promise so the public
    // API stays consistent with the rest of the helper surface.
    const url = file.presign({
      method,
      expiresIn,
      ...(options.contentType !== undefined ? { type: options.contentType } : {}),
    });
    return url;
  }

  async function deleteObject(key: string): Promise<void> {
    const file = bunClient.file(key);
    try {
      await file.delete();
    } catch (err) {
      // S3 returns success for delete-of-missing-key; but some S3-compatible
      // providers (and network hiccups) can surface a 404-shaped error. We
      // swallow "not found" and re-throw everything else.
      if (isNotFoundError(err)) return;
      throw err;
    }
  }

  async function getReadable(key: string): Promise<ReadableStream> {
    const file = bunClient.file(key);
    // `file.stream()` is synchronous and returns a ReadableStream that lazily
    // issues the GET when you start consuming. We preserve that laziness and
    // let errors surface on first read rather than proactively HEAD-ing here.
    return file.stream();
  }

  async function exists(key: string): Promise<boolean> {
    const file = bunClient.file(key);
    try {
      return await file.exists();
    } catch (err) {
      if (isNotFoundError(err)) return false;
      throw err;
    }
  }

  return {
    upload,
    presign,
    delete: deleteObject,
    getReadable,
    exists,
  };
}

/**
 * Creates an S3-compatible storage client.
 *
 * @throws if `config.bucket` is missing, or if called outside the Bun runtime.
 */
export function createS3Client(config: S3Config): S3Client {
  return _createS3ClientWith(getBunS3ClientCtor(), config);
}

// ─── Error helpers ──────────────────────────────────────────────────────────

/**
 * Structural check for "object not found" errors raised by Bun's S3 layer.
 * Bun emits an `S3Error` instance with `code` set; we also handle the
 * HTTP-status-bearing variants some providers surface.
 */
function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown; status?: unknown };
  if (e.code === "NoSuchKey") return true;
  if (e.code === "NotFound") return true;
  if (e.status === 404) return true;
  return false;
}
