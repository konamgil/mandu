/**
 * Mandu SSR Cache Layer
 * ISR(Incremental Static Regeneration) + SWR(Stale-While-Revalidate) 지원
 */

// ========== Types ==========

export interface CacheEntry {
  /** 렌더링된 HTML */
  html: string;
  /** 직렬화된 loader 데이터 */
  loaderData: unknown;
  /** 응답 상태 코드 */
  status: number;
  /** 응답 헤더 */
  headers: Record<string, string>;
  /** 생성 시간 (ms) */
  createdAt: number;
  /** stale이 되는 시간 (ms) — createdAt + revalidate * 1000 */
  revalidateAfter: number;
  /** 무효화 태그 */
  tags: string[];
}

export type CacheStatus = "HIT" | "STALE" | "MISS";

export interface CacheLookupResult {
  status: CacheStatus;
  entry: CacheEntry | null;
}

export interface CacheStoreStats {
  entries: number;
  maxEntries?: number;
  staleEntries?: number;
  hits?: number;
  staleHits?: number;
  misses?: number;
  hitRate?: number;
}

export interface CacheStore {
  get(key: string): CacheEntry | null;
  set(key: string, entry: CacheEntry): void;
  delete(key: string): void;
  /** pathname 부분 매칭으로 캐시 삭제 (키 형식: "routeId:pathname") */
  deleteByPath(pathname: string): void;
  deleteByTag(tag: string): void;
  clear(): void;
  readonly size: number;
}

// ========== Memory Cache (LRU) ==========

export class MemoryCacheStore implements CacheStore {
  private cache = new Map<string, CacheEntry>();
  private tagIndex = new Map<string, Set<string>>();
  private readonly maxEntries: number;
  private hits = 0;
  private staleHits = 0;
  private misses = 0;

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.cache.size;
  }

  get(key: string): CacheEntry | null {
    return this.cache.get(key) ?? null;
  }

  /** LRU 접근 — HIT 확인 후에만 호출하여 stale 엔트리가 승격되지 않도록 */
  touch(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      this.cache.delete(key);
      this.cache.set(key, entry);
    }
  }

  set(key: string, entry: CacheEntry): void {
    // 기존 엔트리 태그 인덱스 정리
    if (this.cache.has(key)) {
      this.removeFromTagIndex(key);
    }

    // LRU eviction
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.removeFromTagIndex(oldest);
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, entry);

    // 태그 인덱스 업데이트
    for (const tag of entry.tags) {
      let keys = this.tagIndex.get(tag);
      if (!keys) {
        keys = new Set();
        this.tagIndex.set(tag, keys);
      }
      keys.add(key);
    }
  }

  delete(key: string): void {
    this.removeFromTagIndex(key);
    this.cache.delete(key);
  }

  deleteByPath(pathname: string): void {
    // 캐시 키 형식: "routeId:pathname?query" — pathname 부분이 일치하는 모든 키 삭제
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      const keyPath = getCachePathname(key);
      if (keyPath === pathname) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.delete(key);
    }
  }

  deleteByTag(tag: string): void {
    const keys = this.tagIndex.get(tag);
    if (!keys) return;

    for (const key of keys) {
      this.cache.delete(key);
      // 해당 key가 다른 태그에도 있으면 거기서도 제거
      for (const [otherTag, otherKeys] of this.tagIndex) {
        if (otherTag !== tag) {
          otherKeys.delete(key);
        }
      }
    }
    this.tagIndex.delete(tag);
  }

  clear(): void {
    this.cache.clear();
    this.tagIndex.clear();
  }

  recordHit(): void {
    this.hits += 1;
  }

  recordStale(): void {
    this.staleHits += 1;
  }

  recordMiss(): void {
    this.misses += 1;
  }

  getStats(): CacheStoreStats {
    const now = Date.now();
    const staleEntries = Array.from(this.cache.values()).filter((entry) => entry.revalidateAfter <= now).length;
    const totalLookups = this.hits + this.staleHits + this.misses;

    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries,
      staleEntries,
      hits: this.hits,
      staleHits: this.staleHits,
      misses: this.misses,
      hitRate: totalLookups > 0 ? this.hits / totalLookups : undefined,
    };
  }

  private removeFromTagIndex(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    for (const tag of entry.tags) {
      this.tagIndex.get(tag)?.delete(key);
    }
  }
}

