/**
 * ContentLayer - 콘텐츠 레이어 메인 클래스
 *
 * 빌드 타임에 모든 컬렉션을 로드하고 관리
 * getCollection(), getEntry() API 제공
 */

import type {
  ContentConfig,
  CollectionConfig,
  DataEntry,
  ManduContentConfig,
  ContentWatcher,
  RenderedContent,
} from "./types";
import { LoaderError } from "./types";
import { ContentDataStore, createDataStore } from "./data-store";
import { ContentMetaStore, createMetaStore } from "./meta-store";
import { createLoaderContext, createSimpleMarkdownRenderer } from "./loader-context";
import { CONTENT } from "../constants";
import type { ZodSchema } from "zod";
import * as path from "path";

/**
 * ContentLayer 옵션
 */
export interface ContentLayerOptions {
  /** 콘텐츠 설정 */
  contentConfig: ContentConfig;
  /** Mandu 설정 */
  manduConfig: ManduContentConfig;
  /** Markdown 렌더러 (선택) */
  markdownRenderer?: (content: string) => Promise<RenderedContent>;
  /** 파일 감시자 (dev 모드) */
  watcher?: ContentWatcher;
}

/**
 * ContentLayer 클래스
 *
 * 빌드 타임 콘텐츠 로딩 및 관리
 */
export class ContentLayer {
  private contentConfig: ContentConfig;
  private manduConfig: ManduContentConfig;
  private dataStore: ContentDataStore;
  private metaStore: ContentMetaStore;
  private markdownRenderer: (content: string) => Promise<RenderedContent>;
  private watcher?: ContentWatcher;
  private loaded: boolean = false;
  private loading: Promise<void> | null = null;

  constructor(options: ContentLayerOptions) {
    const { contentConfig, manduConfig, markdownRenderer, watcher } = options;

    this.contentConfig = contentConfig;
    this.manduConfig = manduConfig;
    this.watcher = watcher;
    this.markdownRenderer = markdownRenderer ?? createSimpleMarkdownRenderer();

    // 스토어 초기화
    const storeFile = path.join(manduConfig.root, CONTENT.STORE_FILE);
    const metaFile = path.join(manduConfig.root, CONTENT.META_FILE);

    this.dataStore = createDataStore({
      filePath: storeFile,
      autoSave: true,
      saveDebounce: CONTENT.DEBOUNCE_SAVE,
    });

    this.metaStore = createMetaStore({
      filePath: metaFile,
      autoSave: true,
    });
  }

  /**
   * 모든 컬렉션 로드
   */
  async load(): Promise<void> {
    // 이미 로딩 중이면 기다림
    if (this.loading) {
      return this.loading;
    }

    // 이미 로드됨
    if (this.loaded) {
      return;
    }

    this.loading = this.doLoad();
    await this.loading;
    this.loading = null;
    this.loaded = true;
  }

  private async doLoad(): Promise<void> {
    // 캐시에서 로드
    await Promise.all([this.dataStore.load(), this.metaStore.load()]);

    const collections = Object.entries(this.contentConfig.collections);

    // 병렬로 모든 컬렉션 로드
    await Promise.all(
      collections.map(([name, config]) => this.loadCollection(name, config))
    );

    // 저장
    await Promise.all([this.dataStore.save(), this.metaStore.save()]);
  }

