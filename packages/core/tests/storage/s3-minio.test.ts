/**
 * @mandujs/core/storage/s3 — MinIO integration tests
 *
 * These tests run against a real S3-compatible server (MinIO) and exercise the
 * full Bun.S3Client code path — no fakes. The suite is **gated** on the
 * `MINIO_TEST_ENDPOINT` environment variable so CI (and contributors who
 * haven't brought up docker) no-op the suite cleanly.
 *
 * ### How to run locally
 *
 * ```bash
 * docker compose -f packages/core/tests/fixtures/s3/docker-compose.yml up -d
 *
 * # Bun.s3 reads these automatically — we also pass them explicitly below
 * # so the test doesn't leak credentials between contexts.
 * export AWS_ACCESS_KEY_ID=minioadmin
 * export AWS_SECRET_ACCESS_KEY=minioadmin
 * export MINIO_TEST_ENDPOINT=http://localhost:9000
 *
 * bun test packages/core/tests/storage
 * ```
 *
 * ### CI
 *
 * Wire the same docker compose into the workflow as a service container; the
 * step setting `MINIO_TEST_ENDPOINT` is what activates the suite.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { createS3Client } from "../../src/storage/s3";

const MINIO_ENDPOINT = process.env.MINIO_TEST_ENDPOINT;
const MINIO_BUCKET = process.env.MINIO_TEST_BUCKET ?? "mandu-test";
// Default MinIO root credentials match docker-compose.yml. Any override wins.
const MINIO_KEY = process.env.AWS_ACCESS_KEY_ID ?? "minioadmin";
const MINIO_SECRET = process.env.AWS_SECRET_ACCESS_KEY ?? "minioadmin";

// Gate: if MINIO_TEST_ENDPOINT is unset, every `it` resolves as a skip.
const describeIfMinio = MINIO_ENDPOINT ? describe : describe.skip;

describeIfMinio("@mandujs/core/compat/storage/s3 — MinIO integration", () => {
  beforeAll(() => {
    // Ensure Bun.s3 picks up credentials. Bun prefers env at init time (not
    // process.env reads later), but it also honors explicit credentials on
    // the S3Client — we can't pass them through our helper's public API
    // today, so we set env vars here as a safety net.
    if (!process.env.AWS_ACCESS_KEY_ID) {
      process.env.AWS_ACCESS_KEY_ID = MINIO_KEY;
    }
    if (!process.env.AWS_SECRET_ACCESS_KEY) {
      process.env.AWS_SECRET_ACCESS_KEY = MINIO_SECRET;
    }
  });

  it("upload → exists → getReadable roundtrip against real MinIO", async () => {
    const client = createS3Client({
      bucket: MINIO_BUCKET,
      endpoint: MINIO_ENDPOINT,
      forcePathStyle: true, // MinIO requires path-style by default
      region: "us-east-1",
    });

    const key = `integration/roundtrip-${Date.now()}.bin`;
    const payload = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);

    const url = await client.upload(payload, { key });
    expect(url).toContain(key);

    expect(await client.exists(key)).toBe(true);

    const stream = await client.getReadable(key);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    // Drain the stream — we assert content equality below.
    // Bounded loop: MinIO returns the whole 4-byte object in one chunk.
    // The `reader.read()` promise eventually resolves to `done: true`.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      joined.set(c, offset);
      offset += c.byteLength;
    }
    expect(Array.from(joined)).toEqual([0xca, 0xfe, 0xba, 0xbe]);

    // Clean up — a re-run of this test would otherwise accumulate keys.
    await client.delete(key);
  });

  it("presigned PUT URL accepts an upload via fetch", async () => {
    const client = createS3Client({
      bucket: MINIO_BUCKET,
      endpoint: MINIO_ENDPOINT,
      forcePathStyle: true,
      region: "us-east-1",
    });

    const key = `integration/presigned-${Date.now()}.txt`;
    const body = `hello at ${new Date().toISOString()}`;

    const url = await client.presign({
      key,
      method: "PUT",
      expiresIn: 120,
      contentType: "text/plain",
    });

    const res = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body,
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    // The object must now exist under that key.
    expect(await client.exists(key)).toBe(true);

    await client.delete(key);
  });

  it("delete removes the object (exists returns false afterwards)", async () => {
    const client = createS3Client({
      bucket: MINIO_BUCKET,
      endpoint: MINIO_ENDPOINT,
      forcePathStyle: true,
      region: "us-east-1",
    });

    const key = `integration/delete-${Date.now()}.txt`;
    await client.upload(new TextEncoder().encode("to be removed"), {
      key,
      contentType: "text/plain",
    });
    expect(await client.exists(key)).toBe(true);

    await client.delete(key);

    expect(await client.exists(key)).toBe(false);
  });

  it("delete is idempotent — no error when the key does not exist", async () => {
    const client = createS3Client({
      bucket: MINIO_BUCKET,
      endpoint: MINIO_ENDPOINT,
      forcePathStyle: true,
      region: "us-east-1",
    });

    const key = `integration/never-existed-${Date.now()}.txt`;
    // Some S3-compatible servers return 204 here; MinIO returns 204 too.
    // Our helper swallows `NoSuchKey`, so this must simply resolve.
    await expect(client.delete(key)).resolves.toBeUndefined();
  });
});
