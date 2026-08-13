/**
 * @mandujs/core/storage/s3 — unit tests
 *
 * These tests never touch the network. They substitute a controllable
 * in-memory fake for `Bun.S3Client` via the internal `_createS3ClientWith`
 * entry point, then assert that our wrapper forwards calls correctly and
 * applies the content-type / URL / error-mapping heuristics we promise.
 *
 * A separate integration suite (`packages/core/tests/storage/s3-minio.test.ts`)
 * exercises the real Bun.s3 code path against MinIO.
 */

import { describe, it, expect } from "bun:test";
import {
  _createS3ClientWith,
  getContentType,
  type BunS3ClientCtor,
  type BunS3ClientInstance,
} from "../index";

// ─── Fake Bun.S3Client ──────────────────────────────────────────────────────

/** Args captured on each fake method call — shape matches what we forward. */
interface CapturedWrite {
  key: string;
  body: Blob | ArrayBuffer | Uint8Array;
  options: { type?: string; acl?: string } | undefined;
}
interface CapturedPresign {
  key: string;
  options: { method?: string; expiresIn?: number; type?: string } | undefined;
}

interface FakeState {
  ctorCalls: Array<{
    bucket: string;
    endpoint?: string;
    region?: string;
    virtualHostedStyle?: boolean;
  }>;
  writes: CapturedWrite[];
  presigns: CapturedPresign[];
  deletes: string[];
  existsCalls: string[];
  streamCalls: string[];
  /** `true` = resolves true, `false` = resolves false, Error = throws. */
  existsBehavior: Map<string, true | false | Error>;
  deleteBehavior: Map<string, Error>;
}

function createFakeCtor(): { Ctor: BunS3ClientCtor; state: FakeState } {
  const state: FakeState = {
    ctorCalls: [],
    writes: [],
    presigns: [],
    deletes: [],
    existsCalls: [],
    streamCalls: [],
    existsBehavior: new Map(),
    deleteBehavior: new Map(),
  };

  class FakeS3Client implements BunS3ClientInstance {
    constructor(config: {
      bucket: string;
      endpoint?: string;
      region?: string;
      virtualHostedStyle?: boolean;
    }) {
      state.ctorCalls.push(config);
    }

    file(key: string) {
      return {
        async write(
          body: Blob | ArrayBuffer | Uint8Array,
          options?: { type?: string; acl?: string },
        ) {
          state.writes.push({ key, body, options });
          // Bun's write returns the byte count; fake a plausible number.
          return 0;
        },
        presign(options?: {
          method?: string;
          expiresIn?: number;
          type?: string;
        }): string {
          state.presigns.push({ key, options });
          const method = options?.method ?? "PUT";
          const expires = options?.expiresIn ?? 900;
          return `https://fake.s3.local/${key}?method=${method}&expires=${expires}`;
        },
        async delete() {
          const override = state.deleteBehavior.get(key);
          if (override) throw override;
          state.deletes.push(key);
        },
        async exists() {
          state.existsCalls.push(key);
          const b = state.existsBehavior.get(key);
          if (b instanceof Error) throw b;
          if (b === undefined) return true;
          return b;
        },
        stream(): ReadableStream {
          state.streamCalls.push(key);
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.close();
            },
          });
        },
      };
    }
  }

  // The ctor signature we export is `new (config) => instance` — cast through
  // unknown once to satisfy strict TS without widening the public type.
  return {
    Ctor: FakeS3Client as unknown as BunS3ClientCtor,
    state,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("@mandujs/core/compat/storage/s3 — upload", () => {
  it("calls bunClient.file(key).write(body) with the correct key and body", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, {
      bucket: "my-bucket",
      endpoint: "https://s3.example.com",
      forcePathStyle: true,
    });

    const body = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    await client.upload(body, { key: "a/b.txt" });

    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]!.key).toBe("a/b.txt");
    expect(state.writes[0]!.body).toBe(body);
  });

  it("infers Content-Type from key extension when not provided", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    await client.upload(new Uint8Array(), { key: "photos/hero.jpg" });
    await client.upload(new Uint8Array(), { key: "data/report.json" });

    expect(state.writes[0]!.options?.type).toBe("image/jpeg");
    expect(state.writes[1]!.options?.type).toBe("application/json");
  });

  it("passes through explicit contentType when provided", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    await client.upload(new Uint8Array(), {
      key: "binary-with-jpg-extension.jpg",
      contentType: "application/octet-stream",
    });

    // Explicit contentType wins over extension-based inference.
    expect(state.writes[0]!.options?.type).toBe("application/octet-stream");
  });

  it("passes through acl when provided and omits when not", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    await client.upload(new Uint8Array(), { key: "public.png", acl: "public-read" });
    await client.upload(new Uint8Array(), { key: "private.png" });

    expect(state.writes[0]!.options?.acl).toBe("public-read");
    // When acl is omitted from our call, it must NOT appear in the forwarded options.
    expect(state.writes[1]!.options?.acl).toBeUndefined();
  });

  it("accepts Blob, ArrayBuffer, and Uint8Array bodies uniformly", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    const blob = new Blob(["hi"], { type: "text/plain" });
    const ab = new ArrayBuffer(4);
    const u8 = new Uint8Array([1, 2, 3]);

    await client.upload(blob, { key: "a.txt" });
    await client.upload(ab, { key: "b.bin" });
    await client.upload(u8, { key: "c.bin" });

    expect(state.writes[0]!.body).toBe(blob);
    expect(state.writes[1]!.body).toBe(ab);
    expect(state.writes[2]!.body).toBe(u8);
  });

  it("throws when metadata is passed (not yet supported by Bun.S3Client)", async () => {
    const { Ctor } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    await expect(
      client.upload(new Uint8Array(), {
        key: "x.txt",
        metadata: { owner: "alice" },
      }),
    ).rejects.toThrow(/metadata.*not yet supported/);
  });

  it("returns a path-style URL when forcePathStyle=true", async () => {
    const { Ctor } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, {
      bucket: "uploads",
      endpoint: "https://minio.local:9000",
      forcePathStyle: true,
    });

    const url = await client.upload(new Uint8Array(), { key: "u/1.png" });
    expect(url).toBe("https://minio.local:9000/uploads/u/1.png");
  });

  it("returns a virtual-hosted URL by default", async () => {
    const { Ctor } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, {
      bucket: "uploads",
      endpoint: "https://s3.example.com",
    });

    const url = await client.upload(new Uint8Array(), { key: "u/1.png" });
    expect(url).toBe("https://uploads.s3.example.com/u/1.png");
  });

  it("returns an s3:// URI when no endpoint is configured (AWS default)", async () => {
    const { Ctor } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "my-bucket" });

    const url = await client.upload(new Uint8Array(), { key: "a/b.txt" });
    expect(url).toBe("s3://my-bucket/a/b.txt");
  });

  it("URL-encodes path segments but preserves '/' separators", async () => {
    const { Ctor } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, {
      bucket: "b",
      endpoint: "https://s3.example.com",
      forcePathStyle: true,
    });

    const url = await client.upload(new Uint8Array(), {
      key: "user uploads/hello world.txt",
    });
    expect(url).toBe("https://s3.example.com/b/user%20uploads/hello%20world.txt");
  });

  it("throws a TypeError when key is missing", async () => {
    const { Ctor } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    await expect(
      client.upload(new Uint8Array(), { key: "" }),
    ).rejects.toThrow(TypeError);
  });
});

