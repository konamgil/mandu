/**
 * DataStore - 콘텐츠 데이터 저장소
 *
 * 컬렉션별 데이터 엔트리를 메모리에 저장하고
 * 영속화를 위해 JSON 파일로 직렬화
 */

import type { DataEntry, DataStore } from "./types";
import { digestsMatch } from "./digest";
import * as fs from "fs";
import * as path from "path";

/**
 * 스토어 옵션
 */
export interface DataStoreOptions {
  /** 영속화 파일 경로 */
  filePath?: string;
  /** 자동 저장 활성화 */
  autoSave?: boolean;
  /** 저장 디바운스 (ms) */
  saveDebounce?: number;
}

/**
 * 직렬화된 스토어 형식
 */
interface SerializedStore {
  version: number;
  collections: Record<string, Record<string, DataEntry>>;
  timestamp: string;
}

const STORE_VERSION = 1;

/**
 * 컬렉션별 DataStore 관리자
 */
export class ContentDataStore {
  private collections: Map<string, Map<string, DataEntry>> = new Map();
  private options: DataStoreOptions;
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty: boolean = false;

  constructor(options: DataStoreOptions = {}) {
    this.options = {
      autoSave: true,
      saveDebounce: 500,
      ...options,
    };
  }

  /**
   * 컬렉션용 DataStore 인터페이스 생성
   */
  getStore(collection: string): DataStore {
    if (!this.collections.has(collection)) {
      this.collections.set(collection, new Map());
    }

    const store = this.collections.get(collection)!;

    return {
      get: <T>(id: string) => store.get(id) as DataEntry<T> | undefined,

      set: <T>(entry: DataEntry<T>) => {
        const existing = store.get(entry.id);
        const changed = !existing || !digestsMatch(existing.digest, entry.digest);

        if (changed) {
          store.set(entry.id, entry as DataEntry);
          this.markDirty();
        }

        return changed;
      },

      delete: (id: string) => {
        if (store.has(id)) {
          store.delete(id);
          this.markDirty();
        }
      },

      clear: () => {
        if (store.size > 0) {
          store.clear();
          this.markDirty();
        }
      },

      entries: <T>() =>
        Array.from(store.entries()) as Array<[string, DataEntry<T>]>,

      has: (id: string) => store.has(id),

      size: () => store.size,

      keys: () => Array.from(store.keys()),

      values: <T>() => Array.from(store.values()) as Array<DataEntry<T>>,
    };
  }

  /**
   * 컬렉션 삭제
   */
  deleteCollection(collection: string): void {
    if (this.collections.has(collection)) {
      this.collections.delete(collection);
      this.markDirty();
    }
  }

  /**
   * 모든 컬렉션 이름 조회
   */
  getCollectionNames(): string[] {
    return Array.from(this.collections.keys());
  }

  /**
   * 변경 표시 및 자동 저장 스케줄링
   */
  private markDirty(): void {
    this.dirty = true;

    if (this.options.autoSave && this.options.filePath) {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }

      this.saveTimer = setTimeout(() => {
        this.save();
      }, this.options.saveDebounce);
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
      const data: SerializedStore = JSON.parse(content);

      if (data.version !== STORE_VERSION) {
        console.warn(
          `[ContentStore] Store version mismatch (${data.version} vs ${STORE_VERSION}), starting fresh`
        );
        return;
      }

      for (const [collection, entries] of Object.entries(data.collections)) {
        const store = new Map<string, DataEntry>();
        for (const [id, entry] of Object.entries(entries)) {
          store.set(id, entry);
        }
        this.collections.set(collection, store);
      }

      this.dirty = false;
    } catch (error) {
      console.warn(
        `[ContentStore] Failed to load store:`,
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

      const data: SerializedStore = {
        version: STORE_VERSION,
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
        `[ContentStore] Failed to save store:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * 저장 타이머 정리
   */
  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // 남은 변경사항 저장
    if (this.dirty && this.options.filePath) {
      this.save();
    }
  }

  /**
   * 전체 스토어 통계
   */
  getStats(): { collections: number; totalEntries: number } {
    let totalEntries = 0;
    for (const store of this.collections.values()) {
      totalEntries += store.size;
    }

    return {
      collections: this.collections.size,
      totalEntries,
    };
  }
}

/**
 * DataStore 팩토리
 */
export function createDataStore(options?: DataStoreOptions): ContentDataStore {
  return new ContentDataStore(options);
}
