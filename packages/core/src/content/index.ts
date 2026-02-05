/**
 * Mandu Content Layer
 *
 * Astro Content Layer에서 영감받은 빌드 타임 콘텐츠 로딩 시스템
 *
 * @example
 * ```ts
 * // content.config.ts
 * import { defineContentConfig, glob, file, api } from '@mandujs/core/content';
 * import { z } from 'zod';
 *
 * const postSchema = z.object({
 *   title: z.string(),
 *   date: z.coerce.date(),
 *   tags: z.array(z.string()).default([]),
 * });
 *
 * export default defineContentConfig({
 *   collections: {
 *     posts: {
 *       loader: glob({ pattern: 'content/posts/**\/*.md' }),
 *       schema: postSchema,
 *     },
 *     settings: {
 *       loader: file({ path: 'data/settings.json' }),
 *     },
 *     products: {
 *       loader: api({ url: 'https://api.example.com/products' }),
 *     },
 *   },
 * });
 * ```
 *
 * ```ts
 * // 페이지에서 사용
 * import { getCollection, getEntry } from '@mandujs/core/content';
 *
 * const posts = await getCollection('posts');
 * const post = await getEntry('posts', 'hello-world');
 * ```
 */

// ============================================================================
// Core exports
// ============================================================================

export {
  ContentLayer,
  createContentLayer,
  getCollection,
  getEntry,
  setGlobalContentLayer,
  getGlobalContentLayer,
} from "./content-layer";

export type { ContentLayerOptions } from "./content-layer";

// ============================================================================
// Loaders
// ============================================================================

export { file, glob, api } from "./loaders";

export type {
  Loader,
  FileLoaderOptions,
  GlobLoaderOptions,
  ApiLoaderOptions,
  PaginationConfig,
  ParsedMarkdown,
  LoaderEntry,
} from "./loaders";

// ============================================================================
// Stores
// ============================================================================

export { ContentDataStore, createDataStore } from "./data-store";
export type { DataStoreOptions } from "./data-store";

export { ContentMetaStore, createMetaStore } from "./meta-store";
export type { MetaStoreOptions } from "./meta-store";

// ============================================================================
// Utilities
// ============================================================================

export {
  generateDigest,
  generateFileDigest,
  combineDigests,
  digestsMatch,
  hasChanged,
} from "./digest";

export type { DigestOptions } from "./digest";

export { createLoaderContext, createSimpleMarkdownRenderer } from "./loader-context";
export type { CreateLoaderContextOptions } from "./loader-context";

export { createContentWatcher } from "./watcher";
export type { ContentWatcherOptions } from "./watcher";

// ============================================================================
// Types
// ============================================================================

export type {
  // Core types
  DataEntry,
  RenderedContent,
  ContentHeading,
  CollectionConfig,
  ContentConfig,

  // Loader types
  LoaderContext,
  ParseDataOptions,

  // Store interfaces
  DataStore,
  MetaStore,

  // Logger & Watcher
  ContentLogger,
  ContentWatcher,

  // Config
  ManduContentConfig,

  // Helper types
  InferEntryData,
  CollectionEntry,
} from "./types";

// Errors
export {
  ContentError,
  LoaderError,
  ParseError,
  ValidationError,
} from "./types";

// ============================================================================
// Config helper
// ============================================================================

/**
 * Content 설정 정의 헬퍼
 *
 * @example
 * ```ts
 * export default defineContentConfig({
 *   collections: {
 *     posts: { loader: glob({ pattern: 'content/posts/**\/*.md' }) },
 *   },
 * });
 * ```
 */
import type { ContentConfig as ContentConfigType } from "./types";

export function defineContentConfig<T extends ContentConfigType>(config: T): T {
  return config;
}
