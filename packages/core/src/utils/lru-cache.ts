/**
 * 간단한 LRU (Least Recently Used) 캐시 구현
 */
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private readonly maxSize: number;
  private _hits = 0;
  private _misses = 0;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  getWithStats(key: K): V | undefined {
    const value = this.get(key);
    if (value !== undefined) {
      this._hits++;
    } else {
      this._misses++;
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  getStats(): { hits: number; misses: number; hitRate: number } {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? this._hits / total : 0,
    };
  }

  resetStats(): void {
    this._hits = 0;
    this._misses = 0;
  }
}
