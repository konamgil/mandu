import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  MemoryCacheStore,
  lookupCache,
  createCacheEntry,
  setGlobalCache,
  getGlobalCache,
  revalidatePath,
  revalidateTag,
  getCacheStoreStats,
  type CacheEntry,
} from "../../src/runtime/cache";

function entry(tags: string[] = [], revalidateAfter = Date.now() + 60_000): CacheEntry {
  return {
    html: "<p>ok</p>",
    loaderData: {},
    status: 200,
    headers: {},
    createdAt: Date.now(),
    revalidateAfter,
    tags,
  };
}

describe("MemoryCacheStore", () => {
  let store: MemoryCacheStore;
  beforeEach(() => { store = new MemoryCacheStore(3); });

  it("get returns null for missing key", () => {
    expect(store.get("x")).toBeNull();
  });

  it("set then get returns the entry", () => {
    const e = entry();
    store.set("k1", e);
    expect(store.get("k1")).toBe(e);
    expect(store.size).toBe(1);
  });

  it("evicts oldest entry when maxEntries exceeded (LRU)", () => {
    store.set("a", entry(["t"]));
    store.set("b", entry(["t"]));
    store.set("c", entry(["t"]));
    expect(store.size).toBe(3);

    store.set("d", entry(["t"]));
    expect(store.size).toBe(3);
    expect(store.get("a")).toBeNull();
    expect(store.get("d")).not.toBeNull();
  });

  it("deleteByTag removes matching entries and cleans cross-tag index", () => {
    store.set("k1", entry(["alpha", "shared"]));
    store.set("k2", entry(["beta", "shared"]));
    store.set("k3", entry(["gamma"]));

    store.deleteByTag("shared");
    expect(store.get("k1")).toBeNull();
    expect(store.get("k2")).toBeNull();
    expect(store.get("k3")).not.toBeNull();
  });

  it("deleteByTag with single tag", () => {
    store.set("k1", entry(["only"]));
    store.deleteByTag("only");
    expect(store.get("k1")).toBeNull();
    expect(store.size).toBe(0);
  });

  it("deleteByTag on non-existent tag is a no-op", () => {
    store.set("k1", entry(["a"]));
    store.deleteByTag("missing");
    expect(store.size).toBe(1);
  });

  it("deleteByPath removes entries whose key contains the pathname", () => {
    store.set("home:/about", entry());
    store.set("blog:/about", entry());
    store.set("home:/other", entry());

    store.deleteByPath("/about");
    expect(store.get("home:/about")).toBeNull();
    expect(store.get("blog:/about")).toBeNull();
    expect(store.get("home:/other")).not.toBeNull();
  });

  it("deleteByPath removes every query variant for the pathname", () => {
    store.set("home:/about?page=1", entry());
    store.set("home:/about?page=2", entry());
    store.set("home:/other?page=1", entry());

    store.deleteByPath("/about");
    expect(store.get("home:/about?page=1")).toBeNull();
    expect(store.get("home:/about?page=2")).toBeNull();
    expect(store.get("home:/other?page=1")).not.toBeNull();
  });

  it("clear empties everything", () => {
    store.set("a", entry(["t"]));
    store.set("b", entry(["t"]));
    store.clear();
    expect(store.size).toBe(0);
  });
});

describe("lookupCache", () => {
  let store: MemoryCacheStore;
  beforeEach(() => { store = new MemoryCacheStore(); });

  it("returns MISS on empty store", () => {
    const result = lookupCache(store, "key");
    expect(result.status).toBe("MISS");
    expect(result.entry).toBeNull();
  });

  it("returns HIT when entry is within revalidateAfter", () => {
    store.set("k", entry([], Date.now() + 60_000));
    const result = lookupCache(store, "k");
    expect(result.status).toBe("HIT");
    expect(result.entry).not.toBeNull();
  });

  it("returns STALE when entry is past revalidateAfter", () => {
    store.set("k", entry([], Date.now() - 1));
    const result = lookupCache(store, "k");
    expect(result.status).toBe("STALE");
    expect(result.entry).not.toBeNull();
  });

  it("tracks hit/miss/stale stats for memory cache", () => {
    store.set("fresh", entry([], Date.now() + 60_000));
    store.set("stale", entry([], Date.now() - 1));

    lookupCache(store, "fresh");
    lookupCache(store, "stale");
    lookupCache(store, "missing");

    const stats = getCacheStoreStats(store);
    expect(stats?.entries).toBe(2);
    expect(stats?.hits).toBe(1);
    expect(stats?.staleHits).toBe(1);
    expect(stats?.misses).toBe(1);
    expect(stats?.staleEntries).toBe(1);
    expect(stats?.maxEntries).toBe(1000);
  });
});

describe("createCacheEntry", () => {
  it("produces correct fields", () => {
    const before = Date.now();
    const e = createCacheEntry("<h1>hi</h1>", { x: 1 }, 30, ["tag1"], 201, { "X-Custom": "v" });
    const after = Date.now();

    expect(e.html).toBe("<h1>hi</h1>");
    expect(e.loaderData).toEqual({ x: 1 });
    expect(e.status).toBe(201);
    expect(e.headers).toEqual({ "X-Custom": "v" });
    expect(e.tags).toEqual(["tag1"]);
    expect(e.createdAt).toBeGreaterThanOrEqual(before);
    expect(e.createdAt).toBeLessThanOrEqual(after);
    expect(e.revalidateAfter).toBeGreaterThanOrEqual(before + 30_000);
  });
});

describe("revalidatePath / revalidateTag with globalCache", () => {
  let store: MemoryCacheStore;
  beforeEach(() => {
    store = new MemoryCacheStore();
    setGlobalCache(store);
  });
  afterEach(() => { setGlobalCache(null as any); });

  it("revalidatePath deletes matching entries", () => {
    store.set("r:/users", entry());
    store.set("r:/users?page=2", entry());
    revalidatePath("/users");
    expect(store.get("r:/users")).toBeNull();
    expect(store.get("r:/users?page=2")).toBeNull();
  });

  it("revalidateTag deletes matching entries", () => {
    store.set("k1", entry(["products"]));
    store.set("k2", entry(["other"]));
    revalidateTag("products");
    expect(store.get("k1")).toBeNull();
    expect(store.get("k2")).not.toBeNull();
  });

  it("revalidatePath is a no-op when globalCache is null", () => {
    setGlobalCache(null as any);
    expect(() => revalidatePath("/x")).not.toThrow();
  });
});