function getCachePathname(key: string): string {
  const colonIdx = key.indexOf(":");
  const rawPath = colonIdx >= 0 ? key.slice(colonIdx + 1) : key;
  try {
    return new URL(rawPath, "http://mandu.local").pathname;
  } catch {
    const queryIdx = rawPath.indexOf("?");
    return queryIdx >= 0 ? rawPath.slice(0, queryIdx) : rawPath;
  }
}

// ========== Cache Lookup ==========

/**
 * 캐시 조회 — HIT / STALE / MISS 판정
 */
export function lookupCache(store: CacheStore, key: string): CacheLookupResult {
  const entry = store.get(key);
  if (!entry) {
    if ("recordMiss" in store && typeof (store as MemoryCacheStore).recordMiss === "function") {
      (store as MemoryCacheStore).recordMiss();
    }
    return { status: "MISS", entry: null };
  }

  const now = Date.now();
  if (now < entry.revalidateAfter) {
    if ("recordHit" in store && typeof (store as MemoryCacheStore).recordHit === "function") {
      (store as MemoryCacheStore).recordHit();
    }
    // HIT: LRU 승격 (MemoryCacheStore만 해당)
    if ("touch" in store && typeof (store as MemoryCacheStore).touch === "function") {
      (store as MemoryCacheStore).touch(key);
    }
    return { status: "HIT", entry };
  }

  if ("recordStale" in store && typeof (store as MemoryCacheStore).recordStale === "function") {
    (store as MemoryCacheStore).recordStale();
  }
  // STALE: LRU 승격하지 않음 — eviction 대상으로 유지
  return { status: "STALE", entry };
}

/**
 * 캐시 엔트리 생성
 */
export function createCacheEntry(
  html: string,
  loaderData: unknown,
  revalidateSeconds: number,
  tags: string[] = [],
  status: number = 200,
  headers: Record<string, string> = {}
): CacheEntry {
  const now = Date.now();
  return {
    html,
    loaderData,
    status,
    headers,
    createdAt: now,
    revalidateAfter: now + revalidateSeconds * 1000,
    tags,
  };
}

/**
 * 캐시된 Response 생성
 */
export function createCachedResponse(entry: CacheEntry, cacheStatus: CacheStatus): Response {
  const age = Math.floor((Date.now() - entry.createdAt) / 1000);
  return new Response(entry.html, {
    status: entry.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...entry.headers,
      "X-Mandu-Cache": cacheStatus,
      "Age": String(age),
    },
  });
}

// ========== Global Cache + Revalidation API ==========

let globalCacheStore: CacheStore | null = null;

export function setGlobalCache(store: CacheStore): void {
  globalCacheStore = store;
}

export function getGlobalCache(): CacheStore | null {
  return globalCacheStore;
}

/**
 * 특정 경로의 캐시 무효화
 */
export function revalidatePath(path: string): void {
  if (!globalCacheStore) return;
  globalCacheStore.deleteByPath(path);
}

/**
 * 특정 태그의 모든 캐시 무효화
 */
export function revalidateTag(tag: string): void {
  if (!globalCacheStore) return;
  globalCacheStore.deleteByTag(tag);
}

export function getCacheStoreStats(store: CacheStore | null): CacheStoreStats | null {
  if (!store) return null;

  if ("getStats" in store && typeof (store as MemoryCacheStore).getStats === "function") {
    return (store as MemoryCacheStore).getStats();
  }

  return {
    entries: store.size,
  };
}