describe("@mandujs/core/compat/storage/s3 — presign", () => {
  it("returns a string URL for method=PUT", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    const url = await client.presign({ key: "upload.png", method: "PUT" });

    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
    expect(state.presigns[0]!.options?.method).toBe("PUT");
  });

  it("honors expiresIn=60 for method=GET", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    await client.presign({ key: "download.txt", method: "GET", expiresIn: 60 });

    expect(state.presigns[0]!.options?.method).toBe("GET");
    expect(state.presigns[0]!.options?.expiresIn).toBe(60);
  });

  it("defaults method to PUT and expiresIn to 900 seconds", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    await client.presign({ key: "thing" });

    expect(state.presigns[0]!.options?.method).toBe("PUT");
    expect(state.presigns[0]!.options?.expiresIn).toBe(900);
  });

  it("forwards contentType as Bun's `type` option", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    await client.presign({ key: "x.png", method: "PUT", contentType: "image/png" });

    expect(state.presigns[0]!.options?.type).toBe("image/png");
  });

  it("throws a TypeError when key is missing", async () => {
    const { Ctor } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    await expect(client.presign({ key: "" })).rejects.toThrow(TypeError);
  });
});

describe("@mandujs/core/compat/storage/s3 — delete", () => {
  it("calls bunClient.file(key).delete() and resolves", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    await client.delete("to-remove.txt");

    expect(state.deletes).toContain("to-remove.txt");
  });

  it("resolves silently on NoSuchKey errors (idempotent delete)", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    const notFound = Object.assign(new Error("Not found"), {
      name: "S3Error",
      code: "NoSuchKey",
    });
    state.deleteBehavior.set("ghost.txt", notFound);

    await expect(client.delete("ghost.txt")).resolves.toBeUndefined();
  });

  it("re-throws non-404 delete errors", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    const accessDenied = Object.assign(new Error("Access denied"), {
      name: "S3Error",
      code: "AccessDenied",
      status: 403,
    });
    state.deleteBehavior.set("forbidden.txt", accessDenied);

    await expect(client.delete("forbidden.txt")).rejects.toThrow(/Access denied/);
  });
});