  /**
   * 단일 컬렉션 로드
   */
  private async loadCollection(name: string, config: CollectionConfig): Promise<void> {
    const { loader, schema } = config;

    // 로더 스키마와 컬렉션 스키마 병합 (컬렉션 우선)
    let finalSchema: ZodSchema | undefined = schema;
    if (!finalSchema && loader.schema) {
      finalSchema =
        typeof loader.schema === "function" ? await loader.schema() : loader.schema;
    }

    // LoaderContext 생성
    const context = createLoaderContext({
      collection: name,
      store: this.dataStore.getStore(name),
      meta: this.metaStore.getStore(name),
      config: this.manduConfig,
      schema: finalSchema,
      markdownRenderer: this.markdownRenderer,
      watcher: this.watcher,
    });

    try {
      // 타임아웃 처리
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new LoaderError(`Loader "${loader.name}" timed out`, name)),
          CONTENT.LOADER_TIMEOUT
        );
      });

      await Promise.race([loader.load(context), timeoutPromise]);

      context.logger.info(`Loaded ${context.store.size()} entries`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error(`Failed to load: ${message}`);

      if (error instanceof LoaderError) {
        throw error;
      }

      throw new LoaderError(`Failed to load collection "${name}": ${message}`, name);
    }
  }

  /**
   * 단일 컬렉션 다시 로드
   */
  async reloadCollection(name: string): Promise<void> {
    const config = this.contentConfig.collections[name];
    if (!config) {
      throw new Error(`Collection "${name}" not found`);
    }

    await this.loadCollection(name, config);
    await this.dataStore.save();
    await this.metaStore.save();
  }

  /**
   * 컬렉션의 모든 엔트리 조회
   */
  getCollection<T = Record<string, unknown>>(
    collection: string
  ): Array<DataEntry<T>> {
    this.ensureLoaded();

    const store = this.dataStore.getStore(collection);
    return store.values<T>();
  }

  /**
   * 컬렉션에서 단일 엔트리 조회
   */
  getEntry<T = Record<string, unknown>>(
    collection: string,
    id: string
  ): DataEntry<T> | undefined {
    this.ensureLoaded();

    const store = this.dataStore.getStore(collection);
    return store.get<T>(id);
  }

  /**
   * 컬렉션 존재 여부 확인
   */
  hasCollection(collection: string): boolean {
    return collection in this.contentConfig.collections;
  }

  /**
   * 모든 컬렉션 이름 조회
   */
  getCollectionNames(): string[] {
    return Object.keys(this.contentConfig.collections);
  }

  /**
   * 컬렉션 통계
   */
  getStats(): {
    collections: number;
    totalEntries: number;
    byCollection: Record<string, number>;
  } {
    this.ensureLoaded();

    const byCollection: Record<string, number> = {};
    let totalEntries = 0;

    for (const name of this.getCollectionNames()) {
      const store = this.dataStore.getStore(name);
      const count = store.size();
      byCollection[name] = count;
      totalEntries += count;
    }

    return {
      collections: Object.keys(byCollection).length,
      totalEntries,
      byCollection,
    };
  }

  /**
   * 로드 확인
   */
  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error(
        "ContentLayer not loaded. Call await contentLayer.load() first."
      );
    }
  }

  /**
   * 리소스 정리
   */
  dispose(): void {
    this.dataStore.dispose();
    this.watcher?.close();
  }
}

/**
 * ContentLayer 팩토리
 */
export function createContentLayer(options: ContentLayerOptions): ContentLayer {
  return new ContentLayer(options);
}

// ============================================================================
// 전역 ContentLayer 인스턴스 (싱글톤)
// ============================================================================

let globalContentLayer: ContentLayer | null = null;

/**
 * 전역 ContentLayer 설정
 */
export function setGlobalContentLayer(layer: ContentLayer): void {
  globalContentLayer = layer;
}

/**
 * 전역 ContentLayer 조회
 */
export function getGlobalContentLayer(): ContentLayer | null {
  return globalContentLayer;
}

/**
 * 컬렉션 조회 (전역 ContentLayer 사용)
 */
export async function getCollection<T = Record<string, unknown>>(
  collection: string
): Promise<Array<DataEntry<T>>> {
  if (!globalContentLayer) {
    throw new Error("ContentLayer not initialized. Call setGlobalContentLayer() first.");
  }

  await globalContentLayer.load();
  return globalContentLayer.getCollection<T>(collection);
}

/**
 * 단일 엔트리 조회 (전역 ContentLayer 사용)
 */
export async function getEntry<T = Record<string, unknown>>(
  collection: string,
  id: string
): Promise<DataEntry<T> | undefined> {
  if (!globalContentLayer) {
    throw new Error("ContentLayer not initialized. Call setGlobalContentLayer() first.");
  }

  await globalContentLayer.load();
  return globalContentLayer.getEntry<T>(collection, id);
}
