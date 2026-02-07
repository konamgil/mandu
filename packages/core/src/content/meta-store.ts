/**
 * MetaStore - 동기화 메타데이터 저장소
 *
 * API 동기화 토큰, 마지막 수정 시간, 커서 등
 * 로더가 증분 업데이트를 수행하는 데 필요한 메타데이터 저장
 */

import type { MetaStore } from "./types";
import * as fs from "fs";
import * as path from "path";

/**
 * MetaStore 옵션
 */
export interface MetaStoreOptions {
  /** 영속화 파일 경로 */
  filePath?: string;
  /** 자동 저장 활성화 */
  autoSave?: boolean;
}

/**
 * 직렬화된 메타 스토어 형식
 */
interface SerializedMetaStore {
  version: number;
  collections: Record<string, Record<string, string>>;
  timestamp: string;
}

const META_VERSION = 1;

/**
 * 콘텐츠 메타 저장소 구현
 */
export class ContentMetaStore {
  private collections: Map<string, Map<string, string>> = new Map();
  private options: MetaStoreOptions;
  private dirty: boolean = false;

  constructor(options: MetaStoreOptions = {}) {
    this.options = {
      autoSave: true,
      ...options,
    };
  }

  /**
   * 컬렉션용 MetaStore 인터페이스 생성
   */
  getStore(collection: string): MetaStore {
    if (!this.collections.has(collection)) {
      this.collections.set(collection, new Map());
    }

    const store = this.collections.get(collection)!;

    return {
      get: (key: string) => store.get(key),

      set: (key: string, value: string) => {
        store.set(key, value);
        this.dirty = true;
        this.autoSave();
      },

      has: (key: string) => store.has(key),

      delete: (key: string) => {
        if (store.has(key)) {
          store.delete(key);
          this.dirty = true;
          this.autoSave();
        }
      },

      clear: () => {
        if (store.size > 0) {
          store.clear();
          this.dirty = true;
          this.autoSave();
        }
      },

      entries: () => Array.from(store.entries()),
    };
  }

  /**
   * 컬렉션 삭제
   */
  deleteCollection(collection: string): void {
    if (this.collections.has(collection)) {
      this.collections.delete(collection);
      this.dirty = true;
      this.autoSave();
    }
  }

  /**
   * 자동 저장
   */
  private autoSave(): void {
    if (this.options.autoSave && this.options.filePath) {
      this.save();
    }
  }

  /**
   * 파일에서 로드
   */
  async load(): Promise<void> {
    if (!this.options.filePath) return;

    try {
      if (!fs.existsSync(this.options.filePath)) {
        return;
      }

      const content = fs.readFileSync(this.options.filePath, "utf-8");
      const data: SerializedMetaStore = JSON.parse(content);

      if (data.version !== META_VERSION) {
        console.warn(
          `[MetaStore] Version mismatch (${data.version} vs ${META_VERSION}), starting fresh`
        );
        return;
      }

      for (const [collection, entries] of Object.entries(data.collections)) {
        const store = new Map<string, string>();
        for (const [key, value] of Object.entries(entries)) {
          store.set(key, value);
        }
        this.collections.set(collection, store);
      }

      this.dirty = false;
    } catch (error) {
      console.warn(
        `[MetaStore] Failed to load:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * 파일에 저장
   */
  async save(): Promise<void> {
    if (!this.options.filePath || !this.dirty) return;

    try {
      const dir = path.dirname(this.options.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: SerializedMetaStore = {
        version: META_VERSION,
        collections: {},
        timestamp: new Date().toISOString(),
      };

      for (const [collection, store] of this.collections) {
        data.collections[collection] = Object.fromEntries(store);
      }

      fs.writeFileSync(this.options.filePath, JSON.stringify(data, null, 2));
      this.dirty = false;
    } catch (error) {
      console.error(
        `[MetaStore] Failed to save:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * 전체 스토어 초기화
   */
  clear(): void {
    this.collections.clear();
    this.dirty = true;
    this.autoSave();
  }

  /**
   * 스토어 통계
   */
  getStats(): { collections: number; totalKeys: number } {
    let totalKeys = 0;
    for (const store of this.collections.values()) {
      totalKeys += store.size;
    }

    return {
      collections: this.collections.size,
      totalKeys,
    };
  }
}

/**
 * MetaStore 팩토리
 */
export function createMetaStore(options?: MetaStoreOptions): ContentMetaStore {
  return new ContentMetaStore(options);
}