describe("@mandujs/core/compat/storage/s3 — exists", () => {
  it("returns true when the object exists", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });
    state.existsBehavior.set("here.txt", true);

    expect(await client.exists("here.txt")).toBe(true);
  });

  it("returns false when Bun.s3 reports the object as absent", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });
    state.existsBehavior.set("gone.txt", false);

    expect(await client.exists("gone.txt")).toBe(false);
  });

  it("returns false when Bun.s3 throws a NoSuchKey-shaped error", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });
    const nf = Object.assign(new Error("no key"), {
      name: "S3Error",
      code: "NoSuchKey",
    });
    state.existsBehavior.set("missing.txt", nf);

    expect(await client.exists("missing.txt")).toBe(false);
  });

  it("re-throws non-404 errors (e.g., AccessDenied/5xx)", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });
    const denied = Object.assign(new Error("403 denied"), {
      name: "S3Error",
      code: "AccessDenied",
      status: 403,
    });
    state.existsBehavior.set("protected.txt", denied);

    await expect(client.exists("protected.txt")).rejects.toThrow(/403 denied/);
  });
});

describe("@mandujs/core/compat/storage/s3 — getReadable", () => {
  it("returns a ReadableStream", async () => {
    const { Ctor, state } = createFakeCtor();
    const client = _createS3ClientWith(Ctor, { bucket: "b" });

    const s = await client.getReadable("file.bin");

    expect(s).toBeInstanceOf(ReadableStream);
    expect(state.streamCalls).toContain("file.bin");
  });
});

describe("@mandujs/core/compat/storage/s3 — createS3Client", () => {
  it("forwards bucket, endpoint, and region to the underlying ctor", () => {
    const { Ctor, state } = createFakeCtor();
    _createS3ClientWith(Ctor, {
      bucket: "prod-uploads",
      endpoint: "https://abc.r2.cloudflarestorage.com",
      region: "auto",
    });

    expect(state.ctorCalls).toHaveLength(1);
    expect(state.ctorCalls[0]!.bucket).toBe("prod-uploads");
    expect(state.ctorCalls[0]!.endpoint).toBe("https://abc.r2.cloudflarestorage.com");
    expect(state.ctorCalls[0]!.region).toBe("auto");
  });

  it("maps forcePathStyle=true to virtualHostedStyle=false (Bun's flag name)", () => {
    const { Ctor, state } = createFakeCtor();
    _createS3ClientWith(Ctor, {
      bucket: "b",
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
    });

    expect(state.ctorCalls[0]!.virtualHostedStyle).toBe(false);
  });

  it("leaves virtualHostedStyle untouched when forcePathStyle is unset", () => {
    const { Ctor, state } = createFakeCtor();
    _createS3ClientWith(Ctor, { bucket: "b" });

    expect(state.ctorCalls[0]!.virtualHostedStyle).toBeUndefined();
  });

  it("throws a TypeError when bucket is missing", () => {
    const { Ctor } = createFakeCtor();
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _createS3ClientWith(Ctor, { bucket: "" } as S3ConfigLike),
    ).toThrow(TypeError);
  });
});

// Helper alias for the "missing bucket" negative test — keeps us from having
// to stringify `any` in the test body.
type S3ConfigLike = Parameters<typeof _createS3ClientWith>[1];

describe("@mandujs/core/compat/storage/s3 — getContentType", () => {
  it.each([
    ["photo.jpg", "image/jpeg"],
    ["PHOTO.JPEG", "image/jpeg"], // case-insensitive
    ["a/b/c.png", "image/png"],
    ["logo.webp", "image/webp"],
    ["anim.gif", "image/gif"],
    ["doc.pdf", "application/pdf"],
    ["notes.txt", "text/plain"],
    ["data.json", "application/json"],
    ["report.csv", "text/csv"],
    ["archive.zip", "application/zip"],
    ["clip.mp4", "video/mp4"],
    ["clip.webm", "video/webm"],
  ])("maps %s to %s", (key, expected) => {
    expect(getContentType(key)).toBe(expected);
  });

  it.each([
    ["README", "application/octet-stream"], // no extension
    ["archive.", "application/octet-stream"], // trailing dot
    ["file.unknown", "application/octet-stream"], // unrecognized extension
    [".hidden", "application/octet-stream"], // dotfile without real extension
  ])("falls back to octet-stream for %s", (key, expected) => {
    expect(getContentType(key)).toBe(expected);
  });
});
