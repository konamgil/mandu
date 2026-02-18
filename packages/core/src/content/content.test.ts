/**
 * Content Layer Tests
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { generateDigest, generateFileDigest, combineDigests, digestsMatch } from "./digest";
import { createDataStore, type ContentDataStore } from "./data-store";
import { createMetaStore, type ContentMetaStore } from "./meta-store";
import { createLoaderContext, createSimpleMarkdownRenderer } from "./loader-context";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";

// ============================================================================
// Digest Tests
// ============================================================================

describe("digest", () => {
  test("generateDigest creates consistent hash for same data", () => {
    const data = { title: "Hello", count: 42 };
    const hash1 = generateDigest(data);
    const hash2 = generateDigest(data);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(16);
  });

  test("generateDigest creates different hash for different data", () => {
    const hash1 = generateDigest({ a: 1 });
    const hash2 = generateDigest({ a: 2 });

    expect(hash1).not.toBe(hash2);
  });

  test("generateDigest handles nested objects", () => {
    const data = {
      user: { name: "John", age: 30 },
      tags: ["a", "b"],
    };

    const hash = generateDigest(data);
    expect(hash.length).toBe(16);
  });

  test("generateDigest is order-independent for object keys", () => {
    const hash1 = generateDigest({ a: 1, b: 2 });
    const hash2 = generateDigest({ b: 2, a: 1 });

    expect(hash1).toBe(hash2);
  });

  test("generateFileDigest works with string content", () => {
    const content = "# Hello World\n\nThis is content.";
    const hash = generateFileDigest(content);

    expect(hash.length).toBe(16);
  });

  test("combineDigests combines multiple digests", () => {
    const d1 = generateDigest({ a: 1 });
    const d2 = generateDigest({ b: 2 });
    const combined = combineDigests([d1, d2]);

    expect(combined.length).toBe(16);
    expect(combined).not.toBe(d1);
    expect(combined).not.toBe(d2);
  });

  test("digestsMatch compares digests correctly", () => {
    const d1 = generateDigest({ x: 1 });
    const d2 = generateDigest({ x: 1 });
    const d3 = generateDigest({ x: 2 });

    expect(digestsMatch(d1, d2)).toBe(true);
    expect(digestsMatch(d1, d3)).toBe(false);
    expect(digestsMatch(undefined, d1)).toBe(false);
  });
});

// ============================================================================
// DataStore Tests
// ============================================================================

describe("DataStore", () => {
  let store: ContentDataStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mandu-test-"));
    store = createDataStore({
      filePath: path.join(tempDir, "store.json"),
      autoSave: false,
    });
  });

  afterEach(() => {
    store.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("getStore returns a DataStore interface", () => {
    const posts = store.getStore("posts");

    expect(posts.get).toBeDefined();
    expect(posts.set).toBeDefined();
    expect(posts.delete).toBeDefined();
    expect(posts.entries).toBeDefined();
  });

  test("set and get work correctly", () => {
    const posts = store.getStore("posts");

    posts.set({
      id: "hello-world",
      data: { title: "Hello World" },
      digest: "abc123",
    });

    const entry = posts.get("hello-world");
    expect(entry).toBeDefined();
    expect(entry?.data.title).toBe("Hello World");
  });

  test("set returns true for new/changed entries", () => {
    const posts = store.getStore("posts");

    const result1 = posts.set({
      id: "post1",
      data: { title: "Post 1" },
      digest: "digest1",
    });
    expect(result1).toBe(true);

    // Same digest, no change
    const result2 = posts.set({
      id: "post1",
      data: { title: "Post 1" },
      digest: "digest1",
    });
    expect(result2).toBe(false);

    // Different digest, changed
    const result3 = posts.set({
      id: "post1",
      data: { title: "Post 1 Updated" },
      digest: "digest2",
    });
    expect(result3).toBe(true);
  });

  test("delete removes entry", () => {
    const posts = store.getStore("posts");

    posts.set({ id: "to-delete", data: {}, digest: "x" });
    expect(posts.has("to-delete")).toBe(true);

    posts.delete("to-delete");
    expect(posts.has("to-delete")).toBe(false);
  });

  test("entries returns all entries", () => {
    const posts = store.getStore("posts");

    posts.set({ id: "p1", data: { n: 1 }, digest: "a" });
    posts.set({ id: "p2", data: { n: 2 }, digest: "b" });

    const entries = posts.entries();
    expect(entries.length).toBe(2);
    expect(entries.map(([id]) => id).sort()).toEqual(["p1", "p2"]);
  });

  test("size returns entry count", () => {
    const posts = store.getStore("posts");

    expect(posts.size()).toBe(0);

    posts.set({ id: "p1", data: {}, digest: "a" });
    posts.set({ id: "p2", data: {}, digest: "b" });

    expect(posts.size()).toBe(2);
  });

  test("clear removes all entries", () => {
    const posts = store.getStore("posts");

    posts.set({ id: "p1", data: {}, digest: "a" });
    posts.set({ id: "p2", data: {}, digest: "b" });

    posts.clear();
    expect(posts.size()).toBe(0);
  });

  test("save and load persist data", async () => {
    const posts = store.getStore("posts");

    posts.set({
      id: "persistent",
      data: { title: "Persistent Post" },
      digest: "persistent-digest",
    });

    await store.save();

    // Create new store and load
    const store2 = createDataStore({
      filePath: path.join(tempDir, "store.json"),
      autoSave: false,
    });

    await store2.load();

    const posts2 = store2.getStore("posts");
    const entry = posts2.get("persistent");

    expect(entry).toBeDefined();
    expect(entry?.data.title).toBe("Persistent Post");

    store2.dispose();
  });
});

// ============================================================================
// MetaStore Tests
// ============================================================================

describe("MetaStore", () => {
  let metaStore: ContentMetaStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mandu-meta-test-"));
    metaStore = createMetaStore({
      filePath: path.join(tempDir, "meta.json"),
      autoSave: false,
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("getStore returns MetaStore interface", () => {
    const meta = metaStore.getStore("posts");

    expect(meta.get).toBeDefined();
    expect(meta.set).toBeDefined();
    expect(meta.has).toBeDefined();
  });

  test("set and get work correctly", () => {
    const meta = metaStore.getStore("api-data");

    meta.set("lastSync", "2024-01-15T10:00:00Z");
    meta.set("cursor", "abc123");

    expect(meta.get("lastSync")).toBe("2024-01-15T10:00:00Z");
    expect(meta.get("cursor")).toBe("abc123");
    expect(meta.get("nonexistent")).toBeUndefined();
  });

  test("has checks existence", () => {
    const meta = metaStore.getStore("collection");

    expect(meta.has("key")).toBe(false);

    meta.set("key", "value");
    expect(meta.has("key")).toBe(true);
  });

  test("delete removes key", () => {
    const meta = metaStore.getStore("collection");

    meta.set("toDelete", "value");
    expect(meta.has("toDelete")).toBe(true);

    meta.delete("toDelete");
    expect(meta.has("toDelete")).toBe(false);
  });

  test("entries returns all key-value pairs", () => {
    const meta = metaStore.getStore("collection");

    meta.set("k1", "v1");
    meta.set("k2", "v2");

    const entries = meta.entries();
    expect(entries.length).toBe(2);
  });
});

// ============================================================================
// LoaderContext Tests
// ============================================================================

describe("LoaderContext", () => {
  let dataStore: ContentDataStore;
  let metaStore: ContentMetaStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mandu-ctx-test-"));
    dataStore = createDataStore({ autoSave: false });
    metaStore = createMetaStore({ autoSave: false });
  });

  afterEach(() => {
    dataStore.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates context with all properties", () => {
    const context = createLoaderContext({
      collection: "posts",
      store: dataStore.getStore("posts"),
      meta: metaStore.getStore("posts"),
      config: { root: tempDir },
    });

    expect(context.collection).toBe("posts");
    expect(context.store).toBeDefined();
    expect(context.meta).toBeDefined();
    expect(context.logger).toBeDefined();
    expect(context.parseData).toBeDefined();
    expect(context.generateDigest).toBeDefined();
  });

  test("parseData validates with schema", async () => {
    const schema = z.object({
      title: z.string(),
      count: z.number(),
    });

    const context = createLoaderContext({
      collection: "posts",
      store: dataStore.getStore("posts"),
      meta: metaStore.getStore("posts"),
      config: { root: tempDir },
      schema,
    });

    // Valid data
    const valid = await context.parseData({
      id: "test",
      data: { title: "Hello", count: 5 },
    });

    expect((valid as Record<string, unknown>).title).toBe("Hello");
    expect((valid as Record<string, unknown>).count).toBe(5);

    // Invalid data should throw
    await expect(
      context.parseData({
        id: "invalid",
        data: { title: 123, count: "not a number" },
      })
    ).rejects.toThrow();
  });

  test("parseData passes through without schema", async () => {
    const context = createLoaderContext({
      collection: "posts",
      store: dataStore.getStore("posts"),
      meta: metaStore.getStore("posts"),
      config: { root: tempDir },
    });

    const data = await context.parseData({
      id: "test",
      data: { anything: "goes" },
    });

    expect((data as Record<string, unknown>).anything).toBe("goes");
  });

  test("generateDigest creates hash", () => {
    const context = createLoaderContext({
      collection: "posts",
      store: dataStore.getStore("posts"),
      meta: metaStore.getStore("posts"),
      config: { root: tempDir },
    });

    const hash = context.generateDigest({ test: "data" });
    expect(hash.length).toBe(16);
  });
});

// ============================================================================
// Markdown Renderer Tests
// ============================================================================

describe("SimpleMarkdownRenderer", () => {
  const render = createSimpleMarkdownRenderer();

  test("renders headings", async () => {
    const result = await render("# Heading 1\n## Heading 2");

    expect(result.html).toContain("<h1>Heading 1</h1>");
    expect(result.html).toContain("<h2>Heading 2</h2>");
  });

  test("extracts headings", async () => {
    const result = await render("# Title\n## Section 1\n### Subsection");

    expect(result.headings).toBeDefined();
    expect(result.headings?.length).toBe(3);
    expect(result.headings?.[0]).toEqual({
      depth: 1,
      text: "Title",
      slug: "title",
    });
  });

  test("renders bold and italic", async () => {
    const result = await render("**bold** and *italic*");

    expect(result.html).toContain("<strong>bold</strong>");
    expect(result.html).toContain("<em>italic</em>");
  });

  test("renders links", async () => {
    const result = await render("[Link Text](https://example.com)");

    expect(result.html).toContain('<a href="https://example.com">Link Text</a>');
  });

  test("renders code", async () => {
    const result = await render("`inline code`");

    expect(result.html).toContain("<code>inline code</code>");
  });
});
